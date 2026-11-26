import { OUTBOUND_WEBHOOK_STORE_VERSION } from "./outbound-webhooks";
import type { PostgresReadOnlyTransaction } from "./postgres-readonly";
import { SEQUENCE_STORE_VERSION } from "./sequences";

/**
 * Bounded, privacy-minimal Postgres projections for ops health. They select
 * only the status/timestamp columns the shared health classifiers already
 * consume for file stores, plus exact per-table totals, inside one read-only
 * transaction. No identities, contexts, payloads, URLs, secrets, worker IDs
 * or error text are selected.
 */
export interface OpsHealthCoverage {
	collection: string;
	scanned: number;
	total: number;
	truncated: boolean;
}

export interface OpsHealthPostgresProjection {
	selected: Record<string, unknown>;
	coverage: OpsHealthCoverage[];
}

type Row = Record<string, unknown>;

/** Postgres timestamps arrive as Date (or text); the projections use ISO strings. */
function isoTimestamp(value: unknown): string | undefined {
	if (value === null || value === undefined) return undefined;
	const date = value instanceof Date ? value : new Date(String(value));
	// An invalid date is passed through as a string so schema validation fails closed.
	return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function total(row: Row | undefined, key: string): number {
	const value = Number(row?.[key]);
	return Number.isInteger(value) && value >= 0 ? value : Number.NaN;
}

function coverage(collection: string, rows: readonly unknown[], count: number): OpsHealthCoverage {
	// A total below the sample (impossible in one snapshot) still never reports completeness it lacks.
	const totalRows = Number.isNaN(count)
		? rows.length + 1
		: Math.max(count, rows.length);
	return {
		collection,
		scanned: rows.length,
		total: totalRows,
		truncated: totalRows > rows.length,
	};
}

/**
 * Sequence projection. Enrollment `retryCount` lives only in the
 * `enrollment` jsonb (key `retryCount`, schema default 0); every other field
 * has a dedicated column maintained by the runtime repository.
 */
export async function readOpsHealthPostgresSequences(
	transaction: PostgresReadOnlyTransaction,
	scanLimit: number,
): Promise<OpsHealthPostgresProjection> {
	const [counts] = await transaction.query<Row>(
		"SELECT (SELECT count(*) FROM listmonk_ops.sequence_definitions)::bigint::text AS definitions, (SELECT count(*) FROM listmonk_ops.sequence_enrollments)::bigint::text AS enrollments, (SELECT count(*) FROM listmonk_ops.sequence_workers)::bigint::text AS workers",
	);
	const definitions = await transaction.query<Row>(
		"SELECT id::text AS id, status FROM listmonk_ops.sequence_definitions ORDER BY created_at, id LIMIT $1",
		[scanLimit],
	);
	const enrollments = await transaction.query<Row>(
		"SELECT sequence_id::text AS sequence_id, status, next_run_at, lease_expires_at, enrollment -> 'retryCount' AS retry_count FROM listmonk_ops.sequence_enrollments ORDER BY created_at, id LIMIT $1",
		[scanLimit],
	);
	// Newest heartbeats first, so a truncated worker sample keeps the liveness evidence.
	const workers = await transaction.query<Row>(
		"SELECT status, heartbeat_at FROM listmonk_ops.sequence_workers ORDER BY heartbeat_at DESC, id LIMIT $1",
		[scanLimit],
	);
	return {
		selected: {
			version: SEQUENCE_STORE_VERSION,
			definitions: definitions.map((row) => ({
				id: row.id,
				status: row.status,
			})),
			enrollments: enrollments.map((row) => ({
				sequenceId: row.sequence_id,
				status: row.status,
				nextRunAt: isoTimestamp(row.next_run_at),
				leaseExpiresAt: isoTimestamp(row.lease_expires_at),
				retryCount: row.retry_count === null || row.retry_count === undefined
					? 0
					: row.retry_count,
			})),
			workers: workers.map((row) => ({
				status: row.status,
				heartbeatAt: isoTimestamp(row.heartbeat_at),
			})),
		},
		coverage: [
			coverage("definitions", definitions, total(counts, "definitions")),
			coverage("enrollments", enrollments, total(counts, "enrollments")),
			coverage("workers", workers, total(counts, "workers")),
		],
	};
}

/**
 * Webhook projection. Circuit state is stored on `webhook_endpoints`, so
 * endpoint runtime rows are derived from the same endpoint sample.
 */
export async function readOpsHealthPostgresWebhooks(
	transaction: PostgresReadOnlyTransaction,
	scanLimit: number,
): Promise<OpsHealthPostgresProjection> {
	const [counts] = await transaction.query<Row>(
		"SELECT (SELECT count(*) FROM listmonk_ops.webhook_endpoints)::bigint::text AS endpoints, (SELECT count(*) FROM listmonk_ops.webhook_deliveries)::bigint::text AS deliveries, (SELECT count(*) FROM listmonk_ops.webhook_workers)::bigint::text AS workers",
	);
	const endpoints = await transaction.query<Row>(
		"SELECT id::text AS id, enabled, circuit_state, circuit_open_until FROM listmonk_ops.webhook_endpoints ORDER BY created_at, id LIMIT $1",
		[scanLimit],
	);
	const deliveries = await transaction.query<Row>(
		"SELECT endpoint_id::text AS endpoint_id, status, next_attempt_at, last_attempt_at, lease_expires_at FROM listmonk_ops.webhook_deliveries ORDER BY next_attempt_at, id LIMIT $1",
		[scanLimit],
	);
	const workers = await transaction.query<Row>(
		"SELECT status, heartbeat_at FROM listmonk_ops.webhook_workers ORDER BY heartbeat_at DESC, id LIMIT $1",
		[scanLimit],
	);
	const endpointTotal = total(counts, "endpoints");
	return {
		selected: {
			version: OUTBOUND_WEBHOOK_STORE_VERSION,
			endpoints: endpoints.map((row) => ({ id: row.id, enabled: row.enabled })),
			deliveries: deliveries.map((row) => ({
				endpointId: row.endpoint_id,
				status: row.status,
				nextAttemptAt: isoTimestamp(row.next_attempt_at),
				lastAttemptAt: isoTimestamp(row.last_attempt_at),
				leaseExpiresAt: isoTimestamp(row.lease_expires_at),
			})),
			endpointRuntime: endpoints.map((row) => ({
				endpointId: row.id,
				circuitState: row.circuit_state,
				circuitOpenUntil: isoTimestamp(row.circuit_open_until),
			})),
			workers: workers.map((row) => ({
				status: row.status,
				heartbeatAt: isoTimestamp(row.heartbeat_at),
			})),
		},
		coverage: [
			coverage("endpoints", endpoints, endpointTotal),
			coverage("deliveries", deliveries, total(counts, "deliveries")),
			coverage("endpointRuntime", endpoints, endpointTotal),
			coverage("workers", workers, total(counts, "workers")),
		],
	};
}
