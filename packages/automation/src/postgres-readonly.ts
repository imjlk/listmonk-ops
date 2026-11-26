import postgres, { type Sql } from "postgres";
import { OUTBOUND_WEBHOOK_POSTGRES_SCHEMA_VERSION } from "./outbound-webhook-postgres";
import { createRuntimePostgresClientOptions } from "./postgres-client-options";
import { SEQUENCE_POSTGRES_SCHEMA_VERSION } from "./sequence-postgres";

/**
 * Read-only Postgres foundation for inspection paths (ops health, sequence
 * simulation). Unlike the runtime repositories, nothing here ever runs the
 * schema bootstrap: no DDL, no row writes, no advisory locks. Every read runs
 * inside `BEGIN READ ONLY` with transaction-local statement and lock
 * timeouts, so Postgres itself rejects a write even if a query is wrong.
 * Errors are reduced to fixed codes and messages: neither the connection
 * string nor server error text escapes.
 */

export type PostgresReadOnlySchemaComponent = "sequences" | "webhooks";

export type PostgresReadOnlySchemaState =
	| "ok"
	| "schema_missing"
	| "schema_outdated"
	| "schema_unsupported";

export type PostgresReadOnlyErrorCode =
	| "configuration_invalid"
	| "postgres_unreachable"
	| "postgres_auth_failed"
	| "postgres_timeout"
	| "postgres_permission_denied"
	| "postgres_read_only_violation"
	| "postgres_read_failed";

export type PostgresReadOnlyInspectionState =
	| PostgresReadOnlySchemaState
	| PostgresReadOnlyErrorCode;

const errorMessages: Record<PostgresReadOnlyErrorCode, string> = {
	configuration_invalid:
		"Postgres connection string must be a valid postgres:// or postgresql:// URL",
	postgres_unreachable: "Postgres could not be reached or the connection closed",
	postgres_auth_failed: "Postgres rejected the configured credentials",
	postgres_timeout:
		"Postgres read-only inspection exceeded its statement or lock timeout",
	postgres_permission_denied:
		"The configured Postgres role cannot read the listmonk-ops schema",
	postgres_read_only_violation:
		"A statement attempted to write inside a read-only inspection transaction",
	postgres_read_failed: "Postgres read-only inspection failed",
};

/** Sanitized error: a fixed message per code; the original error is not retained. */
export class PostgresReadOnlyError extends Error {
	readonly code: PostgresReadOnlyErrorCode;
	readonly sqlState?: string;
	constructor(code: PostgresReadOnlyErrorCode, sqlState?: string) {
		super(errorMessages[code]);
		this.name = "PostgresReadOnlyError";
		this.code = code;
		if (sqlState !== undefined) this.sqlState = sqlState;
	}
}

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;
const UNREACHABLE_CODES = new Set([
	"ECONNREFUSED",
	"ECONNRESET",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EPIPE",
	"ETIMEDOUT",
	"CONNECT_TIMEOUT",
	"CONNECTION_CLOSED",
	"CONNECTION_ENDED",
	"CONNECTION_DESTROYED",
]);

/**
 * Map a driver/server error to a fixed code. Only the SQLSTATE (a five
 * character class code) is kept; messages, hosts and parameters are dropped.
 */
export function classifyPostgresReadOnlyError(
	error: unknown,
): PostgresReadOnlyError {
	if (error instanceof PostgresReadOnlyError) return error;
	const code =
		typeof error === "object" && error !== null && "code" in error
			? String((error as { code?: unknown }).code ?? "")
			: "";
	const sqlState = SQLSTATE_PATTERN.test(code) ? code : undefined;
	if (sqlState === "57014" || sqlState === "55P03") {
		return new PostgresReadOnlyError("postgres_timeout", sqlState);
	}
	if (sqlState === "25006") {
		return new PostgresReadOnlyError("postgres_read_only_violation", sqlState);
	}
	if (sqlState === "42501") {
		return new PostgresReadOnlyError("postgres_permission_denied", sqlState);
	}
	if (sqlState?.startsWith("28")) {
		return new PostgresReadOnlyError("postgres_auth_failed", sqlState);
	}
	if (
		sqlState?.startsWith("08") ||
		sqlState === "57P01" ||
		sqlState === "57P02" ||
		sqlState === "57P03" ||
		sqlState === "3D000" ||
		UNREACHABLE_CODES.has(code)
	) {
		return new PostgresReadOnlyError("postgres_unreachable", sqlState);
	}
	return new PostgresReadOnlyError("postgres_read_failed", sqlState);
}

/** One read-only transaction. Only single SELECT/WITH statements are accepted. */
export interface PostgresReadOnlyTransaction {
	query<Row extends Record<string, unknown>>(
		text: string,
		parameters?: readonly (string | number | boolean | null)[],
	): Promise<Row[]>;
}

export interface PostgresReadOnlyClient {
	readonly kind: "postgres-read-only";
	/** Run `read` in one `BEGIN READ ONLY` transaction; errors are sanitized. */
	readOnly<T>(read: (transaction: PostgresReadOnlyTransaction) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

/** Low-level runner seam: begin a read-only transaction and run raw statements. */
export interface PostgresReadOnlyTransactionRunner {
	begin<T>(
		mode: "read only",
		callback: (
			execute: (
				text: string,
				parameters: readonly (string | number | boolean | null)[],
			) => Promise<Record<string, unknown>[]>,
		) => Promise<T>,
	): Promise<T>;
	end(): Promise<void>;
}

export interface PostgresReadOnlyTimeouts {
	statementTimeoutMs: number;
	lockTimeoutMs: number;
}

export const DEFAULT_POSTGRES_READ_ONLY_TIMEOUTS: Readonly<PostgresReadOnlyTimeouts> =
	{ statementTimeoutMs: 5000, lockTimeoutMs: 1000 };

const MAX_TIMEOUT_MS = 60_000;

function resolveTimeout(value: number | undefined, fallback: number, label: string): number {
	const resolved = value ?? fallback;
	if (!Number.isInteger(resolved) || resolved <= 0 || resolved > MAX_TIMEOUT_MS) {
		throw new RangeError(
			`${label} must be an integer between 1 and ${MAX_TIMEOUT_MS}`,
		);
	}
	return resolved;
}

const FORBIDDEN_STATEMENT =
	/\b(insert|update|delete|merge|upsert|create|alter|drop|truncate|grant|revoke|comment|copy|lock|vacuum|analyze|reindex|cluster|refresh|listen|notify|call|do|execute|prepare|set|reset|nextval|setval|set_config|pg_advisory\w*|pg_try_advisory\w*|for\s+(no\s+key\s+)?update|for\s+(key\s+)?share)\b/i;

/**
 * Defense in depth on top of `BEGIN READ ONLY`: accept one SELECT/WITH
 * statement without write keywords, row locks, advisory locks or session
 * settings. Statements are code-owned constants with bound parameters, so a
 * keyword match is a programming error, not user input.
 */
export function assertPostgresReadOnlyStatement(text: string): void {
	const normalized = text.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ").trim();
	if (!/^(select|with)\b/i.test(normalized)) {
		throw new PostgresReadOnlyError("postgres_read_only_violation");
	}
	if (normalized.replace(/;\s*$/, "").includes(";")) {
		throw new PostgresReadOnlyError("postgres_read_only_violation");
	}
	// Ignore quoted literals/identifiers so values such as 'schema_version' do not match.
	const unquoted = normalized.replace(/'(?:[^']|'')*'/g, "''").replace(
		/"(?:[^"]|"")*"/g,
		'""',
	);
	if (FORBIDDEN_STATEMENT.test(unquoted)) {
		throw new PostgresReadOnlyError("postgres_read_only_violation");
	}
}

/**
 * Build a read-only client over an injected runner. Timeouts are applied with
 * transaction-local `set_config(..., true)` so they never leak to pooled
 * sessions and no connection startup parameters are required (poolers such as
 * PgBouncer may reject unknown startup parameters).
 */
export function createPostgresReadOnlyClientFromRunner(
	runner: PostgresReadOnlyTransactionRunner,
	timeouts: Partial<PostgresReadOnlyTimeouts> = {},
): PostgresReadOnlyClient {
	const statementTimeoutMs = resolveTimeout(
		timeouts.statementTimeoutMs,
		DEFAULT_POSTGRES_READ_ONLY_TIMEOUTS.statementTimeoutMs,
		"statementTimeoutMs",
	);
	const lockTimeoutMs = resolveTimeout(
		timeouts.lockTimeoutMs,
		DEFAULT_POSTGRES_READ_ONLY_TIMEOUTS.lockTimeoutMs,
		"lockTimeoutMs",
	);
	return {
		kind: "postgres-read-only",
		async readOnly(read) {
			try {
				return await runner.begin("read only", async (execute) => {
					await execute(
						"SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true), set_config('idle_in_transaction_session_timeout', $1, true)",
						[`${statementTimeoutMs}ms`, `${lockTimeoutMs}ms`],
					);
					return read({
						async query<Row extends Record<string, unknown>>(
							text: string,
							parameters: readonly (string | number | boolean | null)[] = [],
						) {
							assertPostgresReadOnlyStatement(text);
							return (await execute(text, parameters)) as Row[];
						},
					});
				});
			} catch (error) {
				throw classifyPostgresReadOnlyError(error);
			}
		},
		async close() {
			try {
				await runner.end();
			} catch (error) {
				throw classifyPostgresReadOnlyError(error);
			}
		},
	};
}

export interface PostgresReadOnlyClientOptions extends Partial<PostgresReadOnlyTimeouts> {
	connectionString: string;
	maxConnections?: number;
	idleTimeoutSeconds?: number;
	connectTimeoutSeconds?: number;
}

function resolvePoolValue(value: number | undefined, fallback: number, label: string, maximum: number): number {
	const resolved = value ?? fallback;
	if (!Number.isInteger(resolved) || resolved <= 0 || resolved > maximum) {
		throw new RangeError(`${label} must be between 1 and ${maximum}`);
	}
	return resolved;
}

/** Validate without echoing the value: a malformed URL may still contain a password. */
function assertReadOnlyConnectionString(value: string): string {
	const trimmed = value.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new PostgresReadOnlyError("configuration_invalid");
	}
	if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
		throw new PostgresReadOnlyError("configuration_invalid");
	}
	return trimmed;
}

/**
 * Create a postgres.js-backed read-only client. Connecting is lazy; creating
 * the client performs no I/O. It shares the runtime client options (notices
 * discarded, no named prepared statements) and adds no startup parameters.
 */
export function createPostgresReadOnlyClient(
	options: PostgresReadOnlyClientOptions,
): PostgresReadOnlyClient {
	const connectionString = assertReadOnlyConnectionString(
		options.connectionString,
	);
	const sql: Sql = postgres(
		connectionString,
		createRuntimePostgresClientOptions({
			max: resolvePoolValue(options.maxConnections, 2, "maxConnections", 10),
			idle_timeout: resolvePoolValue(
				options.idleTimeoutSeconds,
				10,
				"idleTimeoutSeconds",
				600,
			),
			connect_timeout: resolvePoolValue(
				options.connectTimeoutSeconds,
				10,
				"connectTimeoutSeconds",
				120,
			),
		}),
	);
	return createPostgresReadOnlyClientFromRunner(
		{
			begin: (mode, callback) =>
				sql.begin(mode, (transaction) =>
					callback(
						async (text, parameters) =>
							(await transaction.unsafe(text, [...parameters] as never[])) as unknown as Record<
								string,
								unknown
							>[],
					),
				) as Promise<never>,
			end: () => sql.end({ timeout: 5 }),
		},
		options,
	);
}

export interface PostgresReadOnlySchemaDefinition {
	component: PostgresReadOnlySchemaComponent;
	metaTable: string;
	requiredRelations: readonly string[];
	expectedVersion: number;
}

/** Relations created by each runtime repository's bootstrap at its current version. */
export const POSTGRES_READ_ONLY_SCHEMAS: Readonly<
	Record<PostgresReadOnlySchemaComponent, PostgresReadOnlySchemaDefinition>
> = {
	sequences: {
		component: "sequences",
		metaTable: "listmonk_ops.sequence_runtime_meta",
		requiredRelations: [
			"listmonk_ops.sequence_definitions",
			"listmonk_ops.sequence_enrollments",
			"listmonk_ops.sequence_workers",
			"listmonk_ops.sequence_idempotency_records",
			"listmonk_ops.sequence_idempotency_reconciliations",
		],
		expectedVersion: SEQUENCE_POSTGRES_SCHEMA_VERSION,
	},
	webhooks: {
		component: "webhooks",
		metaTable: "listmonk_ops.webhook_runtime_meta",
		requiredRelations: [
			"listmonk_ops.webhook_endpoints",
			"listmonk_ops.webhook_deliveries",
			"listmonk_ops.webhook_workers",
		],
		expectedVersion: OUTBOUND_WEBHOOK_POSTGRES_SCHEMA_VERSION,
	},
};

export interface PostgresReadOnlySchemaInspection {
	component: PostgresReadOnlySchemaComponent;
	state: PostgresReadOnlyInspectionState;
	expected_version: number;
	/** Stored version when it is a non-negative integer, otherwise null. */
	observed_version: number | null;
	/** Required relations absent from the database (code-owned names only). */
	missing_relations: string[];
}

/**
 * Classify the schema inside an existing read-only transaction. Uses
 * `to_regclass` (no error for missing objects) and reads the version row;
 * never creates, migrates or locks anything.
 *
 * - `schema_missing`: no meta table, no version row, or a required relation is absent.
 * - `schema_outdated`: stored version is lower than this code expects; the
 *   runtime repository would migrate it, inspection must not.
 * - `schema_unsupported`: stored version is newer or not an integer.
 */
export async function inspectPostgresReadOnlySchemaInTransaction(
	transaction: PostgresReadOnlyTransaction,
	component: PostgresReadOnlySchemaComponent,
): Promise<PostgresReadOnlySchemaInspection> {
	const definition = POSTGRES_READ_ONLY_SCHEMAS[component];
	const relations = [definition.metaTable, ...definition.requiredRelations];
	const columns = relations
		.map((_, index) => `to_regclass($${index + 1}) IS NOT NULL AS r${index}`)
		.join(", ");
	const presenceRows = await transaction.query<Record<string, boolean>>(
		`SELECT ${columns}`,
		relations,
	);
	const presence = presenceRows[0] ?? {};
	const missing = relations.filter(
		(_, index) => presence[`r${index}`] !== true,
	);
	const result = (
		state: PostgresReadOnlySchemaState,
		observed: number | null,
		missingRelations: string[] = [],
	): PostgresReadOnlySchemaInspection => ({
		component,
		state,
		expected_version: definition.expectedVersion,
		observed_version: observed,
		missing_relations: missingRelations,
	});
	if (missing.includes(definition.metaTable)) {
		return result("schema_missing", null, missing);
	}
	const versionRows = await transaction.query<{ value: unknown }>(
		`SELECT value FROM ${definition.metaTable} WHERE key = 'schema_version'`,
	);
	const raw = versionRows[0]?.value;
	if (raw === undefined || raw === null) {
		return result("schema_missing", null, missing);
	}
	const text = String(raw).trim();
	const observed = /^\d{1,9}$/.test(text) ? Number(text) : Number.NaN;
	if (!Number.isInteger(observed)) return result("schema_unsupported", null, missing);
	if (observed > definition.expectedVersion) return result("schema_unsupported", observed, missing);
	if (observed < definition.expectedVersion) return result("schema_outdated", observed, missing);
	if (missing.length > 0) return result("schema_missing", observed, missing);
	return result("ok", observed);
}

/**
 * Inspect one component's schema in its own read-only transaction. Never
 * throws for connection, timeout or permission failures: they become the
 * inspection state so callers can report them as `unknown` evidence.
 */
export async function inspectPostgresReadOnlySchema(
	client: PostgresReadOnlyClient,
	component: PostgresReadOnlySchemaComponent,
): Promise<PostgresReadOnlySchemaInspection> {
	try {
		return await client.readOnly((transaction) =>
			inspectPostgresReadOnlySchemaInTransaction(transaction, component),
		);
	} catch (error) {
		return {
			component,
			state: classifyPostgresReadOnlyError(error).code,
			expected_version: POSTGRES_READ_ONLY_SCHEMAS[component].expectedVersion,
			observed_version: null,
			missing_relations: [],
		};
	}
}
