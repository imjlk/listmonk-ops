import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import {
	OutboundWebhookConflictError,
	OutboundWebhookNotFoundError,
	mergeOutboundWebhookEndpointUpdate,
	matchesOutboundWebhookEvent,
	outboundWebhookLeaseReconciliationError,
	outboundWebhookRetryDelayMs,
	parseOutboundWebhookDelivery,
	parseOutboundWebhookEndpoint,
	parseOutboundWebhookEvent,
	truncateOutboundWebhookError,
	type ClaimedOutboundWebhookDelivery,
	type CompleteOutboundWebhookDeliveryResult,
	type EnqueueOutboundWebhookResult,
	type OutboundWebhookDelivery,
	type OutboundWebhookDeliveryListOptions,
	type OutboundWebhookEndpoint,
	type OutboundWebhookEndpointRuntime,
	type OutboundWebhookEvent,
	type OutboundWebhookRepository,
	type PruneOutboundWebhooksResult,
	type ReconcileOutboundWebhooksResult,
	DEFAULT_OUTBOUND_WEBHOOK_WORKER_RETENTION_MS,
} from "./outbound-webhooks";

export const OUTBOUND_WEBHOOK_POSTGRES_SCHEMA_VERSION = 3;
const POSTGRES_UUID_TYPE_OID = 2950;

export interface PostgresOutboundWebhookRepositoryOptions {
	connectionString: string;
	maxConnections?: number;
	idleTimeoutSeconds?: number;
	connectTimeoutSeconds?: number;
}

type EndpointRow = {
	id: string;
	name: string;
	url: string;
	secret_ref: string;
	event_filters: unknown;
	enabled: boolean;
	timeout_ms: number;
	max_attempts: number;
	circuit_failure_threshold: number;
	circuit_cooldown_ms: number;
	consecutive_failures?: number;
	circuit_state?: "closed" | "open";
	circuit_opened_at?: Date | string | null;
	circuit_open_until?: Date | string | null;
	last_failure_at?: Date | string | null;
	last_success_at?: Date | string | null;
	created_at: Date | string;
	updated_at: Date | string;
};

type DeliveryRow = {
	id: string;
	event_id: string;
	endpoint_id: string;
	event: unknown;
	status: OutboundWebhookDelivery["status"];
	attempt_count: number;
	manual_retry_count: number;
	next_attempt_at: Date | string;
	last_attempt_at: Date | string | null;
	completed_at: Date | string | null;
	status_code: number | null;
	last_error: string | null;
	lease_token: string | null;
	lease_expires_at: Date | string | null;
};

function toIso(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

function toOptionalIso(value: Date | string | null): string | undefined {
	return value === null ? undefined : toIso(value);
}

function toEndpoint(row: EndpointRow): OutboundWebhookEndpoint {
	return parseOutboundWebhookEndpoint({
		id: row.id,
		name: row.name,
		url: row.url,
		secretRef: row.secret_ref,
		eventFilters: row.event_filters,
		enabled: row.enabled,
		timeoutMs: row.timeout_ms,
		maxAttempts: row.max_attempts,
		circuitFailureThreshold: row.circuit_failure_threshold,
		circuitCooldownMs: row.circuit_cooldown_ms,
		createdAt: toIso(row.created_at),
		updatedAt: toIso(row.updated_at),
	});
}

function toEndpointRuntime(row: EndpointRow): OutboundWebhookEndpointRuntime {
	return {
		endpointId: row.id,
		consecutiveFailures: row.consecutive_failures ?? 0,
		circuitState: row.circuit_state ?? "closed",
		circuitOpenedAt: toOptionalIso(row.circuit_opened_at ?? null),
		circuitOpenUntil: toOptionalIso(row.circuit_open_until ?? null),
		lastFailureAt: toOptionalIso(row.last_failure_at ?? null),
		lastSuccessAt: toOptionalIso(row.last_success_at ?? null),
	};
}

function toDelivery(row: DeliveryRow): OutboundWebhookDelivery {
	return parseOutboundWebhookDelivery({
		id: row.id,
		eventId: row.event_id,
		endpointId: row.endpoint_id,
		event: parseOutboundWebhookEvent(row.event),
		status: row.status,
		attemptCount: row.attempt_count,
		manualRetryCount: row.manual_retry_count,
		nextAttemptAt: toIso(row.next_attempt_at),
		lastAttemptAt: toOptionalIso(row.last_attempt_at),
		completedAt: toOptionalIso(row.completed_at),
		statusCode: row.status_code ?? undefined,
		lastError: row.last_error ?? undefined,
		leaseToken: row.lease_token ?? undefined,
		leaseExpiresAt: toOptionalIso(row.lease_expires_at),
	});
}

function isPostgresErrorWithCode(
	error: unknown,
	code: string,
): error is Error & { code: string } {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as Error & { code?: unknown }).code === code
	);
}

function assertConnectionString(value: string): string {
	const trimmed = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new TypeError(
			"Webhook Postgres connection string must be a valid URL",
		);
	}
	if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
		throw new TypeError(
			"Webhook Postgres connection string must use postgres:// or postgresql://",
		);
	}
	return trimmed;
}

function resolvePositiveInteger(
	value: number | undefined,
	fallback: number,
	label: string,
	maximum: number,
): number {
	const resolved = value ?? fallback;
	if (!Number.isInteger(resolved) || resolved <= 0 || resolved > maximum) {
		throw new RangeError(`${label} must be between 1 and ${maximum}`);
	}
	return resolved;
}

async function initializeSchema(sql: Sql): Promise<void> {
	await sql.begin(async (transaction) => {
		await transaction`
			SELECT pg_advisory_xact_lock(
				hashtext('listmonk_ops'),
				hashtext('webhook_runtime_schema')
			)
		`;
		await transaction`
			CREATE SCHEMA IF NOT EXISTS listmonk_ops
		`;
		await transaction`
			CREATE TABLE IF NOT EXISTS listmonk_ops.webhook_runtime_meta (
				key text PRIMARY KEY,
				value text NOT NULL,
				updated_at timestamptz NOT NULL DEFAULT now()
			)
		`;
		await transaction`
			INSERT INTO listmonk_ops.webhook_runtime_meta (key, value)
			VALUES ('schema_version', '0')
			ON CONFLICT (key) DO NOTHING
		`;
		const versionRows = await transaction<{ value: string }[]>`
			SELECT value
			FROM listmonk_ops.webhook_runtime_meta
			WHERE key = 'schema_version'
		`;
		const storedVersion = Number(versionRows[0]?.value ?? Number.NaN);
		if (
			!Number.isInteger(storedVersion) ||
			storedVersion < 0 ||
			storedVersion > OUTBOUND_WEBHOOK_POSTGRES_SCHEMA_VERSION
		) {
			throw new Error(
				`Unsupported webhook Postgres schema version: ${versionRows[0]?.value ?? "missing"}`,
			);
		}
		if (storedVersion < 1) {
			await transaction`
			CREATE TABLE IF NOT EXISTS listmonk_ops.webhook_endpoints (
				id uuid PRIMARY KEY,
				name text NOT NULL,
				name_key text NOT NULL UNIQUE,
				url text NOT NULL,
				secret_ref text NOT NULL,
				event_filters jsonb NOT NULL,
				enabled boolean NOT NULL,
				timeout_ms integer NOT NULL,
				max_attempts integer NOT NULL,
				created_at timestamptz NOT NULL,
				updated_at timestamptz NOT NULL
			)
			`;
			await transaction`
			CREATE TABLE IF NOT EXISTS listmonk_ops.webhook_deliveries (
				id uuid PRIMARY KEY,
				event_id uuid NOT NULL,
				endpoint_id uuid NOT NULL,
				event jsonb NOT NULL,
				status text NOT NULL CHECK (
					status IN ('pending', 'delivering', 'retry', 'succeeded', 'exhausted')
				),
				attempt_count integer NOT NULL CHECK (attempt_count >= 0),
				manual_retry_count integer NOT NULL CHECK (manual_retry_count >= 0),
				next_attempt_at timestamptz NOT NULL,
				last_attempt_at timestamptz,
				completed_at timestamptz,
				status_code integer,
				last_error text,
				lease_token uuid,
				lease_expires_at timestamptz,
				UNIQUE (event_id, endpoint_id)
			)
			`;
			await transaction`
			CREATE INDEX IF NOT EXISTS webhook_deliveries_due_idx
			ON listmonk_ops.webhook_deliveries (
				status,
				next_attempt_at,
				lease_expires_at
			)
			`;
			await transaction`
			CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx
			ON listmonk_ops.webhook_deliveries (endpoint_id, status)
			`;
			await transaction`
			CREATE INDEX IF NOT EXISTS webhook_deliveries_completed_idx
			ON listmonk_ops.webhook_deliveries (completed_at)
			WHERE status IN ('succeeded', 'exhausted')
			`;
			await transaction`
				UPDATE listmonk_ops.webhook_runtime_meta
				SET value = '1', updated_at = now()
				WHERE key = 'schema_version'
			`;
		}
		if (storedVersion < 2) {
			await transaction`
				ALTER TABLE listmonk_ops.webhook_endpoints
				ADD COLUMN IF NOT EXISTS circuit_failure_threshold integer NOT NULL DEFAULT 5,
				ADD COLUMN IF NOT EXISTS circuit_cooldown_ms integer NOT NULL DEFAULT 300000,
				ADD COLUMN IF NOT EXISTS consecutive_failures integer NOT NULL DEFAULT 0,
				ADD COLUMN IF NOT EXISTS circuit_state text NOT NULL DEFAULT 'closed',
				ADD COLUMN IF NOT EXISTS circuit_opened_at timestamptz,
				ADD COLUMN IF NOT EXISTS circuit_open_until timestamptz,
				ADD COLUMN IF NOT EXISTS last_failure_at timestamptz,
				ADD COLUMN IF NOT EXISTS last_success_at timestamptz
			`;
			await transaction`
				CREATE TABLE IF NOT EXISTS listmonk_ops.webhook_workers (
					id uuid PRIMARY KEY,
					status text NOT NULL CHECK (status IN ('running', 'stopped', 'failed')),
					started_at timestamptz NOT NULL,
					heartbeat_at timestamptz NOT NULL,
					stopped_at timestamptz,
					last_error text,
					last_tick jsonb
				)
			`;
			await transaction`
				CREATE INDEX IF NOT EXISTS webhook_workers_heartbeat_idx
				ON listmonk_ops.webhook_workers (heartbeat_at DESC)
			`;
			await transaction`
				UPDATE listmonk_ops.webhook_runtime_meta
				SET value = '2', updated_at = now()
				WHERE key = 'schema_version'
			`;
		}
		if (storedVersion < 3) {
			await transaction`
				UPDATE listmonk_ops.webhook_endpoints
				SET
					timeout_ms = LEAST(GREATEST(timeout_ms, 100), 30000),
					max_attempts = LEAST(GREATEST(max_attempts, 1), 12),
					circuit_failure_threshold = LEAST(
						GREATEST(circuit_failure_threshold, 1),
						100
					),
					circuit_cooldown_ms = LEAST(
						GREATEST(circuit_cooldown_ms, 1000),
						86400000
					)
				WHERE
					timeout_ms NOT BETWEEN 100 AND 30000
					OR max_attempts NOT BETWEEN 1 AND 12
					OR circuit_failure_threshold NOT BETWEEN 1 AND 100
					OR circuit_cooldown_ms NOT BETWEEN 1000 AND 86400000
			`;
			await transaction`
				ALTER TABLE listmonk_ops.webhook_endpoints
					DROP CONSTRAINT IF EXISTS webhook_endpoints_timeout_ms_check,
					DROP CONSTRAINT IF EXISTS webhook_endpoints_max_attempts_check,
					DROP CONSTRAINT IF EXISTS webhook_endpoints_circuit_failure_threshold_check,
					DROP CONSTRAINT IF EXISTS webhook_endpoints_circuit_cooldown_ms_check
			`;
			await transaction`
				ALTER TABLE listmonk_ops.webhook_endpoints
					ADD CONSTRAINT webhook_endpoints_timeout_ms_check
						CHECK (timeout_ms BETWEEN 100 AND 30000),
					ADD CONSTRAINT webhook_endpoints_max_attempts_check
						CHECK (max_attempts BETWEEN 1 AND 12),
					ADD CONSTRAINT webhook_endpoints_circuit_failure_threshold_check
						CHECK (circuit_failure_threshold BETWEEN 1 AND 100),
					ADD CONSTRAINT webhook_endpoints_circuit_cooldown_ms_check
						CHECK (circuit_cooldown_ms BETWEEN 1000 AND 86400000)
			`;
			await transaction`
				UPDATE listmonk_ops.webhook_runtime_meta
				SET value = '3', updated_at = now()
				WHERE key = 'schema_version'
			`;
		}
		await transaction`
			DO $$
			BEGIN
				IF NOT EXISTS (
					SELECT 1
					FROM pg_constraint
					WHERE conname = 'webhook_endpoints_circuit_state_check'
						AND conrelid = 'listmonk_ops.webhook_endpoints'::regclass
				) THEN
					ALTER TABLE listmonk_ops.webhook_endpoints
					ADD CONSTRAINT webhook_endpoints_circuit_state_check
					CHECK (circuit_state IN ('closed', 'open'));
				END IF;
			END
			$$
		`;
	});
}

/**
 * Create a normalized Postgres endpoint/outbox repository. Schema creation is
 * lazy and idempotent so CLI and MCP processes can start concurrently.
 */
export function createPostgresOutboundWebhookRepository(
	options: PostgresOutboundWebhookRepositoryOptions,
): OutboundWebhookRepository {
	const connectionString = assertConnectionString(options.connectionString);
	const sql = postgres(connectionString, {
		max: resolvePositiveInteger(
			options.maxConnections,
			5,
			"Webhook Postgres max connections",
			20,
		),
		idle_timeout: resolvePositiveInteger(
			options.idleTimeoutSeconds,
			20,
			"Webhook Postgres idle timeout",
			300,
		),
		connect_timeout: resolvePositiveInteger(
			options.connectTimeoutSeconds,
			10,
			"Webhook Postgres connect timeout",
			60,
		),
		prepare: false,
		onnotice: () => undefined,
	});
	let initialization: Promise<void> | undefined;
	const ensureInitialized = async (): Promise<void> => {
		initialization ??= initializeSchema(sql).catch((error) => {
			initialization = undefined;
			throw error;
		});
		await initialization;
	};

	const repository: OutboundWebhookRepository = {
		kind: "postgres",

		async listEndpoints() {
			await ensureInitialized();
			const rows = await sql<EndpointRow[]>`
				SELECT
					id, name, url, secret_ref, event_filters, enabled,
					timeout_ms, max_attempts, circuit_failure_threshold,
					circuit_cooldown_ms, created_at, updated_at
				FROM listmonk_ops.webhook_endpoints
				ORDER BY created_at ASC
			`;
			return rows.map(toEndpoint);
		},

		async getEndpoint(id) {
			await ensureInitialized();
			const rows = await sql<EndpointRow[]>`
				SELECT
					id, name, url, secret_ref, event_filters, enabled,
					timeout_ms, max_attempts, circuit_failure_threshold,
					circuit_cooldown_ms, created_at, updated_at
				FROM listmonk_ops.webhook_endpoints
				WHERE id = ${id}
			`;
			const row = rows[0];
			if (!row) {
				throw new OutboundWebhookNotFoundError("endpoint", id);
			}
			return toEndpoint(row);
		},

		async createEndpoint(endpoint) {
			await ensureInitialized();
			try {
				const rows = await sql<EndpointRow[]>`
					INSERT INTO listmonk_ops.webhook_endpoints (
						id, name, name_key, url, secret_ref, event_filters, enabled,
						timeout_ms, max_attempts, circuit_failure_threshold,
						circuit_cooldown_ms, created_at, updated_at
					)
					VALUES (
						${endpoint.id},
						${endpoint.name},
						${endpoint.name.toLowerCase()},
						${endpoint.url},
						${endpoint.secretRef},
						${sql.json([...endpoint.eventFilters])},
						${endpoint.enabled},
						${endpoint.timeoutMs},
						${endpoint.maxAttempts},
						${endpoint.circuitFailureThreshold},
						${endpoint.circuitCooldownMs},
						${endpoint.createdAt},
						${endpoint.updatedAt}
					)
					RETURNING
						id, name, url, secret_ref, event_filters, enabled,
						timeout_ms, max_attempts, circuit_failure_threshold,
						circuit_cooldown_ms, created_at, updated_at
				`;
				return toEndpoint(rows[0]!);
			} catch (error) {
				if (isPostgresErrorWithCode(error, "23505")) {
					throw new OutboundWebhookConflictError(
						`Outbound webhook endpoint name already exists: ${endpoint.name}`,
					);
				}
				throw error;
			}
		},

		async updateEndpoint(id, input, now) {
			await ensureInitialized();
			try {
				return await sql.begin(async (transaction) => {
					const currentRows = await transaction<EndpointRow[]>`
						SELECT
							id, name, url, secret_ref, event_filters, enabled,
							timeout_ms, max_attempts, circuit_failure_threshold,
							circuit_cooldown_ms, created_at, updated_at
						FROM listmonk_ops.webhook_endpoints
						WHERE id = ${id}
						FOR UPDATE
					`;
					const currentRow = currentRows[0];
					if (!currentRow) {
						throw new OutboundWebhookNotFoundError("endpoint", id);
					}
					const endpoint = mergeOutboundWebhookEndpointUpdate(
						toEndpoint(currentRow),
						input,
						now,
					);
					const rows = await transaction<EndpointRow[]>`
						UPDATE listmonk_ops.webhook_endpoints
						SET
							name = ${endpoint.name},
							name_key = ${endpoint.name.toLowerCase()},
							url = ${endpoint.url},
							secret_ref = ${endpoint.secretRef},
							event_filters = ${transaction.json([...endpoint.eventFilters])},
							enabled = ${endpoint.enabled},
							timeout_ms = ${endpoint.timeoutMs},
							max_attempts = ${endpoint.maxAttempts},
							circuit_failure_threshold = ${endpoint.circuitFailureThreshold},
							circuit_cooldown_ms = ${endpoint.circuitCooldownMs},
							updated_at = ${endpoint.updatedAt}
						WHERE id = ${id}
						RETURNING
							id, name, url, secret_ref, event_filters, enabled,
							timeout_ms, max_attempts, circuit_failure_threshold,
							circuit_cooldown_ms, created_at, updated_at
					`;
					return toEndpoint(rows[0]!);
				});
			} catch (error) {
				if (isPostgresErrorWithCode(error, "23505")) {
					throw new OutboundWebhookConflictError(
						`Outbound webhook endpoint name already exists: ${input.name ?? id}`,
					);
				}
				throw error;
			}
		},

		async deleteEndpoint(id, now) {
			await ensureInitialized();
			return sql.begin(async (transaction) => {
				const rows = await transaction<EndpointRow[]>`
					SELECT
						id, name, url, secret_ref, event_filters, enabled,
						timeout_ms, max_attempts, circuit_failure_threshold,
						circuit_cooldown_ms, created_at, updated_at
					FROM listmonk_ops.webhook_endpoints
					WHERE id = ${id}
					FOR UPDATE
				`;
				const row = rows[0];
				if (!row) {
					throw new OutboundWebhookNotFoundError("endpoint", id);
				}
				await transaction`
					UPDATE listmonk_ops.webhook_deliveries
					SET
						status = 'exhausted',
						completed_at = ${now},
						last_error = 'Endpoint deleted before delivery',
						lease_token = NULL,
						lease_expires_at = NULL
					WHERE endpoint_id = ${id}
						AND status NOT IN ('succeeded', 'exhausted')
				`;
				await transaction`
					DELETE FROM listmonk_ops.webhook_endpoints
					WHERE id = ${id}
				`;
				return toEndpoint(row);
			});
		},

		async enqueue(event, enqueueOptions) {
			await ensureInitialized();
			return sql.begin(async (transaction) => {
				await transaction`
					SELECT pg_advisory_xact_lock(
						hashtext('listmonk_ops'),
						hashtext('webhook_delivery_capacity')
					)
				`;
				const endpointRows = await transaction<EndpointRow[]>`
					SELECT
						id, name, url, secret_ref, event_filters, enabled,
						timeout_ms, max_attempts, circuit_failure_threshold,
						circuit_cooldown_ms, created_at, updated_at
					FROM listmonk_ops.webhook_endpoints
					WHERE enabled = true
					ORDER BY created_at ASC
				`;
				const selected = enqueueOptions.endpointIds
					? new Set(enqueueOptions.endpointIds)
					: undefined;
				const endpoints = endpointRows
					.map(toEndpoint)
					.filter(
						(endpoint) =>
							(selected === undefined || selected.has(endpoint.id)) &&
							(enqueueOptions.bypassEventFilters === true ||
								matchesOutboundWebhookEvent(
									endpoint.eventFilters,
									event.type,
								)),
					);
				const deliveryIds: string[] = [];
				for (const endpoint of endpoints) {
					const deliveryId = randomUUID();
					const inserted = await transaction<{ id: string }[]>`
						INSERT INTO listmonk_ops.webhook_deliveries (
							id, event_id, endpoint_id, event, status,
							attempt_count, manual_retry_count, next_attempt_at
						)
						VALUES (
							${deliveryId},
							${event.id},
							${endpoint.id},
							${transaction.json(JSON.parse(JSON.stringify(event)))},
							'pending',
							0,
							0,
							${enqueueOptions.now}
						)
						ON CONFLICT (event_id, endpoint_id) DO NOTHING
						RETURNING id
					`;
					if (inserted[0]) {
						deliveryIds.push(inserted[0].id);
					}
				}

				const countRows = await transaction<{ count: string }[]>`
					SELECT count(*)::text AS count
					FROM listmonk_ops.webhook_deliveries
				`;
				const excess = Number(countRows[0]?.count ?? 0) - enqueueOptions.limit;
				if (excess > 0) {
					const deleted = await transaction<{ id: string }[]>`
						DELETE FROM listmonk_ops.webhook_deliveries
						WHERE id IN (
							SELECT id
							FROM listmonk_ops.webhook_deliveries
							WHERE status IN ('succeeded', 'exhausted')
							ORDER BY completed_at ASC NULLS FIRST
							LIMIT ${excess}
						)
						RETURNING id
					`;
					if (deleted.length < excess) {
						throw new OutboundWebhookConflictError(
							"Outbound webhook store is full of active deliveries",
						);
					}
				}
				return {
					event,
					matchedEndpoints: endpoints.length,
					queuedDeliveries: deliveryIds.length,
					duplicateDeliveries: endpoints.length - deliveryIds.length,
					deliveryIds,
				} satisfies EnqueueOutboundWebhookResult;
			});
		},

		async listDeliveries(listOptions) {
			await ensureInitialized();
			const endpointFilter =
				listOptions.endpointId === undefined
					? sql``
					: sql`AND endpoint_id = ${listOptions.endpointId}`;
			const statusFilter =
				listOptions.status === undefined
					? sql``
					: sql`AND status = ${listOptions.status}`;
			const eventTypeFilter =
				listOptions.eventType === undefined
					? sql``
					: sql`AND event ->> 'type' = ${listOptions.eventType}`;
			const limit = listOptions.limit ?? 100;
			const rows = await sql<DeliveryRow[]>`
				SELECT
					id, event_id, endpoint_id, event, status, attempt_count,
					manual_retry_count, next_attempt_at, last_attempt_at,
					completed_at, status_code, last_error, lease_token,
					lease_expires_at
				FROM listmonk_ops.webhook_deliveries
				WHERE true
				${endpointFilter}
				${statusFilter}
				${eventTypeFilter}
				ORDER BY next_attempt_at DESC
				LIMIT ${limit}
			`;
			return rows.map(toDelivery);
		},

		async retryDelivery(id, now) {
			await ensureInitialized();
			return sql.begin(async (transaction) => {
				const deliveryRows = await transaction<DeliveryRow[]>`
					SELECT
						id, event_id, endpoint_id, event, status, attempt_count,
						manual_retry_count, next_attempt_at, last_attempt_at,
						completed_at, status_code, last_error, lease_token,
						lease_expires_at
					FROM listmonk_ops.webhook_deliveries
					WHERE id = ${id}
					FOR UPDATE
				`;
				const row = deliveryRows[0];
				if (!row) {
					throw new OutboundWebhookNotFoundError("delivery", id);
				}
				if (row.status !== "retry" && row.status !== "exhausted") {
					throw new OutboundWebhookConflictError(
						`Delivery ${id} cannot be retried from status ${row.status}`,
					);
				}
				const endpointRows = await transaction<{ enabled: boolean }[]>`
					SELECT enabled
					FROM listmonk_ops.webhook_endpoints
					WHERE id = ${row.endpoint_id}
				`;
				if (endpointRows[0]?.enabled !== true) {
					throw new OutboundWebhookConflictError(
						`Delivery ${id} endpoint is missing or disabled`,
					);
				}
				const updatedRows = await transaction<DeliveryRow[]>`
					UPDATE listmonk_ops.webhook_deliveries
					SET
						status = 'pending',
						attempt_count = 0,
						manual_retry_count = manual_retry_count + 1,
						next_attempt_at = ${now},
						last_attempt_at = NULL,
						completed_at = NULL,
						status_code = NULL,
						last_error = NULL,
						lease_token = NULL,
						lease_expires_at = NULL
					WHERE id = ${id}
					RETURNING
						id, event_id, endpoint_id, event, status, attempt_count,
						manual_retry_count, next_attempt_at, last_attempt_at,
						completed_at, status_code, last_error, lease_token,
						lease_expires_at
				`;
				return toDelivery(updatedRows[0]!);
			});
		},

		async claimDeliveries(claimOptions) {
			await ensureInitialized();
			return sql.begin(async (transaction) => {
				const selectedFilter =
					claimOptions.deliveryIds === undefined
						? transaction``
						: transaction`AND id = ANY(${transaction.array([...claimOptions.deliveryIds], POSTGRES_UUID_TYPE_OID)})`;
				const excludedFilter =
					(claimOptions.excludeDeliveryIds?.length ?? 0) === 0
						? transaction``
						: transaction`AND NOT (id = ANY(${transaction.array([...(claimOptions.excludeDeliveryIds ?? [])], POSTGRES_UUID_TYPE_OID)}))`;
				const circuitFilter =
					claimOptions.bypassCircuitBreaker === true
						? transaction``
						: transaction`
							AND (
								circuit_state = 'closed'
								OR circuit_open_until IS NULL
								OR circuit_open_until <= ${claimOptions.now}
							)
						`;
				const rows = await transaction<DeliveryRow[]>`
					SELECT
						id, event_id, endpoint_id, event, status, attempt_count,
						manual_retry_count, next_attempt_at, last_attempt_at,
						completed_at, status_code, last_error, lease_token,
						lease_expires_at
					FROM listmonk_ops.webhook_deliveries
					WHERE (
						(
							status IN ('pending', 'retry')
							AND next_attempt_at <= ${claimOptions.now}
						)
						OR (
							status = 'delivering'
							AND lease_expires_at <= ${claimOptions.now}
						)
					)
					AND endpoint_id IN (
						SELECT id
						FROM listmonk_ops.webhook_endpoints
						WHERE true
							${circuitFilter}
					)
					${selectedFilter}
					${excludedFilter}
					ORDER BY next_attempt_at ASC
					FOR UPDATE SKIP LOCKED
					LIMIT ${claimOptions.limit}
				`;
				const claimed: OutboundWebhookDelivery[] = [];
				for (const row of rows) {
					const leaseToken = randomUUID();
					const leaseExpiresAt = new Date(
						claimOptions.now.getTime() + claimOptions.leaseMs,
					);
					const updatedRows = await transaction<DeliveryRow[]>`
						UPDATE listmonk_ops.webhook_deliveries
						SET
							status = 'delivering',
							attempt_count = attempt_count + 1,
							last_attempt_at = ${claimOptions.now},
							lease_token = ${leaseToken},
							lease_expires_at = ${leaseExpiresAt}
						WHERE id = ${row.id}
						RETURNING
							id, event_id, endpoint_id, event, status, attempt_count,
							manual_retry_count, next_attempt_at, last_attempt_at,
							completed_at, status_code, last_error, lease_token,
							lease_expires_at
					`;
					claimed.push(toDelivery(updatedRows[0]!));
				}
				if (claimed.length === 0) {
					return [];
				}
				const endpointRows = await transaction<EndpointRow[]>`
					SELECT
						id, name, url, secret_ref, event_filters, enabled,
						timeout_ms, max_attempts, circuit_failure_threshold,
						circuit_cooldown_ms, created_at, updated_at
					FROM listmonk_ops.webhook_endpoints
					WHERE id = ANY(${transaction.array(claimed.map((entry) => entry.endpointId), POSTGRES_UUID_TYPE_OID)})
				`;
				const endpointById = new Map(
					endpointRows.map((row) => [row.id, toEndpoint(row)] as const),
				);
				return claimed.map(
					(delivery): ClaimedOutboundWebhookDelivery => ({
						delivery,
						endpoint: endpointById.get(delivery.endpointId),
					}),
				);
			});
		},

		async completeDelivery(claimed, result, endpoint, completeOptions) {
			await ensureInitialized();
			const exhausted =
				!result.success &&
				(!result.retryable ||
					endpoint === undefined ||
					claimed.attemptCount >= endpoint.maxAttempts);
			const status: OutboundWebhookDelivery["status"] = result.success
				? "succeeded"
				: exhausted
					? "exhausted"
					: "retry";
			const nextAttemptAt =
				status === "retry"
					? new Date(
							completeOptions.now.getTime() +
								outboundWebhookRetryDelayMs(
									claimed.attemptCount,
									completeOptions.baseRetryDelayMs,
								),
						)
					: new Date(claimed.nextAttemptAt);
			const completedAt =
				status === "succeeded" || status === "exhausted"
					? completeOptions.now
					: null;
			return sql.begin(async (transaction) => {
				const rows = await transaction<DeliveryRow[]>`
					UPDATE listmonk_ops.webhook_deliveries
					SET
						status = ${status},
						next_attempt_at = ${nextAttemptAt},
						completed_at = ${completedAt},
						status_code = ${result.statusCode ?? null},
						last_error = ${
							result.error === undefined
								? null
								: truncateOutboundWebhookError(result.error)
						},
						lease_token = NULL,
						lease_expires_at = NULL
					WHERE id = ${claimed.id}
						AND status = 'delivering'
						AND lease_token = ${claimed.leaseToken ?? null}
					RETURNING
						id, event_id, endpoint_id, event, status, attempt_count,
						manual_retry_count, next_attempt_at, last_attempt_at,
						completed_at, status_code, last_error, lease_token,
						lease_expires_at
				`;
				if (!rows[0]) {
					throw new OutboundWebhookConflictError(
						`Delivery ${claimed.id} lease is no longer owned by this worker`,
					);
				}
				if (endpoint) {
					if (result.success) {
						await transaction`
							UPDATE listmonk_ops.webhook_endpoints
							SET
								consecutive_failures = 0,
								circuit_state = 'closed',
								circuit_opened_at = NULL,
								circuit_open_until = NULL,
								last_success_at = ${completeOptions.now}
							WHERE id = ${endpoint.id}
						`;
					} else if (endpoint.enabled) {
						await transaction`
							UPDATE listmonk_ops.webhook_endpoints
							SET
								consecutive_failures = consecutive_failures + 1,
								circuit_state = CASE
									WHEN consecutive_failures + 1 >= circuit_failure_threshold
									THEN 'open'
									ELSE 'closed'
								END,
								circuit_opened_at = CASE
									WHEN consecutive_failures + 1 >= circuit_failure_threshold
									THEN ${completeOptions.now}
									ELSE NULL
								END,
								circuit_open_until = CASE
									WHEN consecutive_failures + 1 >= circuit_failure_threshold
									THEN ${completeOptions.now} + circuit_cooldown_ms * interval '1 millisecond'
									ELSE NULL
								END,
								last_failure_at = ${completeOptions.now}
							WHERE id = ${endpoint.id}
						`;
					}
				}
				return toDelivery(rows[0]);
			});
		},

		async reconcile(reconcileOptions) {
			await ensureInitialized();
			return sql.begin(async (transaction) => {
				const rows = await transaction<DeliveryRow[]>`
					SELECT
						id, event_id, endpoint_id, event, status, attempt_count,
						manual_retry_count, next_attempt_at, last_attempt_at,
						completed_at, status_code, last_error, lease_token,
						lease_expires_at
					FROM listmonk_ops.webhook_deliveries
					WHERE status = 'delivering'
					ORDER BY lease_expires_at ASC NULLS FIRST
					FOR UPDATE SKIP LOCKED
					LIMIT ${reconcileOptions.limit}
				`;
				if (rows.length === 0) {
					return {
						scanned: 0,
						recovered: 0,
						exhausted: 0,
						unchanged: 0,
						dryRun: reconcileOptions.dryRun,
					} satisfies ReconcileOutboundWebhooksResult;
				}
				const endpointIds = [...new Set(rows.map((row) => row.endpoint_id))];
				const endpointRows = await transaction<{
					id: string;
					enabled: boolean;
					max_attempts: number;
				}[]>`
					SELECT id, enabled, max_attempts
					FROM listmonk_ops.webhook_endpoints
					WHERE id = ANY(${transaction.array(endpointIds, POSTGRES_UUID_TYPE_OID)})
				`;
				const endpointsById = new Map(
					endpointRows.map((row) => [
						row.id,
						{ enabled: row.enabled, maxAttempts: row.max_attempts },
					]),
				);
				let recovered = 0;
				let exhausted = 0;
				let unchanged = 0;
				for (const row of rows) {
					const expired =
						row.lease_expires_at === null ||
						new Date(row.lease_expires_at).getTime() <=
							reconcileOptions.now.getTime();
					if (!expired) {
						unchanged += 1;
						continue;
					}
					const endpoint = endpointsById.get(row.endpoint_id);
					const canRetry =
						endpoint?.enabled === true &&
						row.attempt_count < endpoint.maxAttempts;
					const lastError = outboundWebhookLeaseReconciliationError(
						canRetry,
						endpoint?.enabled === true,
					);
					if (canRetry) {
						recovered += 1;
					} else {
						exhausted += 1;
					}
					if (!reconcileOptions.dryRun) {
						await transaction`
							UPDATE listmonk_ops.webhook_deliveries
							SET
								status = ${canRetry ? "retry" : "exhausted"},
								next_attempt_at = ${reconcileOptions.now},
								completed_at = ${
									canRetry ? null : reconcileOptions.now
								},
								last_error = ${lastError},
								lease_token = NULL,
								lease_expires_at = NULL
							WHERE id = ${row.id}
						`;
					}
				}
				return {
					scanned: rows.length,
					recovered,
					exhausted,
					unchanged,
					dryRun: reconcileOptions.dryRun,
				} satisfies ReconcileOutboundWebhooksResult;
			});
		},

		async prune(pruneOptions) {
			await ensureInitialized();
			return sql.begin(async (transaction) => {
				await transaction`
					SELECT pg_advisory_xact_lock(
						hashtext('listmonk_ops'),
						hashtext('webhook_delivery_capacity')
					)
				`;
				const rows = await transaction<{ id: string }[]>`
					SELECT id
					FROM listmonk_ops.webhook_deliveries
					WHERE status IN ('succeeded', 'exhausted')
						AND completed_at < ${pruneOptions.before}
					ORDER BY completed_at ASC
					FOR UPDATE SKIP LOCKED
					LIMIT ${pruneOptions.limit}
				`;
				if (!pruneOptions.dryRun && rows.length > 0) {
					await transaction`
						DELETE FROM listmonk_ops.webhook_deliveries
						WHERE id = ANY(${transaction.array(rows.map((row) => row.id), POSTGRES_UUID_TYPE_OID)})
					`;
				}
				return {
					eligible: rows.length,
					deleted: pruneOptions.dryRun ? 0 : rows.length,
					dryRun: pruneOptions.dryRun,
					before: pruneOptions.before.toISOString(),
				} satisfies PruneOutboundWebhooksResult;
			});
		},

		async getRuntimeHealth(healthOptions) {
			await ensureInitialized();
			const staleBefore = new Date(
				healthOptions.now.getTime() - healthOptions.workerStaleMs,
			);
			const [endpointRows, deliveryRows, workerRows] = await Promise.all([
				sql<
					{
						total: number;
						enabled: number;
						circuit_open: number;
					}[]
				>`
					SELECT
						count(*)::integer AS total,
						count(*) FILTER (WHERE enabled)::integer AS enabled,
						count(*) FILTER (
							WHERE circuit_state = 'open'
								AND (
									circuit_open_until IS NULL
									OR circuit_open_until > ${healthOptions.now}
								)
						)::integer AS circuit_open
					FROM listmonk_ops.webhook_endpoints
				`,
				sql<
					{
						pending: number;
						delivering: number;
						retry: number;
						succeeded: number;
						exhausted: number;
						due: number;
						oldest_due_at: Date | string | null;
					}[]
				>`
					SELECT
						count(*) FILTER (WHERE status = 'pending')::integer AS pending,
						count(*) FILTER (WHERE status = 'delivering')::integer AS delivering,
						count(*) FILTER (WHERE status = 'retry')::integer AS retry,
						count(*) FILTER (WHERE status = 'succeeded')::integer AS succeeded,
						count(*) FILTER (WHERE status = 'exhausted')::integer AS exhausted,
						count(*) FILTER (
							WHERE (
								status IN ('pending', 'retry')
								AND next_attempt_at <= ${healthOptions.now}
							)
							OR (
								status = 'delivering'
								AND (
									lease_expires_at IS NULL
									OR lease_expires_at <= ${healthOptions.now}
								)
							)
						)::integer AS due,
						min(
							CASE
								WHEN status = 'delivering'
									THEN coalesce(lease_expires_at, last_attempt_at, next_attempt_at)
								ELSE next_attempt_at
							END
						) FILTER (
							WHERE (
								status IN ('pending', 'retry')
								AND next_attempt_at <= ${healthOptions.now}
							)
							OR (
								status = 'delivering'
								AND (
									lease_expires_at IS NULL
									OR lease_expires_at <= ${healthOptions.now}
								)
							)
						) AS oldest_due_at
					FROM listmonk_ops.webhook_deliveries
				`,
				sql<{
					running: number;
					stale: number;
					stopped: number;
					failed: number;
					last_heartbeat_at: Date | string | null;
				}[]>`
					SELECT
						count(*) FILTER (
							WHERE status = 'running'
								AND heartbeat_at >= ${staleBefore}
						)::integer AS running,
						count(*) FILTER (
							WHERE status = 'running'
								AND heartbeat_at < ${staleBefore}
						)::integer AS stale,
						count(*) FILTER (WHERE status = 'stopped')::integer AS stopped,
						count(*) FILTER (WHERE status = 'failed')::integer AS failed,
						max(heartbeat_at) FILTER (
							WHERE status = 'running'
								AND heartbeat_at >= ${staleBefore}
						) AS last_heartbeat_at
					FROM listmonk_ops.webhook_workers
				`,
			]);
			const endpoints = endpointRows[0] ?? {
				total: 0,
				enabled: 0,
				circuit_open: 0,
			};
			const deliveries = deliveryRows[0] ?? {
				pending: 0,
				delivering: 0,
				retry: 0,
				succeeded: 0,
				exhausted: 0,
				due: 0,
				oldest_due_at: null,
			};
			const workers = workerRows[0] ?? {
				running: 0,
				stale: 0,
				stopped: 0,
				failed: 0,
				last_heartbeat_at: null,
			};
			return {
				store: "postgres",
				schemaVersion: OUTBOUND_WEBHOOK_POSTGRES_SCHEMA_VERSION,
				healthy:
					endpoints.circuit_open === 0 &&
					(deliveries.due === 0 || workers.running > 0),
				checkedAt: healthOptions.now.toISOString(),
				endpoints: {
					total: endpoints.total,
					enabled: endpoints.enabled,
					circuitOpen: endpoints.circuit_open,
				},
				deliveries: {
					pending: deliveries.pending,
					delivering: deliveries.delivering,
					retry: deliveries.retry,
					succeeded: deliveries.succeeded,
					exhausted: deliveries.exhausted,
					due: deliveries.due,
					deadLetter: deliveries.exhausted,
					oldestDueAt: toOptionalIso(deliveries.oldest_due_at),
				},
				workers: {
					running: workers.running,
					stale: workers.stale,
					stopped: workers.stopped,
					failed: workers.failed,
					lastHeartbeatAt: toOptionalIso(workers.last_heartbeat_at),
				},
			};
		},

		async upsertWorker(worker) {
			await ensureInitialized();
			await sql.begin(async (transaction) => {
				await transaction`
					INSERT INTO listmonk_ops.webhook_workers (
						id, status, started_at, heartbeat_at, stopped_at,
						last_error, last_tick
					)
					VALUES (
						${worker.id},
						${worker.status},
						${worker.startedAt},
						${worker.heartbeatAt},
						${worker.stoppedAt ?? null},
						${worker.lastError ?? null},
						${
							worker.lastTick === undefined
								? null
								: transaction.json(worker.lastTick)
						}
					)
					ON CONFLICT (id) DO UPDATE
					SET
						status = EXCLUDED.status,
						started_at = EXCLUDED.started_at,
						heartbeat_at = EXCLUDED.heartbeat_at,
						stopped_at = EXCLUDED.stopped_at,
						last_error = EXCLUDED.last_error,
						last_tick = EXCLUDED.last_tick
				`;
				await transaction`
					DELETE FROM listmonk_ops.webhook_workers
					WHERE id <> ${worker.id}
						AND (
							(
								status = 'running'
								AND heartbeat_at <
									${worker.heartbeatAt}::timestamptz -
									${DEFAULT_OUTBOUND_WEBHOOK_WORKER_RETENTION_MS} * interval '1 millisecond'
							)
							OR (
								status IN ('stopped', 'failed')
								AND coalesce(stopped_at, heartbeat_at) <
									${worker.heartbeatAt}::timestamptz -
									${DEFAULT_OUTBOUND_WEBHOOK_WORKER_RETENTION_MS} * interval '1 millisecond'
							)
						)
				`;
			});
		},

		async resetEndpointCircuit(endpointId, _now) {
			await ensureInitialized();
			const rows = await sql<EndpointRow[]>`
				UPDATE listmonk_ops.webhook_endpoints
				SET
					consecutive_failures = 0,
					circuit_state = 'closed',
					circuit_opened_at = NULL,
					circuit_open_until = NULL
				WHERE id = ${endpointId}
				RETURNING
					id, name, url, secret_ref, event_filters, enabled,
					timeout_ms, max_attempts, circuit_failure_threshold,
					circuit_cooldown_ms, consecutive_failures, circuit_state,
					circuit_opened_at, circuit_open_until, last_failure_at,
					last_success_at, created_at, updated_at
			`;
			if (!rows[0]) {
				throw new OutboundWebhookNotFoundError("endpoint", endpointId);
			}
			return toEndpointRuntime(rows[0]);
		},

		async close() {
			await sql.end({ timeout: 5 });
		},
	};

	return repository;
}
