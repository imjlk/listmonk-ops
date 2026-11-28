import {
	classifyPostgresReadOnlyError,
	createPostgresReadOnlyClient,
	inspectPostgresReadOnlySchemaInTransaction,
	type PostgresReadOnlyClient,
	type PostgresReadOnlyClientOptions,
	type PostgresReadOnlyErrorCode,
	type PostgresReadOnlySchemaState,
} from "./postgres-readonly";
import {
	type SequenceSimulationSnapshot,
	selectSequenceSimulationSnapshot,
} from "./sequence-simulator";
import {
	parsePersistedSequenceDefinition,
	parseSequenceEnrollment,
	type SequenceDefinition,
	type SequenceEnrollment,
} from "./sequences";

/** Largest stored definition/enrollment document a simulation will read. */
export const MAX_SEQUENCE_SIMULATION_RECORD_BYTES = 4 * 1024 * 1024;

export type SequenceSimulationSourceErrorCode =
	| Exclude<PostgresReadOnlySchemaState, "ok">
	| PostgresReadOnlyErrorCode
	| "snapshot_too_large";

const reasons: Record<SequenceSimulationSourceErrorCode, string> = {
	schema_missing: "the listmonk-ops sequence schema or a required table is missing; simulation never creates or migrates it",
	schema_outdated: "the stored sequence schema version is older than this release expects; the runtime repository migrates it on its own startup, simulation does not",
	schema_unsupported: "the stored sequence schema version is newer or unrecognized; use a listmonk-ops release that supports it",
	configuration_invalid: "the connection string is not a valid postgres:// or postgresql:// URL",
	postgres_unreachable: "Postgres could not be reached or the connection closed",
	postgres_auth_failed: "Postgres rejected the configured credentials",
	postgres_timeout: "the read exceeded its statement or lock timeout",
	postgres_permission_denied: "the configured role cannot read the listmonk_ops schema; grant USAGE on the schema and SELECT on its tables",
	postgres_read_only_violation: "a statement was refused by the read-only guard or database",
	postgres_read_failed: "the read-only Postgres read failed",
	snapshot_too_large: `a stored definition or enrollment exceeds ${MAX_SEQUENCE_SIMULATION_RECORD_BYTES} bytes`,
};

/**
 * A sanitized refusal: only a fixed code and reason, never the connection
 * string, SQL text or server error message.
 */
export class SequenceSimulationSourceError extends Error {
	readonly code: SequenceSimulationSourceErrorCode;

	constructor(code: SequenceSimulationSourceErrorCode) {
		super(
			`Sequence simulation cannot read Postgres sequence state (${code}): ${reasons[code]}; no state was changed`,
		);
		this.name = "SequenceSimulationSourceError";
		this.code = code;
	}
}

export interface PostgresSequenceSimulationSource {
	kind: "postgres";
	databaseUrl: string;
	/** Test seam; defaults to a one-connection read-only postgres.js client. */
	createClient?: (options: PostgresReadOnlyClientOptions) => PostgresReadOnlyClient;
}

type DocumentRow = { document: unknown; bytes: unknown };

const SNAPSHOT_READ_FAILURE =
	"Unable to read matching sequence simulation snapshots; verify IDs and revision history";

function oversized(row: DocumentRow | undefined): boolean {
	if (!row) return false;
	const bytes = Number(row.bytes);
	return !Number.isFinite(bytes) || bytes > MAX_SEQUENCE_SIMULATION_RECORD_BYTES || row.document === null;
}

/**
 * Read a definition (and optional enrollment) from Postgres in one
 * REPEATABLE READ, READ ONLY transaction through the guarded read-only
 * client, never through the runtime repository (which bootstraps schema and
 * takes advisory locks). The stored `definition` / `enrollment` jsonb
 * documents are parsed exactly as the runtime repository parses them, so the
 * resulting snapshot matches the file-store snapshot for equivalent data.
 */
export async function readPostgresSequenceSimulationSnapshot(
	source: PostgresSequenceSimulationSource,
	id: string,
	enrollmentId?: string,
): Promise<SequenceSimulationSnapshot> {
	let client: PostgresReadOnlyClient;
	try {
		client = (source.createClient ?? createPostgresReadOnlyClient)({
			connectionString: source.databaseUrl,
			maxConnections: 1,
		});
	} catch (error) {
		throw new SequenceSimulationSourceError(
			classifyPostgresReadOnlyError(error).code,
		);
	}
	let outcome:
		| { state: SequenceSimulationSourceErrorCode }
		| { state: "ok"; definition?: DocumentRow; enrollment?: DocumentRow };
	try {
		outcome = await client.readOnly(async (transaction) => {
			const schema = await inspectPostgresReadOnlySchemaInTransaction(transaction, "sequences");
			if (schema.state !== "ok") return { state: schema.state };
			// The size is checked in SQL so an oversized document is never transferred.
			const [enrollment] = enrollmentId === undefined
				? []
				: await transaction.query<DocumentRow>(
					"SELECT CASE WHEN octet_length(enrollment::text) <= $2 THEN enrollment END AS document, octet_length(enrollment::text) AS bytes FROM listmonk_ops.sequence_enrollments WHERE id = $1::uuid",
					[enrollmentId, MAX_SEQUENCE_SIMULATION_RECORD_BYTES],
				);
			const [definition] = await transaction.query<DocumentRow>(
				"SELECT CASE WHEN octet_length(definition::text) <= $2 THEN definition END AS document, octet_length(definition::text) AS bytes FROM listmonk_ops.sequence_definitions WHERE id = $1::uuid",
				[id, MAX_SEQUENCE_SIMULATION_RECORD_BYTES],
			);
			return { state: "ok" as const, definition, enrollment };
		}, { consistentSnapshot: true });
	} catch (error) {
		throw new SequenceSimulationSourceError(
			classifyPostgresReadOnlyError(error).code,
		);
	} finally {
		await client.close().catch(() => undefined);
	}
	if (outcome.state !== "ok") throw new SequenceSimulationSourceError(outcome.state);
	if (oversized(outcome.definition) || oversized(outcome.enrollment)) {
		throw new SequenceSimulationSourceError("snapshot_too_large");
	}
	let definition: SequenceDefinition;
	let enrollment: SequenceEnrollment | undefined;
	try {
		if (!outcome.definition) throw new Error("definition not found");
		if (enrollmentId !== undefined && !outcome.enrollment) throw new Error("enrollment not found");
		definition = parsePersistedSequenceDefinition(outcome.definition.document);
		enrollment = outcome.enrollment ? parseSequenceEnrollment(outcome.enrollment.document) : undefined;
	} catch {
		throw new Error(SNAPSHOT_READ_FAILURE);
	}
	return selectSequenceSimulationSnapshot(definition, enrollment, id);
}
