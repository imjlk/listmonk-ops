import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { createPostgresOutboundWebhookRepository } from "../src/outbound-webhook-postgres";
import {
	assertPostgresReadOnlyStatement,
	classifyPostgresReadOnlyError,
	createPostgresReadOnlyClient,
	createPostgresReadOnlyClientFromRunner,
	inspectPostgresReadOnlySchema,
	inspectPostgresReadOnlySchemaInTransaction,
	POSTGRES_READ_ONLY_SCHEMAS,
	PostgresReadOnlyError,
	type PostgresReadOnlySchemaComponent,
	type PostgresReadOnlyTransactionRunner,
} from "../src/postgres-readonly";
import { createPostgresSequenceRepository } from "../src/sequence-postgres";

type Parameters = readonly (string | number | boolean | null)[];
type Call = { text: string; parameters: Parameters };

const WRITE_OR_DDL =
	/\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|lock|pg_advisory\w*|pg_try_advisory\w*)\b/i;

/** Fake runner: records every statement and answers schema queries from an in-memory catalog. */
function fakeRunner(catalog: {
	relations: ReadonlySet<string>;
	versions: Partial<Record<string, string | null>>;
	fail?: Error;
}) {
	const calls: Call[] = [];
	const modes: string[] = [];
	let ended = false;
	const runner: PostgresReadOnlyTransactionRunner = {
		async begin(mode, callback) {
			modes.push(mode);
			return callback(async (text, parameters) => {
				calls.push({ text, parameters });
				if (catalog.fail !== undefined) throw catalog.fail;
				if (text.startsWith("SELECT set_config")) return [{}];
				if (text.includes("to_regclass")) {
					const row: Record<string, boolean> = {};
					parameters.forEach((name, index) => {
						row[`r${index}`] = catalog.relations.has(String(name));
					});
					return [row];
				}
				const table = /FROM (\S+) WHERE key = 'schema_version'/.exec(text)?.[1];
				if (table) {
					const value = catalog.versions[table];
					return value === undefined ? [] : [{ value }];
				}
				throw new Error(`unexpected statement ${text}`);
			});
		},
		async end() {
			ended = true;
		},
	};
	return { runner, calls, modes, ended: () => ended };
}

function allRelations(component: PostgresReadOnlySchemaComponent): Set<string> {
	const schema = POSTGRES_READ_ONLY_SCHEMAS[component];
	return new Set([schema.metaTable, ...schema.requiredRelations]);
}

describe("read-only Postgres statement guard", () => {
	test("accepts single SELECT/WITH statements and quoted write words", () => {
		for (const text of [
			"SELECT 1",
			"  with x AS (SELECT 1) SELECT * FROM x",
			"SELECT value FROM listmonk_ops.sequence_runtime_meta WHERE key = 'update delete'",
			'SELECT "update" FROM t;',
			"SELECT updated_at, last_update_id FROM t",
			"SELECT 'it''s -- not a comment; nor /* this */' AS v -- trailing comment",
			"SELECT 1 /* nested /* comment */ still */ AS one",
			"SELECT CASE WHEN $1 = 'a' THEN 1 ELSE 0 END",
		]) {
			expect(() => assertPostgresReadOnlyStatement(text)).not.toThrow();
		}
	});

	test("rejects writes, DDL, row/advisory locks, settings and multiple statements", () => {
		for (const text of [
			"INSERT INTO t VALUES (1)",
			"UPDATE t SET a = 1",
			"WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d",
			"CREATE TABLE t (a int)",
			"SELECT * FROM t FOR UPDATE",
			"SELECT * FROM t FOR NO KEY UPDATE",
			"SELECT * FROM t FOR SHARE",
			"SELECT pg_advisory_xact_lock(1)",
			"SELECT pg_try_advisory_lock(1)",
			"SELECT set_config('statement_timeout', '0', false)",
			"SELECT nextval('s')",
			"SELECT 1; DROP TABLE t",
			"SET statement_timeout = 0",
			"/* SELECT */ DELETE FROM t",
			"SELECT 'x--'; COMMIT; DELETE FROM t",
			"SELECT 'x/*'; DELETE FROM t; SELECT '*/'",
			"SELECT 'a'';'; DELETE FROM t",
			"SELECT E'\\''; DELETE FROM t --'",
			"SELECT $$;$$; DELETE FROM t",
			"SELECT $tag$x$tag$",
			"SELECT 'unterminated",
			"SELECT 1 /* unterminated",
			"SELECT 1 /* outer /* inner */ still comment ; DELETE */ ; DELETE FROM t",
			'SELECT "a; DELETE FROM t',
		]) {
			expect(() => assertPostgresReadOnlyStatement(text), text).toThrow(
				PostgresReadOnlyError,
			);
		}
	});
});

describe("read-only Postgres client over an injected runner", () => {
	test("begins read only, sets transaction-local timeouts first and never writes", async () => {
		const fake = fakeRunner({
			relations: allRelations("sequences"),
			versions: { "listmonk_ops.sequence_runtime_meta": "3" },
		});
		const client = createPostgresReadOnlyClientFromRunner(fake.runner, {
			statementTimeoutMs: 2500,
			lockTimeoutMs: 400,
		});
		const inspection = await inspectPostgresReadOnlySchema(client, "sequences");
		expect(inspection).toEqual({
			component: "sequences",
			state: "ok",
			expected_version: 3,
			observed_version: 3,
			missing_relations: [],
		});
		expect(fake.modes).toEqual(["read only"]);
		expect(fake.calls[0]?.text).toContain("set_config('statement_timeout', $1, true)");
		expect(fake.calls[0]?.text).toContain("set_config('lock_timeout', $2, true)");
		expect(fake.calls[0]?.parameters).toEqual(["2500ms", "400ms"]);
		for (const call of fake.calls) {
			expect(call.text, call.text).not.toMatch(WRITE_OR_DDL);
			expect(call.text).not.toMatch(/\bset_config\([^)]*false\)/i);
		}
		await client.close();
		expect(fake.ended()).toBe(true);
	});

	test("maps meta table, version row and required relations to schema states", async () => {
		const cases: Array<{
			component: PostgresReadOnlySchemaComponent;
			relations: Set<string>;
			version?: string | null;
			expected: Record<string, unknown>;
		}> = [
			{
				component: "sequences",
				relations: new Set(),
				expected: { state: "schema_missing", observed_version: null },
			},
			{
				component: "webhooks",
				relations: new Set(["listmonk_ops.webhook_runtime_meta"]),
				expected: { state: "schema_missing", observed_version: null },
			},
			{
				component: "webhooks",
				relations: allRelations("webhooks"),
				version: "2",
				expected: { state: "schema_outdated", observed_version: 2, expected_version: 3 },
			},
			{
				component: "sequences",
				relations: allRelations("sequences"),
				version: "4",
				expected: { state: "schema_unsupported", observed_version: 4 },
			},
			{
				component: "sequences",
				relations: allRelations("sequences"),
				version: "three",
				expected: { state: "schema_unsupported", observed_version: null },
			},
			{
				component: "sequences",
				relations: allRelations("sequences"),
				version: null,
				expected: { state: "schema_missing", observed_version: null },
			},
			{
				component: "webhooks",
				relations: new Set(
					[...allRelations("webhooks")].filter(
						(name) => name !== "listmonk_ops.webhook_workers",
					),
				),
				version: "3",
				expected: {
					state: "schema_missing",
					observed_version: 3,
					missing_relations: ["listmonk_ops.webhook_workers"],
				},
			},
		];
		for (const entry of cases) {
			const meta = POSTGRES_READ_ONLY_SCHEMAS[entry.component].metaTable;
			const fake = fakeRunner({
				relations: entry.relations,
				versions: entry.version === undefined ? {} : { [meta]: entry.version },
			});
			const client = createPostgresReadOnlyClientFromRunner(fake.runner);
			expect(await inspectPostgresReadOnlySchema(client, entry.component)).toMatchObject({
				component: entry.component,
				...entry.expected,
			});
			// A missing meta table is never queried, so absent schemas cause no errors.
			if (!entry.relations.has(meta)) {
				expect(fake.calls.some((call) => call.text.includes(`FROM ${meta}`))).toBe(false);
			}
		}
	});

	test("classifies failures into fixed codes without leaking error text", async () => {
		const secret = "postgres://user:hunter2@db.internal:5432/private";
		expect(classifyPostgresReadOnlyError("not an error").code).toBe("postgres_read_failed");
		const cases: Array<[Error, string]> = [
			[Object.assign(new Error(`canceled ${secret}`), { code: "57014" }), "postgres_timeout"],
			[Object.assign(new Error(secret), { code: "55P03" }), "postgres_timeout"],
			[Object.assign(new Error(secret), { code: "25006" }), "postgres_read_only_violation"],
			[Object.assign(new Error(secret), { code: "42501" }), "postgres_permission_denied"],
			[Object.assign(new Error(secret), { code: "28P01" }), "postgres_auth_failed"],
			[Object.assign(new Error(secret), { code: "08006" }), "postgres_unreachable"],
			[Object.assign(new Error(secret), { code: "ECONNREFUSED" }), "postgres_unreachable"],
			[Object.assign(new Error(secret), { code: "CONNECT_TIMEOUT" }), "postgres_unreachable"],
			[new Error(secret), "postgres_read_failed"],
		];
		for (const [failure, code] of cases) {
			const classified = classifyPostgresReadOnlyError(failure);
			expect(classified.code).toBe(code);
			const serialized = `${classified.message} ${JSON.stringify(classified)} ${String(classified.stack)}`;
			expect(serialized).not.toContain("hunter2");
			expect(serialized).not.toContain("db.internal");
			expect("cause" in classified).toBe(false);

			const fake = fakeRunner({ relations: new Set(), versions: {}, fail: failure });
			const inspection = await inspectPostgresReadOnlySchema(
				createPostgresReadOnlyClientFromRunner(fake.runner),
				"webhooks",
			);
			expect(inspection.state).toBe(code);
			expect(JSON.stringify(inspection)).not.toContain("hunter2");
		}
	});

	test("a callback statement that is not read-only is refused before reaching Postgres", async () => {
		const fake = fakeRunner({ relations: new Set(), versions: {} });
		const client = createPostgresReadOnlyClientFromRunner(fake.runner);
		await expect(
			client.readOnly((transaction) =>
				transaction.query("UPDATE listmonk_ops.sequence_runtime_meta SET value = '9'"),
			),
		).rejects.toMatchObject({ code: "postgres_read_only_violation" });
		expect(fake.calls.map((call) => call.text)).toEqual([
			expect.stringContaining("set_config"),
		]);
	});

	test("rejects invalid timeouts and connection strings without echoing them", () => {
		const fake = fakeRunner({ relations: new Set(), versions: {} });
		expect(() => createPostgresReadOnlyClientFromRunner(fake.runner, { statementTimeoutMs: 0 })).toThrow(RangeError);
		expect(() => createPostgresReadOnlyClientFromRunner(fake.runner, { lockTimeoutMs: 60_001 })).toThrow(RangeError);
		for (const connectionString of ["mysql://u:hunter2@h/db", "not a url hunter2"]) {
			let caught: unknown;
			try {
				createPostgresReadOnlyClient({ connectionString });
			} catch (error) {
				caught = error;
			}
			expect(caught).toBeInstanceOf(PostgresReadOnlyError);
			expect((caught as PostgresReadOnlyError).code).toBe("configuration_invalid");
			expect(String((caught as Error).message)).not.toContain("hunter2");
		}
	});
});

const databaseUrl =
	process.env.LISTMONK_OPS_TEST_SEQUENCE_DATABASE_URL?.trim() ||
	process.env.LISTMONK_OPS_TEST_WEBHOOK_DATABASE_URL?.trim();
// CI sets this so a missing database URL fails instead of silently skipping.
if (process.env.LISTMONK_OPS_REQUIRE_POSTGRES_TESTS === "1" && !databaseUrl) {
	throw new Error(
		"LISTMONK_OPS_REQUIRE_POSTGRES_TESTS=1 but no LISTMONK_OPS_TEST_*_DATABASE_URL is set",
	);
}
const postgresTest = databaseUrl ? test : test.skip;

describe("read-only Postgres inspection against a real database", () => {
	// A throwaway database keeps the fresh/missing-schema cases isolated from
	// the shared listmonk_ops schema the runtime integration tests use.
	const databaseName = `listmonk_ops_ro_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
	let admin: Sql | undefined;
	let isolatedUrl = "";
	let direct: Sql | undefined;

	beforeAll(async () => {
		if (!databaseUrl) return;
		admin = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
		await admin.unsafe(`CREATE DATABASE ${databaseName}`);
		const url = new URL(databaseUrl);
		url.pathname = `/${databaseName}`;
		isolatedUrl = url.toString();
		direct = postgres(isolatedUrl, { max: 1, prepare: false, onnotice: () => {} });
	});

	afterAll(async () => {
		await direct?.end({ timeout: 5 });
		if (admin) {
			await admin.unsafe(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
			await admin.end({ timeout: 5 });
		}
	});

	async function snapshot(sql: Sql) {
		const relations = await sql<{ name: string; kind: string; oid: string }[]>`
			SELECT c.relname AS name, c.relkind::text AS kind, c.oid::text AS oid
			FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'listmonk_ops'
			ORDER BY c.relname
		`;
		const rows: Record<string, string> = {};
		for (const relation of relations.filter((entry) => entry.kind === "r")) {
			const [row] = await sql.unsafe(
				`SELECT coalesce(md5(string_agg(t.xmin::text || ':' || t::text, ',' ORDER BY t::text)), '') AS hash FROM listmonk_ops.${relation.name} t`,
			);
			rows[relation.name] = String(row?.hash);
		}
		const triggers = await sql<{ name: string }[]>`
			SELECT tgname AS name FROM pg_trigger t
			JOIN pg_class c ON c.oid = t.tgrelid
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'listmonk_ops' AND NOT t.tgisinternal
			ORDER BY tgname
		`;
		return { relations, rows, triggers };
	}

	async function inspectBoth() {
		const client = createPostgresReadOnlyClient({ connectionString: isolatedUrl, maxConnections: 1 });
		try {
			return {
				sequences: await inspectPostgresReadOnlySchema(client, "sequences"),
				webhooks: await inspectPostgresReadOnlySchema(client, "webhooks"),
			};
		} finally {
			await client.close();
		}
	}

	postgresTest("a fresh database is schema_missing and inspection creates nothing", async () => {
		const result = await inspectBoth();
		expect(result.sequences.state).toBe("schema_missing");
		expect(result.webhooks.state).toBe("schema_missing");
		const schemas = await direct!<{ count: number }[]>`
			SELECT count(*)::int AS count FROM pg_namespace WHERE nspname = 'listmonk_ops'
		`;
		expect(schemas[0]?.count).toBe(0);
	});

	postgresTest("bootstrapped schemas are ok and inspection changes no rows, relations or triggers", async () => {
		const sequences = createPostgresSequenceRepository({ connectionString: isolatedUrl, maxConnections: 1 });
		const webhooks = createPostgresOutboundWebhookRepository({ connectionString: isolatedUrl, maxConnections: 1 });
		try {
			await sequences.listDefinitions();
			await webhooks.listEndpoints();
		} finally {
			await sequences.close?.();
			await webhooks.close?.();
		}
		const before = await snapshot(direct!);
		expect(before.relations.length).toBeGreaterThan(0);
		const result = await inspectBoth();
		expect(result.sequences).toEqual({
			component: "sequences",
			state: "ok",
			expected_version: POSTGRES_READ_ONLY_SCHEMAS.sequences.expectedVersion,
			observed_version: POSTGRES_READ_ONLY_SCHEMAS.sequences.expectedVersion,
			missing_relations: [],
		});
		expect(result.webhooks.state).toBe("ok");
		expect(await snapshot(direct!)).toEqual(before);
	});

	postgresTest("inspection holds no transaction ID or advisory lock, and Postgres rejects writes in the reader transaction", async () => {
		const client = createPostgresReadOnlyClient({ connectionString: isolatedUrl, maxConnections: 1 });
		const writer = createPostgresReadOnlyClientFromRunner({
			begin: (mode, callback) =>
				direct!.begin(mode, (transaction) =>
					callback(async (text, parameters) =>
						(await transaction.unsafe(text, [...parameters] as never[])) as unknown as Record<string, unknown>[],
					),
				) as Promise<never>,
			end: async () => {},
		});
		try {
			const probe = await client.readOnly(async (transaction) => {
				for (const component of ["sequences", "webhooks"] as const) {
					expect((await inspectPostgresReadOnlySchemaInTransaction(transaction, component)).state).toBe("ok");
				}
				const [row] = await transaction.query<{ xid: string | null; advisory: number; read_only: string; statement_timeout: string; lock_timeout: string }>(
					"SELECT txid_current_if_assigned()::text AS xid, (SELECT count(*)::int FROM pg_locks WHERE pid = pg_backend_pid() AND locktype = 'advisory') AS advisory, current_setting('transaction_read_only') AS read_only, current_setting('statement_timeout') AS statement_timeout, current_setting('lock_timeout') AS lock_timeout",
				);
				return row;
			});
			expect(probe).toEqual({ xid: null, advisory: 0, read_only: "on", statement_timeout: "5s", lock_timeout: "1s" });

			// The database itself enforces read-only mode, independent of the statement guard.
			const [{ read_only: outside } = { read_only: "" }] = await direct!<{ read_only: string }[]>`
				SELECT current_setting('transaction_read_only') AS read_only
			`;
			expect(outside).toBe("off");
			let failure: unknown;
			try {
				await direct!.begin("read only", (transaction) =>
					transaction.unsafe("UPDATE listmonk_ops.sequence_runtime_meta SET value = value"),
				);
			} catch (error) {
				failure = error;
			}
			expect(classifyPostgresReadOnlyError(failure).code).toBe("postgres_read_only_violation");
			await expect(
				writer.readOnly((transaction) => transaction.query("SELECT pg_advisory_xact_lock(1)")),
			).rejects.toMatchObject({ code: "postgres_read_only_violation" });
		} finally {
			await client.close();
		}
	});

	postgresTest("statement timeouts are reported as postgres_timeout", async () => {
		const client = createPostgresReadOnlyClient({
			connectionString: isolatedUrl,
			maxConnections: 1,
			statementTimeoutMs: 50,
		});
		try {
			await expect(
				client.readOnly((transaction) => transaction.query("SELECT pg_sleep(2)")),
			).rejects.toMatchObject({ code: "postgres_timeout" });
		} finally {
			await client.close();
		}
	});

	postgresTest("version mismatches and missing relations are classified without migrating", async () => {
		await direct!`UPDATE listmonk_ops.sequence_runtime_meta SET value = '2' WHERE key = 'schema_version'`;
		await direct!`UPDATE listmonk_ops.webhook_runtime_meta SET value = '99' WHERE key = 'schema_version'`;
		let result = await inspectBoth();
		expect(result.sequences).toMatchObject({ state: "schema_outdated", observed_version: 2 });
		expect(result.webhooks).toMatchObject({ state: "schema_unsupported", observed_version: 99 });
		const versions = await direct!<{ value: string }[]>`
			SELECT value FROM listmonk_ops.sequence_runtime_meta WHERE key = 'schema_version'
		`;
		expect(versions[0]?.value).toBe("2");

		await direct!`UPDATE listmonk_ops.sequence_runtime_meta SET value = '3' WHERE key = 'schema_version'`;
		await direct!`UPDATE listmonk_ops.webhook_runtime_meta SET value = '3' WHERE key = 'schema_version'`;
		await direct!`DROP TABLE listmonk_ops.webhook_workers`;
		result = await inspectBoth();
		expect(result.sequences.state).toBe("ok");
		expect(result.webhooks).toMatchObject({
			state: "schema_missing",
			observed_version: 3,
			missing_relations: ["listmonk_ops.webhook_workers"],
		});
	});

	postgresTest("unreachable servers are classified without leaking the connection string", async () => {
		const url = new URL(isolatedUrl);
		url.port = "1";
		url.password = "hunter2-not-real";
		const client = createPostgresReadOnlyClient({
			connectionString: url.toString(),
			maxConnections: 1,
			connectTimeoutSeconds: 2,
		});
		try {
			const inspection = await inspectPostgresReadOnlySchema(client, "sequences");
			expect(inspection.state).toBe("postgres_unreachable");
			expect(JSON.stringify(inspection)).not.toContain("hunter2");
		} finally {
			await client.close();
		}
	});
});
