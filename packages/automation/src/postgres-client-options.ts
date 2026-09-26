import type { Notice } from "postgres";

/** Pool limits that each runtime Postgres repository resolves and validates. */
export interface RuntimePostgresPoolOptions {
	max: number;
	idle_timeout: number;
	connect_timeout: number;
}

/**
 * Drop server notices instead of letting postgres.js print them with its
 * default `console.log` handler. Idempotent `CREATE ... IF NOT EXISTS` schema
 * DDL emits one notice per existing object, and the runtime repositories run
 * inside the MCP stdio server and CLI machine-output modes, whose stdout must
 * carry only protocol or result data.
 */
export function discardPostgresNotice(_notice: Notice): void {}

/**
 * Client options shared by the runtime Postgres repositories. Notices never
 * reach stdout, and named prepared statements stay disabled so
 * transaction-mode poolers such as PgBouncer can multiplex connections.
 */
export function createRuntimePostgresClientOptions(
	pool: RuntimePostgresPoolOptions,
) {
	return {
		...pool,
		prepare: false,
		onnotice: discardPostgresNotice,
	};
}
