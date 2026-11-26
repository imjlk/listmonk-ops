import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres, { type Sql } from "postgres";
import { createPostgresOutboundWebhookRepository } from "../src/outbound-webhook-postgres";
import {
	createOutboundWebhookEndpoint,
	enqueueOutboundWebhookEvent,
} from "../src/outbound-webhooks";
import {
	collectOpsHealth,
	type OpsHealthContext,
	opsHealthInputSchema,
} from "../src/ops-health";
import {
	createPostgresReadOnlyClientFromRunner,
	POSTGRES_READ_ONLY_SCHEMAS,
	PostgresReadOnlyError,
	type PostgresReadOnlyTransactionRunner,
} from "../src/postgres-readonly";
import { createPostgresSequenceRepository } from "../src/sequence-postgres";
import {
	createSequenceDefinition,
	createSequenceEnrollment,
} from "../src/sequences";

const at = "2026-11-07T00:00:00.000Z";
const input = opsHealthInputSchema.parse({ at });
const definitionId = "11111111-1111-4111-8111-111111111111";
const endpointId = "22222222-2222-4222-8222-222222222222";
const secretUrl = "postgres://private-user:private-password@db.invalid/private";

const WRITE_OR_DDL =
	/\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|lock|pg_advisory\w*|pg_try_advisory\w*)\b/i;

type Rows = Record<string, Record<string, unknown>[]>;
interface FakeOptions {
	version?: string | null;
	missing?: string[];
	rows?: Rows;
	counts?: Record<string, string>;
	fail?: Error;
}

const sequenceRows = (): Rows => ({
	sequence_definitions: [{ id: definitionId, status: "active" }],
	sequence_enrollments: [
		{
			sequence_id: definitionId,
			status: "pending",
			next_run_at: new Date("2026-11-06T00:00:00Z"),
			lease_expires_at: null,
			retry_count: null,
		},
		{
			sequence_id: definitionId,
			status: "failed",
			next_run_at: new Date("2026-11-08T00:00:00Z"),
			lease_expires_at: null,
			retry_count: 3,
		},
	],
	sequence_workers: [{ status: "running", heartbeat_at: new Date(at) }],
});
const webhookRows = (): Rows => ({
	webhook_endpoints: [
		{
			id: endpointId,
			enabled: true,
			circuit_state: "open",
			circuit_open_until: new Date("2026-11-08T00:00:00Z"),
		},
	],
	webhook_deliveries: [
		{
			endpoint_id: endpointId,
			status: "exhausted",
			next_attempt_at: new Date("2026-11-06T00:00:00Z"),
			last_attempt_at: new Date("2026-11-06T00:00:00Z"),
			lease_expires_at: null,
		},
	],
	webhook_workers: [
		{ status: "running", heartbeat_at: "2026-11-07T00:00:00.000Z" },
	],
});

/** Fake postgres.js runner that answers the read-only inspection and projection SELECTs. */
function fakeContext(options: FakeOptions = {}) {
	const statements: string[] = [];
	const modes: string[] = [];
	const urls: string[] = [];
	let closed = 0;
	const rows = options.rows ?? { ...sequenceRows(), ...webhookRows() };
	const runner: PostgresReadOnlyTransactionRunner = {
		async begin(mode, callback) {
			modes.push(mode);
			return callback(async (text, parameters) => {
				statements.push(text);
				if (options.fail) throw options.fail;
				if (text.startsWith("SELECT set_config")) return [{}];
				if (text.includes("to_regclass")) {
					const row: Record<string, boolean> = {};
					parameters.forEach((name, index) => {
						row[`r${index}`] = !(options.missing ?? []).includes(String(name));
					});
					return [row];
				}
				if (text.includes("schema_version")) {
					const version = options.version === undefined ? "3" : options.version;
					return version === null ? [] : [{ value: version }];
				}
				if (text.includes("count(*)")) {
					const names = [...text.matchAll(/AS (\w+)/g)].map(
						(match) => match[1]!,
					);
					const result: Record<string, string> = {};
					const tables = [...text.matchAll(/FROM listmonk_ops\.(\w+)/g)].map(
						(match) => match[1]!,
					);
					names.forEach((name, index) => {
						result[name] = options.counts?.[name] ?? String(rows[tables[index]!]?.length ?? 0);
					});
					return [result];
				}
				const table = /FROM listmonk_ops\.(\w+)/.exec(text)?.[1];
				if (table && rows[table]) return rows[table].slice(0, Number(parameters[0]));
				throw new Error(`unexpected statement ${text}`);
			});
		},
		async end() {
			closed += 1;
		},
	};
	const context: OpsHealthContext = {
		sequenceSource: { kind: "postgres", databaseUrl: secretUrl },
		webhookSource: { kind: "postgres", databaseUrl: secretUrl },
		createPostgresReadOnlyClient: (clientOptions) => {
			urls.push(clientOptions.connectionString);
			expect(clientOptions.maxConnections).toBe(1);
			return createPostgresReadOnlyClientFromRunner(runner);
		},
	};
	return { context, statements, modes, urls, closed: () => closed };
}

describe("ops health over read-only Postgres projections", () => {
	test("summarizes both stores from bounded SELECTs in one REPEATABLE READ, READ ONLY transaction each", async () => {
		const fake = fakeContext();
		const report = await collectOpsHealth(fake.context, input);
		expect(report.components.map((component) => [component.component, component.backend, component.availability])).toEqual([
			["sequences", "postgres", "available"],
			["webhooks", "postgres", "available"],
		]);
		expect(report.complete).toBe(true);
		const [sequences, webhooks] = report.components;
		expect(sequences?.metrics).toMatchObject({ due: 1, failed: 1 });
		expect(webhooks?.metrics).toMatchObject({ exhausted: 1, circuit_open: 1 });
		expect(report.severity).not.toBe("healthy");
		expect(fake.modes).toEqual([
			"isolation level repeatable read read only",
			"isolation level repeatable read read only",
		]);
		expect(fake.urls).toEqual([secretUrl, secretUrl]);
		expect(fake.closed()).toBe(2);
		for (const statement of fake.statements) {
			if (statement.startsWith("SELECT set_config")) continue;
			expect(statement).toMatch(/^SELECT /);
			expect(statement).not.toMatch(WRITE_OR_DDL);
		}
		for (const statement of fake.statements.filter((text) => text.includes("ORDER BY"))) {
			expect(statement).toContain("LIMIT $1");
		}
		const serialized = JSON.stringify(report);
		expect(serialized).not.toContain("private-password");
		expect(serialized).not.toContain(definitionId);
		expect(serialized).not.toContain(endpointId);
		expect(report.limitations.join(" ")).toContain("REPEATABLE READ, READ ONLY");
	});

	test("healthy Postgres stores pass the check", async () => {
		const rows = sequenceRows();
		rows.sequence_enrollments = [];
		const fake = fakeContext({ rows: { ...rows, ...webhookRows(), webhook_deliveries: [], webhook_endpoints: [{ id: endpointId, enabled: true, circuit_state: "closed", circuit_open_until: null }] } });
		const report = await collectOpsHealth(fake.context, input);
		expect(report).toMatchObject({ severity: "healthy", check_passed: true, complete: true });
	});

	test("scan_limit bounds every projection and exact totals mark truncation as unknown", async () => {
		const fake = fakeContext({ counts: { enrollments: "5000" } });
		const report = await collectOpsHealth(fake.context, opsHealthInputSchema.parse({ at, scope: "sequences", scan_limit: 1 }));
		const [component] = report.components;
		expect(component?.coverage).toEqual([
			{ collection: "definitions", scanned: 1, total: 1, truncated: false },
			{ collection: "enrollments", scanned: 1, total: 5000, truncated: true },
			{ collection: "workers", scanned: 1, total: 1, truncated: false },
		]);
		expect(component).toMatchObject({ truncated: true, complete: false });
		expect(component?.findings.map((finding) => finding.code)).toContain("scan_truncated");
		expect(report.check_passed).toBe(false);
	});

	test("enrollment retryCount comes from the enrollment jsonb and invalid values fail closed", async () => {
		const rows = sequenceRows();
		rows.sequence_enrollments = [{ sequence_id: definitionId, status: "pending", next_run_at: new Date("2026-11-08T00:00:00Z"), lease_expires_at: null, retry_count: "three" }];
		const report = await collectOpsHealth(fakeContext({ rows: { ...rows, ...webhookRows() } }).context, opsHealthInputSchema.parse({ at, scope: "sequences" }));
		expect(report.components[0]).toMatchObject({ backend: "postgres", availability: "unavailable", severity: "unknown" });
		expect(report.components[0]?.findings[0]?.code).toBe("invalid_metadata");
	});

	test("non-ok schema states are unknown with the sanitized state code and no projection reads", async () => {
		const cases: [FakeOptions, string][] = [
			[{ missing: [POSTGRES_READ_ONLY_SCHEMAS.sequences.metaTable] }, "schema_missing"],
			[{ missing: ["listmonk_ops.sequence_workers"] }, "schema_missing"],
			[{ version: "2" }, "schema_outdated"],
			[{ version: "4" }, "schema_unsupported"],
			[{ version: "v3" }, "schema_unsupported"],
		];
		for (const [options, code] of cases) {
			const fake = fakeContext(options);
			const report = await collectOpsHealth(fake.context, opsHealthInputSchema.parse({ at, scope: "sequences" }));
			expect(report.components[0]).toMatchObject({ backend: "postgres", availability: "unavailable", severity: "unknown", complete: false });
			expect(report.components[0]?.findings[0]?.code).toBe(code);
			expect(report.check_passed).toBe(false);
			expect(fake.statements.some((text) => text.includes("ORDER BY"))).toBe(false);
			expect(fake.closed()).toBe(1);
		}
	});

	test("connection, auth, timeout and permission failures are sanitized unknown evidence", async () => {
		const cases: [Error, string][] = [
			[Object.assign(new Error(`connect ECONNREFUSED ${secretUrl}`), { code: "ECONNREFUSED" }), "postgres_unreachable"],
			[Object.assign(new Error("password authentication failed for private-user"), { code: "28P01" }), "postgres_auth_failed"],
			[Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }), "postgres_timeout"],
			[Object.assign(new Error("permission denied for schema listmonk_ops"), { code: "42501" }), "postgres_permission_denied"],
			[new Error("boom private-password"), "postgres_read_failed"],
		];
		for (const [fail, code] of cases) {
			const fake = fakeContext({ fail });
			const report = await collectOpsHealth(fake.context, input);
			for (const component of report.components) {
				expect(component).toMatchObject({ backend: "postgres", availability: "unavailable", severity: "unknown" });
				expect(component.findings[0]?.code).toBe(code);
			}
			const serialized = JSON.stringify(report);
			expect(serialized).not.toContain("private");
			expect(serialized).not.toContain("ECONNREFUSED");
			expect(fake.closed()).toBe(2);
		}
	});

	test("an invalid connection string is configuration_invalid without connecting", async () => {
		const report = await collectOpsHealth(
			{ sequenceSource: { kind: "postgres", databaseUrl: "mysql://user:private-password@host/db" }, webhookSource: { kind: "conflict" } },
			input,
		);
		expect(report.components[0]).toMatchObject({ backend: "postgres", availability: "unavailable", severity: "unknown" });
		expect(report.components[0]?.findings[0]?.code).toBe("configuration_invalid");
		expect(JSON.stringify(report)).not.toContain("private-password");
	});

	test("without --at, a heartbeat written while connecting is not treated as a future heartbeat", async () => {
		const rows = sequenceRows();
		const heartbeat = new Date("2026-11-07T00:00:02.000Z");
		rows.sequence_enrollments = [rows.sequence_enrollments[0]!];
		rows.sequence_workers = [{ status: "running", heartbeat_at: heartbeat }];
		const fake = fakeContext({ rows: { ...rows, ...webhookRows() } });
		const clocks = [new Date(at), new Date("2026-11-07T00:00:03.000Z")];
		const report = await collectOpsHealth(
			{ ...fake.context, now: () => clocks.shift() ?? new Date("2026-11-07T00:00:03.000Z") },
			opsHealthInputSchema.parse({ scope: "sequences" }),
		);
		expect(report.checked_at).toBe(at);
		const [component] = report.components;
		expect(component?.metrics).toMatchObject({ due: 1, workers_running: 1, workers_future: 0 });
		expect(component?.findings.map((finding) => finding.code)).not.toContain("due_without_worker");
		expect(component?.severity).toBe("healthy");
	});

	test("a failing client close never hides the inspected result", async () => {
		const fake = fakeContext();
		const context: OpsHealthContext = {
			...fake.context,
			createPostgresReadOnlyClient: (options) => {
				const client = fake.context.createPostgresReadOnlyClient!(options);
				return { ...client, close: async () => { throw new PostgresReadOnlyError("postgres_read_failed"); } };
			},
		};
		const report = await collectOpsHealth(context, opsHealthInputSchema.parse({ at, scope: "webhooks" }));
		expect(report.components[0]?.availability).toBe("available");
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

describe("ops health against a real Postgres database", () => {
	// A throwaway database keeps schema_missing and seeded cases isolated from
	// the shared listmonk_ops schema used by the runtime integration tests.
	const databaseName = `listmonk_ops_health_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
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

	const context = (): OpsHealthContext => ({
		sequenceSource: { kind: "postgres", databaseUrl: isolatedUrl },
		webhookSource: { kind: "postgres", databaseUrl: isolatedUrl },
	});

	async function snapshot(sql: Sql) {
		const namespaces = await sql<{ name: string }[]>`
			SELECT nspname AS name FROM pg_namespace WHERE nspname = 'listmonk_ops'
		`;
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
		return { namespaces, relations, rows };
	}

	postgresTest("a fresh database is schema_missing unknown and health creates nothing", async () => {
		const report = await collectOpsHealth(context(), input);
		expect(report).toMatchObject({ severity: "unknown", check_passed: false, complete: false });
		for (const component of report.components) {
			expect(component).toMatchObject({ backend: "postgres", availability: "unavailable", severity: "unknown" });
			expect(component.findings[0]?.code).toBe("schema_missing");
		}
		expect((await snapshot(direct!)).namespaces).toEqual([]);
	});

	postgresTest("seeded runtime state is summarized from real tables without changing rows, relations or locks", async () => {
		const sequences = createPostgresSequenceRepository({ connectionString: isolatedUrl, maxConnections: 1 });
		const webhooks = createPostgresOutboundWebhookRepository({ connectionString: isolatedUrl, maxConnections: 1 });
		const seededAt = new Date("2026-11-06T00:00:00.000Z");
		try {
			const definition = await sequences.createDefinition(
				createSequenceDefinition(
					{ id: randomUUID(), name: `ops-health-${randomUUID()}`, steps: [{ id: "stop", type: "stop" }] },
					seededAt,
				),
			);
			for (const subscriberId of [41, 42]) {
				await sequences.createEnrollment(
					createSequenceEnrollment(definition, { id: randomUUID(), sequenceId: definition.id, subscriberId }, seededAt),
				);
			}
			await sequences.upsertWorker({ id: randomUUID(), status: "running", startedAt: at, heartbeatAt: at });
			await createOutboundWebhookEndpoint(
				{
					name: `ops-health-${randomUUID()}`,
					url: "https://8.8.8.8/hooks",
					secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_POSTGRES",
					eventFilters: ["operation.*"],
				},
				{ repository: webhooks },
			);
			await enqueueOutboundWebhookEvent(
				{ id: randomUUID(), type: "operation.succeeded", source: "operation", correlationId: "ops-health", data: {} },
				{ repository: webhooks, now: seededAt },
			);
			await webhooks.upsertWorker({ id: randomUUID(), status: "running", startedAt: at, heartbeatAt: at });
		} finally {
			await sequences.close?.();
			await webhooks.close?.();
		}
		const before = await snapshot(direct!);
		expect(before.relations.length).toBeGreaterThan(0);

		const report = await collectOpsHealth(context(), input);
		const [sequenceComponent, webhookComponent] = report.components;
		expect(sequenceComponent).toMatchObject({ backend: "postgres", availability: "available", complete: true });
		expect(sequenceComponent?.metrics).toMatchObject({ due: 2, due_active_definition: 2, failed: 0 });
		expect(sequenceComponent?.metrics.workers_running).toBe(1);
		expect(sequenceComponent?.coverage.find((entry) => entry.collection === "enrollments")).toEqual({
			collection: "enrollments",
			scanned: 2,
			total: 2,
			truncated: false,
		});
		expect(webhookComponent).toMatchObject({ backend: "postgres", availability: "available", complete: true });
		expect(webhookComponent?.metrics).toMatchObject({ due: 1, exhausted: 0, circuit_open: 0 });
		expect(webhookComponent?.metrics.workers_running).toBe(1);

		const truncated = await collectOpsHealth(context(), opsHealthInputSchema.parse({ at, scope: "sequences", scan_limit: 1 }));
		expect(truncated.components[0]).toMatchObject({ truncated: true, complete: false });
		expect(truncated.check_passed).toBe(false);

		expect(await snapshot(direct!)).toEqual(before);
		const locks = await direct!<{ count: number }[]>`
			SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory'
		`;
		expect(locks[0]?.count).toBe(0);
		expect(JSON.stringify(report)).not.toContain(new URL(isolatedUrl).password || "\u0000");
	});

	postgresTest("an outdated schema version is unknown and is not migrated by health", async () => {
		// Bootstrap here so this test does not depend on the seeded-state test.
		const sequences = createPostgresSequenceRepository({ connectionString: isolatedUrl, maxConnections: 1 });
		try {
			await sequences.listDefinitions();
		} finally {
			await sequences.close?.();
		}
		await direct!.unsafe(
			"UPDATE listmonk_ops.sequence_runtime_meta SET value = '2' WHERE key = 'schema_version'",
		);
		const before = await snapshot(direct!);
		const report = await collectOpsHealth(context(), opsHealthInputSchema.parse({ at, scope: "sequences" }));
		expect(report.components[0]).toMatchObject({ backend: "postgres", availability: "unavailable", severity: "unknown" });
		expect(report.components[0]?.findings[0]?.code).toBe("schema_outdated");
		expect(await snapshot(direct!)).toEqual(before);
	});
});
