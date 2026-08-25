import { randomUUID } from "node:crypto";

const POSTGRES_UUID_TYPE_OID = 2950;
import {
	DEFAULT_TRANSACTIONAL_TTL_MS,
	TRANSACTIONAL_STORE_MAX_RECORDS,
	type StoredTransactionalDocument,
	type TransactionalClaimResult,
	type TransactionalIdempotencyStore,
	type TransactionalSendRecord,
} from "@listmonk-ops/operations";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
	DEFAULT_SEQUENCE_WORKER_RETENTION_MS,
	parsePersistedSequenceDefinition,
	parseSequenceDefinition,
	parseSequenceEnrollment,
	SequenceConflictError,
	SequenceNotFoundError,
	type ClaimedSequenceEnrollment,
	type SequenceDefinition,
	type SequenceEnrollment,
	type SequenceEnrollmentListOptions,
	type SequenceRepository,
	type SequenceRuntimeHealth,
	type UpdateSequenceDefinitionInput,
	validateSequenceSteps,
	canonicalStepsJson,
} from "./sequences";

export const SEQUENCE_POSTGRES_SCHEMA_VERSION = 2;

export interface PostgresSequenceRepositoryOptions {
	connectionString: string;
	maxConnections?: number;
	idleTimeoutSeconds?: number;
	connectTimeoutSeconds?: number;
}

type DefinitionRow = {
	id: string;
	definition: unknown;
};

type EnrollmentRow = {
	id: string;
	enrollment: unknown;
	lease_token?: string | null;
};

type DefinitionHealthRow = {
	total: number;
	active: number;
	paused: number;
};

type EnrollmentHealthRow = Record<
	| "pending"
	| "running"
	| "waiting"
	| "paused"
	| "completed"
	| "failed"
	| "ambiguous"
	| "cancelled"
	| "due"
	| "leased",
	number
> & {
	oldest_due_at: string | Date | null;
};

type WorkerHealthRow = {
	running: number;
	stale: number;
	stopped: number;
	failed: number;
	last_heartbeat_at: string | Date | null;
};

type IdempotencyRow = {
	key: string;
	payload_hash: string;
	target_hash: string;
	status: TransactionalSendRecord["status"];
	sent: boolean | null;
	error_message: string | null;
	claim_token: string;
	created_at: string | Date;
	updated_at: string | Date;
	expires_at: string | Date;
};

type ActiveEnrollmentConflictRow = {
	sequence_id: string;
	subscriber_id: string;
	enrollment_ids: string[];
};

type ActiveEnrollmentConflictCountRow = {
	count: number;
};

function assertConnectionString(value: string): string {
	const trimmed = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new TypeError(
			"Sequence Postgres connection string must be a valid URL",
		);
	}
	if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
		throw new TypeError(
			"Sequence Postgres connection string must use postgres:// or postgresql://",
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
				hashtext('sequence_runtime_schema')
			)
		`;
		await transaction`CREATE SCHEMA IF NOT EXISTS listmonk_ops`;
		await transaction`
			CREATE TABLE IF NOT EXISTS listmonk_ops.sequence_runtime_meta (
				key text PRIMARY KEY,
				value text NOT NULL,
				updated_at timestamptz NOT NULL DEFAULT now()
			)
		`;
		await transaction`
			INSERT INTO listmonk_ops.sequence_runtime_meta (key, value)
			VALUES ('schema_version', '0')
			ON CONFLICT (key) DO NOTHING
		`;
		const versionRows = await transaction<{ value: string }[]>`
			SELECT value
			FROM listmonk_ops.sequence_runtime_meta
			WHERE key = 'schema_version'
		`;
		const storedVersion = Number(versionRows[0]?.value ?? Number.NaN);
		if (
			!Number.isInteger(storedVersion) ||
			storedVersion < 0 ||
			storedVersion > SEQUENCE_POSTGRES_SCHEMA_VERSION
		) {
			throw new Error(
				`Unsupported sequence Postgres schema version: ${versionRows[0]?.value ?? "missing"}`,
			);
		}
		if (storedVersion < 1) {
			await transaction`
				CREATE TABLE IF NOT EXISTS listmonk_ops.sequence_definitions (
					id uuid PRIMARY KEY,
					name_key text NOT NULL UNIQUE,
					status text NOT NULL CHECK (status IN ('active', 'paused')),
					definition jsonb NOT NULL,
					created_at timestamptz NOT NULL,
					updated_at timestamptz NOT NULL
				)
			`;
			await transaction`
				CREATE TABLE IF NOT EXISTS listmonk_ops.sequence_enrollments (
					id uuid PRIMARY KEY,
					sequence_id uuid NOT NULL
						REFERENCES listmonk_ops.sequence_definitions(id)
						ON DELETE RESTRICT,
					revision integer NOT NULL CHECK (revision > 0),
					subscriber_id bigint NOT NULL CHECK (subscriber_id > 0),
					status text NOT NULL CHECK (
						status IN (
							'pending', 'running', 'waiting', 'paused',
							'completed', 'failed', 'ambiguous', 'cancelled'
						)
					),
					next_run_at timestamptz NOT NULL,
					lease_token uuid,
					lease_expires_at timestamptz,
					enrollment jsonb NOT NULL,
					created_at timestamptz NOT NULL,
					updated_at timestamptz NOT NULL
				)
			`;
			await transaction`
				CREATE UNIQUE INDEX IF NOT EXISTS sequence_enrollments_active_unique_idx
				ON listmonk_ops.sequence_enrollments (
					sequence_id,
					revision,
					subscriber_id
				)
				WHERE status NOT IN ('completed', 'failed', 'cancelled')
			`;
			await transaction`
				CREATE INDEX IF NOT EXISTS sequence_enrollments_due_idx
				ON listmonk_ops.sequence_enrollments (
					status,
					next_run_at,
					lease_expires_at
				)
			`;
			await transaction`
				CREATE TABLE IF NOT EXISTS listmonk_ops.sequence_workers (
					id uuid PRIMARY KEY,
					status text NOT NULL CHECK (status IN ('running', 'stopped', 'failed')),
					heartbeat_at timestamptz NOT NULL,
					worker jsonb NOT NULL
				)
			`;
			await transaction`
				CREATE INDEX IF NOT EXISTS sequence_workers_heartbeat_idx
				ON listmonk_ops.sequence_workers (heartbeat_at DESC)
			`;
			await transaction`
				UPDATE listmonk_ops.sequence_runtime_meta
				SET value = '1', updated_at = now()
				WHERE key = 'schema_version'
			`;
		}
		if (storedVersion < 2) {
			const conflictCountRows =
				await transaction<ActiveEnrollmentConflictCountRow[]>`
					SELECT count(*)::integer AS count
					FROM (
						SELECT 1
						FROM listmonk_ops.sequence_enrollments
						WHERE status NOT IN ('completed', 'failed', 'cancelled')
						GROUP BY sequence_id, subscriber_id
						HAVING count(*) > 1
					) AS conflicts
				`;
			const conflictCount = conflictCountRows[0]?.count ?? 0;
			const conflicts = await transaction<ActiveEnrollmentConflictRow[]>`
				SELECT
					sequence_id::text AS sequence_id,
					subscriber_id::text AS subscriber_id,
					array_agg(id::text ORDER BY created_at, id) AS enrollment_ids
				FROM listmonk_ops.sequence_enrollments
				WHERE status NOT IN ('completed', 'failed', 'cancelled')
				GROUP BY sequence_id, subscriber_id
				HAVING count(*) > 1
				ORDER BY sequence_id, subscriber_id
				LIMIT 10
			`;
			if (conflicts.length > 0) {
				const details = conflicts
					.map(
						(conflict) =>
							`sequence=${conflict.sequence_id}, subscriber=${conflict.subscriber_id}, enrollments=${conflict.enrollment_ids.join(",")}`,
					)
					.join("; ");
				throw new Error(
					"Cannot migrate sequence Postgres schema to version 2 because duplicate active enrollments exist across revisions. " +
						`Resolve all but one active enrollment for each sequence/subscriber pair and retry. ` +
						`Conflicts (showing first ${conflicts.length} of ${conflictCount}): ${details}`,
				);
			}
			await transaction`
				DROP INDEX IF EXISTS
					listmonk_ops.sequence_enrollments_active_unique_idx
			`;
			await transaction`
				CREATE UNIQUE INDEX sequence_enrollments_active_unique_idx
				ON listmonk_ops.sequence_enrollments (
					sequence_id,
					subscriber_id
				)
				WHERE status NOT IN ('completed', 'failed', 'cancelled')
			`;
			await transaction`
				CREATE TABLE IF NOT EXISTS
					listmonk_ops.sequence_idempotency_records (
						key text PRIMARY KEY,
						payload_hash text NOT NULL,
						target_hash text NOT NULL,
						status text NOT NULL CHECK (
							status IN ('pending', 'accepted', 'failed', 'unknown')
						),
						sent boolean,
						error_message text,
						claim_token uuid NOT NULL,
						created_at timestamptz NOT NULL,
						updated_at timestamptz NOT NULL,
						expires_at timestamptz NOT NULL,
						CHECK (status <> 'accepted' OR sent IS TRUE),
						CHECK (status <> 'failed' OR sent IS DISTINCT FROM TRUE)
					)
			`;
			await transaction`
				CREATE INDEX IF NOT EXISTS sequence_idempotency_expiry_idx
				ON listmonk_ops.sequence_idempotency_records (expires_at)
			`;
			await transaction`
				UPDATE listmonk_ops.sequence_runtime_meta
				SET value = '2', updated_at = now()
				WHERE key = 'schema_version'
			`;
		}
		// Idempotent and unversioned so existing deployments pick it up on
		// the next start: the guarded-enrollment generation lookup counts
		// and selects the newest record per (sequence, subscriber) pair
		// across ALL statuses, which the partial active index and the
		// status-led due index cannot serve.
		await transaction`
			CREATE INDEX IF NOT EXISTS sequence_enrollments_generation_idx
			ON listmonk_ops.sequence_enrollments (
				sequence_id,
				subscriber_id,
				created_at DESC
			)
		`;
	});
}

function toDefinition(row: DefinitionRow): SequenceDefinition {
	return parsePersistedSequenceDefinition(row.definition);
}

function toEnrollment(row: EnrollmentRow): SequenceEnrollment {
	return parseSequenceEnrollment(row.enrollment);
}

function isUniqueViolation(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as Error & { code?: unknown }).code === "23505"
	);
}

function withoutLease(
	enrollment: SequenceEnrollment,
): Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt"> {
	const {
		leaseToken: _leaseToken,
		leaseExpiresAt: _leaseExpiresAt,
		...rest
	} = enrollment;
	return rest;
}

function optionalTimestamp(value: string | Date | null): string | undefined {
	if (value === null) {
		return undefined;
	}
	const date = value instanceof Date ? value : new Date(value);
	return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function requiredTimestamp(value: string | Date): string {
	const date = value instanceof Date ? value : new Date(value);
	if (!Number.isFinite(date.getTime())) {
		throw new Error(`Invalid timestamp returned by Postgres: ${String(value)}`);
	}
	return date.toISOString();
}

function toIdempotencyRecord(row: IdempotencyRow): TransactionalSendRecord {
	return {
		key: row.key,
		payloadHash: row.payload_hash,
		targetHash: row.target_hash,
		status: row.status,
		sent: row.sent ?? undefined,
		errorMessage: row.error_message ?? undefined,
		claimToken: row.claim_token,
		createdAt: requiredTimestamp(row.created_at),
		updatedAt: requiredTimestamp(row.updated_at),
		expiresAt: requiredTimestamp(row.expires_at),
	};
}

function normalizeCommittedSent(
	status: TransactionalSendRecord["status"],
	sent: boolean | undefined,
): boolean | undefined {
	if (status === "accepted") {
		return true;
	}
	if (status === "failed" && sent === true) {
		return false;
	}
	return sent;
}

async function lockIdempotencyStore(
	transaction: TransactionSql,
): Promise<void> {
	await transaction`
		SELECT pg_advisory_xact_lock(
			hashtext('listmonk_ops'),
			hashtext('sequence_idempotency')
		)
	`;
}

async function sweepExpiredIdempotencyRecords(
	transaction: TransactionSql,
	now: Date,
): Promise<void> {
	await transaction`
		DELETE FROM listmonk_ops.sequence_idempotency_records
		WHERE expires_at < ${now}
	`;
}

function createPostgresTransactionalIdempotencyStore(
	sql: Sql,
	ready: () => Promise<void>,
): TransactionalIdempotencyStore {
	return {
		async claim(options): Promise<TransactionalClaimResult> {
			await ready();
			const ttlMs = options.ttlMs ?? DEFAULT_TRANSACTIONAL_TTL_MS;
			if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
				throw new RangeError("Transactional idempotency TTL must be positive");
			}
			const now = (options.now ?? (() => new Date()))();
			return sql.begin(async (transaction) => {
				await lockIdempotencyStore(transaction);
				await sweepExpiredIdempotencyRecords(transaction, now);
				const existingRows = await transaction<IdempotencyRow[]>`
					SELECT *
					FROM listmonk_ops.sequence_idempotency_records
					WHERE key = ${options.key}
				`;
				const existingRow = existingRows[0];
				if (existingRow) {
					const existing = toIdempotencyRecord(existingRow);
					return existing.payloadHash === options.payloadHash &&
						existing.targetHash === options.targetHash
						? { kind: "replay", record: existing }
						: { kind: "conflict", existing };
				}
				const countRows = await transaction<{ count: number }[]>`
					SELECT count(*)::integer AS count
					FROM listmonk_ops.sequence_idempotency_records
				`;
				if ((countRows[0]?.count ?? 0) >= TRANSACTIONAL_STORE_MAX_RECORDS) {
					throw new Error(
						`Transactional idempotency store reached its ${TRANSACTIONAL_STORE_MAX_RECORDS}-record capacity`,
					);
				}
				const createdAt = now.toISOString();
				const record: TransactionalSendRecord = {
					key: options.key,
					payloadHash: options.payloadHash,
					targetHash: options.targetHash,
					status: "pending",
					claimToken: randomUUID(),
					createdAt,
					updatedAt: createdAt,
					expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
				};
				await transaction`
					INSERT INTO listmonk_ops.sequence_idempotency_records (
						key, payload_hash, target_hash, status, sent,
						error_message, claim_token, created_at, updated_at, expires_at
					)
					VALUES (
						${record.key},
						${record.payloadHash},
						${record.targetHash},
						${record.status},
						NULL,
						NULL,
						${record.claimToken},
						${record.createdAt},
						${record.updatedAt},
						${record.expiresAt}
					)
				`;
				return { kind: "new", record };
			});
		},
		async commit(options): Promise<void> {
			await ready();
			const now = (options.now ?? (() => new Date()))();
			await sql.begin(async (transaction) => {
				await lockIdempotencyStore(transaction);
				await sweepExpiredIdempotencyRecords(transaction, now);
				const rows = await transaction<IdempotencyRow[]>`
					SELECT *
					FROM listmonk_ops.sequence_idempotency_records
					WHERE key = ${options.key}
				`;
				const existing = rows[0];
				if (!existing || existing.claim_token !== options.claimToken) {
					return;
				}
				const sent = normalizeCommittedSent(options.status, options.sent);
				await transaction`
					UPDATE listmonk_ops.sequence_idempotency_records
					SET
						status = ${options.status},
						sent = ${sent ?? null},
						error_message = ${options.errorMessage ?? null},
						updated_at = ${now}
					WHERE key = ${options.key}
						AND claim_token = ${options.claimToken}
				`;
			});
		},
		async release(options): Promise<void> {
			await ready();
			const now = (options.now ?? (() => new Date()))();
			await sql.begin(async (transaction) => {
				await lockIdempotencyStore(transaction);
				await sweepExpiredIdempotencyRecords(transaction, now);
				await transaction`
					DELETE FROM listmonk_ops.sequence_idempotency_records
					WHERE key = ${options.key}
						AND claim_token = ${options.claimToken}
				`;
			});
		},
		async load(): Promise<StoredTransactionalDocument> {
			await ready();
			// Deliberately preserve expired records for read-only diagnostics and
			// ambiguous-send reconciliation. Mutating paths sweep them under the
			// shared advisory lock, matching the file-backed store contract.
			const rows = await sql<IdempotencyRow[]>`
				SELECT *
				FROM listmonk_ops.sequence_idempotency_records
			`;
			const records: Record<string, TransactionalSendRecord> = {};
			for (const row of rows) {
				const record = toIdempotencyRecord(row);
				records[record.key] = record;
			}
			return { version: 1, records };
		},
	};
}

export function createPostgresSequenceRepository(
	options: PostgresSequenceRepositoryOptions,
): SequenceRepository {
	const connectionString = assertConnectionString(options.connectionString);
	const sql = postgres(connectionString, {
		max: resolvePositiveInteger(
			options.maxConnections,
			5,
			"maxConnections",
			50,
		),
		idle_timeout: resolvePositiveInteger(
			options.idleTimeoutSeconds,
			20,
			"idleTimeoutSeconds",
			600,
		),
		connect_timeout: resolvePositiveInteger(
			options.connectTimeoutSeconds,
			10,
			"connectTimeoutSeconds",
			120,
		),
	});
	let initialization: Promise<void> | undefined;
	const ready = (): Promise<void> => {
		initialization ??= initializeSchema(sql).catch((error) => {
			initialization = undefined;
			throw error;
		});
		return initialization;
	};

	const getDefinition = async (id: string): Promise<SequenceDefinition> => {
		await ready();
		const rows = await sql<DefinitionRow[]>`
			SELECT id, definition
			FROM listmonk_ops.sequence_definitions
			WHERE id = ${id}::uuid
		`;
		const row = rows[0];
		if (!row) {
			throw new SequenceNotFoundError("definition", id);
		}
		return toDefinition(row);
	};

	const getEnrollment = async (id: string): Promise<SequenceEnrollment> => {
		await ready();
		const rows = await sql<EnrollmentRow[]>`
			SELECT id, enrollment, lease_token
			FROM listmonk_ops.sequence_enrollments
			WHERE id = ${id}::uuid
		`;
		const row = rows[0];
		if (!row) {
			throw new SequenceNotFoundError("enrollment", id);
		}
		return toEnrollment(row);
	};

	return {
		kind: "postgres",
		idempotencyStore: createPostgresTransactionalIdempotencyStore(sql, ready),
		async listDefinitions() {
			await ready();
			const rows = await sql<DefinitionRow[]>`
				SELECT id, definition
				FROM listmonk_ops.sequence_definitions
				ORDER BY created_at ASC, id ASC
			`;
			return rows.map(toDefinition);
		},
		getDefinition,
		async createDefinition(definition) {
			const validatedDefinition = parseSequenceDefinition(definition);
			await ready();
			try {
				await sql`
					INSERT INTO listmonk_ops.sequence_definitions (
						id, name_key, status, definition, created_at, updated_at
					)
					VALUES (
						${validatedDefinition.id}::uuid,
						${validatedDefinition.name.toLowerCase()},
						${validatedDefinition.status},
						${sql.json(validatedDefinition as never)},
						${validatedDefinition.createdAt}::timestamptz,
						${validatedDefinition.updatedAt}::timestamptz
					)
				`;
			} catch (error) {
				if (isUniqueViolation(error)) {
					throw new SequenceConflictError(
						`Sequence ID or name already exists: ${validatedDefinition.name}`,
					);
				}
				throw error;
			}
			return validatedDefinition;
		},
		async updateDefinition(id, input, now) {
			await ready();
			return sql.begin(async (transaction) => {
				const rows = await transaction<DefinitionRow[]>`
					SELECT id, definition
					FROM listmonk_ops.sequence_definitions
					WHERE id = ${id}::uuid
					FOR UPDATE
				`;
				const row = rows[0];
				if (!row) {
					throw new SequenceNotFoundError("definition", id);
				}
				const previous = toDefinition(row);
				const steps = validateSequenceSteps(input.steps);
				// An identical update is already applied when the resolved
				// name and description match and the latest revision carries
				// the requested steps: repeating it is a documented no-op.
				const latestRevision = [...previous.revisions]
					.sort((left, right) => right.revision - left.revision)
					.at(0);
				const alreadyApplied =
					(input.name === undefined || previous.name === input.name) &&
					(input.description === undefined ||
						(previous.description ?? undefined) ===
							(input.description ?? undefined)) &&
					latestRevision !== undefined &&
					canonicalStepsJson(latestRevision.steps) ===
						canonicalStepsJson(steps);
				if (alreadyApplied) {
					return { definition: previous, updated: false };
				}
				const revision = previous.currentRevision + 1;
				const updated = parsePersistedSequenceDefinition({
					...previous,
					name: input.name ?? previous.name,
					description: input.description ?? previous.description,
					currentRevision: revision,
					revisions: [
						...previous.revisions,
						{
							revision,
							steps,
							createdAt: now.toISOString(),
						},
					],
					updatedAt: now.toISOString(),
				});
				try {
					await transaction`
						UPDATE listmonk_ops.sequence_definitions
						SET
							name_key = ${updated.name.toLowerCase()},
							status = ${updated.status},
							definition = ${transaction.json(updated as never)},
							updated_at = ${updated.updatedAt}::timestamptz
						WHERE id = ${id}::uuid
					`;
				} catch (error) {
					if (isUniqueViolation(error)) {
						throw new SequenceConflictError(
							`Sequence name already exists: ${updated.name}`,
						);
					}
					throw error;
				}
				return { definition: updated, updated: true };
			});
		},
		async deleteDefinition(id) {
			await ready();
			return sql.begin(async (transaction) => {
				const definitionRows = await transaction<DefinitionRow[]>`
					SELECT id, definition
					FROM listmonk_ops.sequence_definitions
					WHERE id = ${id}::uuid
					FOR UPDATE
				`;
				const definitionRow = definitionRows[0];
				if (!definitionRow) {
					throw new SequenceNotFoundError("definition", id);
				}
				const definition = toDefinition(definitionRow);
				const activeRows = await transaction<{ id: string }[]>`
					SELECT id
					FROM listmonk_ops.sequence_enrollments
					WHERE sequence_id = ${id}::uuid
						AND status NOT IN ('completed', 'failed', 'cancelled')
					LIMIT 1
				`;
				if (activeRows.length > 0) {
					throw new SequenceConflictError(
						`Sequence ${id} still has non-terminal enrollments`,
					);
				}
				await transaction`
					DELETE FROM listmonk_ops.sequence_enrollments
					WHERE sequence_id = ${id}::uuid
				`;
				await transaction`
					DELETE FROM listmonk_ops.sequence_definitions
					WHERE id = ${id}::uuid
				`;
				return definition;
			});
		},
		async setDefinitionStatus(id, status, now) {
			await ready();
			return sql.begin(async (transaction) => {
				const definitionRows = await transaction<DefinitionRow[]>`
					SELECT id, definition
					FROM listmonk_ops.sequence_definitions
					WHERE id = ${id}::uuid
					FOR UPDATE
				`;
				const definitionRow = definitionRows[0];
				if (!definitionRow) {
					throw new SequenceNotFoundError("definition", id);
				}
				const previous = toDefinition(definitionRow);
				// Short-circuit when the definition is already in the target
				// status so a pause/resume retry is a true no-op and does not
				// advance updatedAt, matching the spec's allowNoopFromTarget.
				if (previous.status === status) {
					return previous;
				}
				const updated = parsePersistedSequenceDefinition({
					...previous,
					status,
					updatedAt: now.toISOString(),
				});
				await transaction`
					UPDATE listmonk_ops.sequence_definitions
					SET
						status = ${status},
						definition = ${transaction.json(updated as never)},
						updated_at = ${updated.updatedAt}::timestamptz
					WHERE id = ${id}::uuid
				`;
				return updated;
			});
		},
		async listEnrollments(options: SequenceEnrollmentListOptions = {}) {
			await ready();
			const limit = Math.min(1_000, Math.max(1, options.limit ?? 100));
			const statuses = options.status
				? [options.status]
				: [
						"pending",
						"running",
						"waiting",
						"paused",
						"completed",
						"failed",
						"ambiguous",
						"cancelled",
					];
			const sequenceIds = options.sequenceId
				? [options.sequenceId]
				: undefined;
			const subscriberIds = options.subscriberId
				? [options.subscriberId]
				: undefined;
			const rows = await sql<EnrollmentRow[]>`
				SELECT id, enrollment, lease_token
				FROM listmonk_ops.sequence_enrollments
				WHERE status IN ${sql(statuses)}
					AND (
						${sequenceIds === undefined}
						OR sequence_id IN ${sql(sequenceIds ?? [randomUUID()])}
					)
					AND (
						${subscriberIds === undefined}
						OR subscriber_id IN ${sql(subscriberIds ?? [-1])}
					)
				ORDER BY created_at ASC, id ASC
				LIMIT ${limit}
			`;
			return rows.map(toEnrollment);
		},
		getEnrollment,
		async readEnrollmentGeneration(listOptions) {
			await ready();
			return sql.begin(async (transaction) => {
				// The same pair-keyed advisory lock as guarded creates: the
				// generation observation cannot interleave with one.
				await transaction`
					SELECT pg_advisory_xact_lock(
						hashtext((${listOptions.sequenceId}::uuid)::text),
						hashtext(${listOptions.subscriberId.toString()})
					)
				`;
				const countRows = await transaction<{ count: string }[]>`
					SELECT count(*)::text AS count
					FROM listmonk_ops.sequence_enrollments
					WHERE sequence_id = ${listOptions.sequenceId}::uuid
						AND subscriber_id = ${listOptions.subscriberId}
				`;
				const newestRows = await transaction<EnrollmentRow[]>`
					SELECT id, enrollment
					FROM listmonk_ops.sequence_enrollments
					WHERE sequence_id = ${listOptions.sequenceId}::uuid
						AND subscriber_id = ${listOptions.subscriberId}
					ORDER BY created_at DESC
					LIMIT 1
				`;
				return {
					total: Number(countRows[0]?.count ?? 0),
					newest: newestRows[0] ? toEnrollment(newestRows[0]) : undefined,
				};
			});
		},
		async createEnrollment(enrollment, options) {
			await ready();
			try {
				await sql.begin(async (transaction) => {
					if (options?.expectedPriorEnrollments !== undefined) {
						// Serialize guarded creates per (sequence, subscriber)
						// pair: without the advisory lock two overlapping
						// transactions can both pass the count check when the
						// first commit's enrollment skips the partial
						// active-enrollment unique index (it went terminal).
						await transaction`
							SELECT pg_advisory_xact_lock(
								hashtext((${enrollment.sequenceId}::uuid)::text),
								hashtext(${enrollment.subscriberId.toString()})
							)
						`;
						const countRows = await transaction<{ count: string }[]>`
							SELECT count(*)::text AS count
							FROM listmonk_ops.sequence_enrollments
							WHERE sequence_id = ${enrollment.sequenceId}::uuid
								AND subscriber_id = ${enrollment.subscriberId}
						`;
						const priorCount = Number(countRows[0]?.count ?? 0);
						if (priorCount !== options.expectedPriorEnrollments) {
							throw new SequenceConflictError(
								`Subscriber ${enrollment.subscriberId} has ${priorCount} prior enrollments for sequence ${enrollment.sequenceId}, but the request guarded on exactly ${options.expectedPriorEnrollments}; resolve via sequences.enrollments.list before enrolling`,
							);
						}
					}
					await transaction`
						INSERT INTO listmonk_ops.sequence_enrollments (
							id, sequence_id, revision, subscriber_id, status,
							next_run_at, lease_token, lease_expires_at, enrollment,
							created_at, updated_at
						)
						VALUES (
							${enrollment.id}::uuid,
							${enrollment.sequenceId}::uuid,
							${enrollment.revision},
							${enrollment.subscriberId},
							${enrollment.status},
							${enrollment.nextRunAt}::timestamptz,
							NULL,
							NULL,
							${transaction.json(enrollment as never)},
							${enrollment.createdAt}::timestamptz,
							${enrollment.updatedAt}::timestamptz
						)
					`;
				});
			} catch (error) {
				if (isUniqueViolation(error)) {
					throw new SequenceConflictError(
						`Subscriber ${enrollment.subscriberId} already has an active enrollment for sequence ${enrollment.sequenceId}`,
					);
				}
				throw error;
			}
			return enrollment;
		},
		async claimDue(options) {
			await ready();
			return sql.begin(async (transaction) => {
				const rows = await transaction<
					(EnrollmentRow & { definition: unknown })[]
				>`
					SELECT e.id, e.enrollment, e.lease_token, d.definition
					FROM listmonk_ops.sequence_enrollments e
					JOIN listmonk_ops.sequence_definitions d
						ON d.id = e.sequence_id
					WHERE e.status IN ('pending', 'running', 'waiting')
						AND e.next_run_at <= ${options.now.toISOString()}::timestamptz
						AND (
							e.lease_expires_at IS NULL
							OR e.lease_expires_at <= ${options.now.toISOString()}::timestamptz
						)
						AND d.status = 'active'
					ORDER BY e.next_run_at ASC
					FOR UPDATE OF e SKIP LOCKED
					LIMIT ${options.limit}
				`;
				const claimed: ClaimedSequenceEnrollment[] = [];
				for (const row of rows) {
					const definition = parsePersistedSequenceDefinition(
						row.definition,
					);
					const enrollment = toEnrollment(row);
					const revision = definition.revisions.find(
						(candidate) => candidate.revision === enrollment.revision,
					);
					if (!revision) {
						continue;
					}
					const leased = parseSequenceEnrollment({
						...enrollment,
						status: "running",
						leaseToken: randomUUID(),
						leaseExpiresAt: new Date(
							options.now.getTime() + options.leaseMs,
						).toISOString(),
						updatedAt: options.now.toISOString(),
					});
					await transaction`
						UPDATE listmonk_ops.sequence_enrollments
						SET
							status = ${leased.status},
							lease_token = ${leased.leaseToken ?? null}::uuid,
							lease_expires_at = ${leased.leaseExpiresAt ?? null}::timestamptz,
							enrollment = ${transaction.json(leased as never)},
							updated_at = ${leased.updatedAt}::timestamptz
						WHERE id = ${leased.id}::uuid
					`;
					claimed.push({ enrollment: leased, definition, revision });
				}
				return claimed;
			});
		},
				async claimSpecific(options) {
			await ready();
			return sql.begin(async (transaction) => {
				const claimed: ClaimedSequenceEnrollment[] = [];
				// Deterministic order (plus dedupe) so concurrent recovery
				// requests with overlapping sets cannot deadlock.
				const requests = [
					...new Map(
						options.claims.map((request) => [request.id, request]),
					).values(),
				].sort((left, right) => left.id.localeCompare(right.id));
				for (const requested of requests) {
					const rows = await transaction<
						(EnrollmentRow & { definition: unknown })[]
					>`
						SELECT e.id, e.enrollment, e.lease_token, d.definition
						FROM listmonk_ops.sequence_enrollments e
						JOIN listmonk_ops.sequence_definitions d
							ON d.id = e.sequence_id
						WHERE e.id = ${requested.id}::uuid
						FOR UPDATE OF e
					`;
					const row = rows[0];
					if (!row) {
						throw new Error(
							`Sequence enrollment ${requested.id} from the echoed claim set no longer exists`,
						);
					}
					const definition = parsePersistedSequenceDefinition(
						row.definition,
					);
					const enrollment = toEnrollment(row);
					// Bind recovery to the originally claimed step: an
					// enrollment that already advanced executes a different
					// step now, so it must be skipped, not re-executed.
					if (enrollment.currentStepId !== requested.stepId) {
						continue;
					}
					if (
						!["pending", "running", "waiting"].includes(enrollment.status) ||
						Date.parse(enrollment.nextRunAt) > options.now.getTime() ||
						(enrollment.leaseExpiresAt !== undefined &&
							Date.parse(enrollment.leaseExpiresAt) > options.now.getTime()) ||
						definition.status !== "active"
					) {
						continue;
					}
					const revision = definition.revisions.find(
						(candidate) => candidate.revision === enrollment.revision,
					);
					if (!revision) {
						continue;
					}
					const leased = parseSequenceEnrollment({
						...enrollment,
						status: "running",
						leaseToken: randomUUID(),
						leaseExpiresAt: new Date(
							options.now.getTime() + options.leaseMs,
						).toISOString(),
						updatedAt: options.now.toISOString(),
					});
					await transaction`
						UPDATE listmonk_ops.sequence_enrollments
						SET
							status = ${leased.status},
							lease_token = ${leased.leaseToken ?? null}::uuid,
							lease_expires_at = ${leased.leaseExpiresAt ?? null}::timestamptz,
							enrollment = ${transaction.json(leased as never)},
							updated_at = ${leased.updatedAt}::timestamptz
						WHERE id = ${leased.id}::uuid
					`;
					claimed.push({ enrollment: leased, definition, revision });
				}
				return claimed;
			});
		},
		async completeClaim(enrollment, next) {
			await ready();
			const completed = parseSequenceEnrollment(next);
			const rows = await sql<EnrollmentRow[]>`
				UPDATE listmonk_ops.sequence_enrollments
				SET
					status = ${completed.status},
					next_run_at = ${completed.nextRunAt}::timestamptz,
					lease_token = NULL,
					lease_expires_at = NULL,
					enrollment = ${sql.json(completed as never)},
					updated_at = ${completed.updatedAt}::timestamptz
				WHERE id = ${completed.id}::uuid
					AND lease_token = ${enrollment.leaseToken ?? null}::uuid
				RETURNING id, enrollment, lease_token
			`;
			const row = rows[0];
			if (!row) {
				throw new SequenceConflictError(
					`Sequence enrollment lease was lost: ${enrollment.id}`,
				);
			}
			return toEnrollment(row);
		},
		async resolveAmbiguous(enrollment, next) {
			await ready();
			const resolved = parseSequenceEnrollment(next);
			const rows = await sql<EnrollmentRow[]>`
				UPDATE listmonk_ops.sequence_enrollments
				SET
					status = ${resolved.status},
					next_run_at = ${resolved.nextRunAt}::timestamptz,
					lease_token = NULL,
					lease_expires_at = NULL,
					enrollment = ${sql.json(resolved as never)},
					updated_at = ${resolved.updatedAt}::timestamptz
				WHERE id = ${resolved.id}::uuid
					AND status = 'ambiguous'
					AND updated_at = ${enrollment.updatedAt}::timestamptz
				RETURNING id, enrollment, lease_token
			`;
			const row = rows[0];
			if (!row) {
				throw new SequenceConflictError(
					`Sequence enrollment changed before reconciliation: ${enrollment.id}`,
				);
			}
			return toEnrollment(row);
		},
		async reconcile(options) {
			await ready();
			return sql.begin(async (transaction) => {
				const boundedFilter =
					options.enrollmentIds === undefined
						? sql``
						: options.enrollmentIds.length === 0
							? sql`AND false`
							: sql`AND id = ANY(${transaction.array(
										[...options.enrollmentIds],
										POSTGRES_UUID_TYPE_OID,
									)})`;
				const rows = await transaction<EnrollmentRow[]>`
					SELECT id, enrollment, lease_token
					FROM listmonk_ops.sequence_enrollments
					WHERE lease_expires_at IS NOT NULL
						AND lease_expires_at <= ${options.now.toISOString()}::timestamptz
						AND status NOT IN ('completed', 'failed', 'cancelled')
						${boundedFilter}
					ORDER BY lease_expires_at ASC
					FOR UPDATE SKIP LOCKED
					LIMIT ${options.enrollmentIds === undefined
						? options.limit
						: Math.max(options.limit, options.enrollmentIds.length)}
				`;
				if (!options.dryRun) {
					for (const row of rows) {
						const enrollment = toEnrollment(row);
						const recovered = parseSequenceEnrollment({
							...withoutLease(enrollment),
							status: "pending",
							nextRunAt: options.now.toISOString(),
							updatedAt: options.now.toISOString(),
						});
						await transaction`
							UPDATE listmonk_ops.sequence_enrollments
							SET
								status = 'pending',
								next_run_at = ${recovered.nextRunAt}::timestamptz,
								lease_token = NULL,
								lease_expires_at = NULL,
								enrollment = ${transaction.json(recovered as never)},
								updated_at = ${recovered.updatedAt}::timestamptz
							WHERE id = ${recovered.id}::uuid
						`;
					}
				}
				return {
					scannedIds: rows.map((row) => row.id),
					scanned: rows.length,
					recovered: rows.length,
					unchanged: 0,
					dryRun: options.dryRun,
				};
			});
		},
		async getRuntimeHealth(options): Promise<SequenceRuntimeHealth> {
			await ready();
			const nowIso = options.now.toISOString();
			const dueCondition = sql`
				status IN ('pending', 'running', 'waiting')
				AND next_run_at <= ${nowIso}::timestamptz
				AND (
					lease_expires_at IS NULL
					OR lease_expires_at <= ${nowIso}::timestamptz
				)
			`;
			const [definitionRows, enrollmentRows, workerRows] = await Promise.all([
				sql<DefinitionHealthRow[]>`
					SELECT
						count(*)::int AS total,
						count(*) FILTER (WHERE status = 'active')::int AS active,
						count(*) FILTER (WHERE status = 'paused')::int AS paused
					FROM listmonk_ops.sequence_definitions
				`,
				sql<EnrollmentHealthRow[]>`
					SELECT
						count(*) FILTER (WHERE status = 'pending')::int AS pending,
						count(*) FILTER (WHERE status = 'running')::int AS running,
						count(*) FILTER (WHERE status = 'waiting')::int AS waiting,
						count(*) FILTER (WHERE status = 'paused')::int AS paused,
						count(*) FILTER (WHERE status = 'completed')::int AS completed,
						count(*) FILTER (WHERE status = 'failed')::int AS failed,
						count(*) FILTER (WHERE status = 'ambiguous')::int AS ambiguous,
						count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
						count(*) FILTER (WHERE ${dueCondition})::int AS due,
						count(*) FILTER (
							WHERE lease_expires_at > ${nowIso}::timestamptz
						)::int AS leased,
						min(next_run_at) FILTER (WHERE ${dueCondition}) AS oldest_due_at
					FROM listmonk_ops.sequence_enrollments
				`,
				sql<WorkerHealthRow[]>`
					SELECT
						count(*) FILTER (WHERE status = 'running')::int AS running,
						count(*) FILTER (
							WHERE status = 'running'
								AND heartbeat_at <
									${nowIso}::timestamptz -
									${options.workerStaleMs} * interval '1 millisecond'
						)::int AS stale,
						count(*) FILTER (WHERE status = 'stopped')::int AS stopped,
						count(*) FILTER (WHERE status = 'failed')::int AS failed,
						max(heartbeat_at) AS last_heartbeat_at
					FROM listmonk_ops.sequence_workers
				`,
			]);
			const definitions = definitionRows[0] ?? {
				total: 0,
				active: 0,
				paused: 0,
			};
			const enrollments = enrollmentRows[0] ?? {
				pending: 0,
				running: 0,
				waiting: 0,
				paused: 0,
				completed: 0,
				failed: 0,
				ambiguous: 0,
				cancelled: 0,
				due: 0,
				leased: 0,
				oldest_due_at: null,
			};
			const workers = workerRows[0] ?? {
				running: 0,
				stale: 0,
				stopped: 0,
				failed: 0,
				last_heartbeat_at: null,
			};
			const {
				oldest_due_at: oldestDueAt,
				...enrollmentCounts
			} = enrollments;
			return {
				store: "postgres",
				schemaVersion: SEQUENCE_POSTGRES_SCHEMA_VERSION,
				healthy:
					workers.stale === 0 &&
					(enrollments.due === 0 ||
						workers.running > workers.stale),
				checkedAt: nowIso,
				definitions,
				enrollments: {
					...enrollmentCounts,
					oldestDueAt: optionalTimestamp(oldestDueAt),
				},
				workers: {
					running: workers.running,
					stale: workers.stale,
					stopped: workers.stopped,
					failed: workers.failed,
					lastHeartbeatAt: optionalTimestamp(workers.last_heartbeat_at),
				},
			};
		},
		async upsertWorker(worker) {
			await ready();
			await sql.begin(async (transaction) => {
				await transaction`
					INSERT INTO listmonk_ops.sequence_workers (
						id, status, heartbeat_at, worker
					)
					VALUES (
						${worker.id}::uuid,
						${worker.status},
						${worker.heartbeatAt}::timestamptz,
						${transaction.json(worker as never)}
					)
					ON CONFLICT (id) DO UPDATE SET
						status = EXCLUDED.status,
						heartbeat_at = EXCLUDED.heartbeat_at,
						worker = EXCLUDED.worker
				`;
				const cutoff = new Date(
					Date.parse(worker.heartbeatAt) -
						DEFAULT_SEQUENCE_WORKER_RETENTION_MS,
				).toISOString();
				await transaction`
					DELETE FROM listmonk_ops.sequence_workers
					WHERE id <> ${worker.id}::uuid
						AND heartbeat_at < ${cutoff}::timestamptz
				`;
			});
		},
		async close() {
			await sql.end({ timeout: 5 });
		},
	};
}
