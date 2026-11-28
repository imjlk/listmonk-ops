import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres, { type Sql } from "postgres";
import {
	createPostgresReadOnlyClientFromRunner,
	POSTGRES_READ_ONLY_SCHEMAS,
	type PostgresReadOnlyTransactionRunner,
} from "../src/postgres-readonly";
import { invokeSequenceSimulateOperation } from "../src/sequence-operations";
import { createPostgresSequenceRepository } from "../src/sequence-postgres";
import {
	resolveSequenceSimulationSource,
	type SequenceSimulationSource,
} from "../src/sequence-runtime";
import {
	MAX_SEQUENCE_SIMULATION_RECORD_BYTES,
	SequenceSimulationSourceError,
} from "../src/sequence-simulation-postgres";
import {
	createFileSequenceRepository,
	createSequenceDefinition,
	createSequenceEnrollment,
	type SequenceDefinition,
	type SequenceEnrollment,
	type SequenceStep,
} from "../src/sequences";

const createdAt = new Date("2026-01-01T00:00:00.000Z");
const at = "2026-01-02T00:00:00Z";
const definitionId = "11111111-1111-4111-8111-111111111111";
const enrollmentId = "22222222-2222-4222-8222-222222222222";
const secretUrl = "postgres://private-user:private-password@db.invalid/private";
const subscriber = {
	status: "enabled",
	lists: [{ id: 7, subscription_status: "confirmed" }],
};
const steps: SequenceStep[] = [
	{
		id: "check",
		type: "condition",
		path: "tier",
		operator: "equals",
		value: "pro",
		onTrue: "wait",
		onFalse: "stop",
	},
	{ id: "wait", type: "wait", durationSeconds: 60 },
	{ id: "send", type: "send", templateId: 3, consentListIds: [7] },
	{ id: "stop", type: "stop" },
];
const WRITE_OR_DDL =
	/\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|lock|pg_advisory\w*|pg_try_advisory\w*)\b/i;

function fixtures(): { definition: SequenceDefinition; enrollment: SequenceEnrollment } {
	const definition = createSequenceDefinition(
		{ id: definitionId, name: "Private name", steps },
		createdAt,
	);
	const enrollment = createSequenceEnrollment(
		definition,
		{
			id: enrollmentId,
			sequenceId: definitionId,
			subscriberId: 777,
			context: { tier: "pro", email: "private@example.test" },
		},
		createdAt,
	);
	return { definition, enrollment };
}

interface FakeOptions {
	version?: string | null;
	missing?: string[];
	definition?: unknown;
	enrollment?: unknown;
	bytes?: number;
	fail?: Error;
}

/** Fake postgres.js runner answering the schema inspection and the two document SELECTs. */
function fakeSource(options: FakeOptions = {}) {
	const statements: string[] = [];
	const modes: string[] = [];
	const urls: string[] = [];
	let closed = 0;
	const document = (value: unknown) =>
		value === undefined
			? []
			: [
					{
						document: options.bytes && options.bytes > MAX_SEQUENCE_SIMULATION_RECORD_BYTES
							? null
							: structuredClone(value),
						bytes: String(options.bytes ?? 100),
					},
				];
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
				if (text.includes("FROM listmonk_ops.sequence_definitions")) return document(options.definition);
				if (text.includes("FROM listmonk_ops.sequence_enrollments")) return document(options.enrollment);
				throw new Error(`unexpected statement ${text}`);
			});
		},
		async end() {
			closed += 1;
		},
	};
	const source: SequenceSimulationSource = {
		kind: "postgres",
		databaseUrl: secretUrl,
		createClient: (clientOptions) => {
			urls.push(clientOptions.connectionString);
			expect(clientOptions.maxConnections).toBe(1);
			return createPostgresReadOnlyClientFromRunner(runner);
		},
	};
	return { source, statements, modes, urls, closed: () => closed };
}

async function fileResult(definition: SequenceDefinition, enrollment: SequenceEnrollment | undefined, input: Record<string, unknown>) {
	const directory = await mkdtemp(join(tmpdir(), "sequence-simulation-pg-"));
	try {
		const repository = createFileSequenceRepository(
			join(directory, "sequences.json"),
		);
		await repository.createDefinition(definition);
		if (enrollment) await repository.createEnrollment(enrollment);
		return await invokeSequenceSimulateOperation({ repository }, input);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

describe("sequence simulation over the read-only Postgres reader", () => {
	test("sequence and enrollment simulations match the file store for the same documents", async () => {
		const { definition, enrollment } = fixtures();
		for (const input of [
			{ id: definitionId, at, subscriber, context: { tier: "pro" } },
			{ id: definitionId, at, subscriber, context: { tier: "free" } },
			{ id: definitionId, enrollment_id: enrollmentId, at, subscriber },
		]) {
			const fake = fakeSource({ definition, enrollment });
			const result = await invokeSequenceSimulateOperation({ simulationSource: fake.source }, input);
			expect(result).toEqual(await fileResult(definition, enrollment, input));
			expect(fake.modes).toEqual(["isolation level repeatable read read only"]);
			expect(fake.urls).toEqual([secretUrl]);
			expect(fake.closed()).toBe(1);
			for (const statement of fake.statements) {
				if (statement.startsWith("SELECT set_config")) continue;
				expect(statement).toMatch(/^SELECT /);
				expect(statement).not.toMatch(WRITE_OR_DDL);
			}
			const serialized = JSON.stringify(result);
			expect(serialized).not.toContain("private@example.test");
			expect(serialized).not.toContain("Private name");
		}
	});

	test("a pinned older revision is simulated and reported as revision_changed, like the file store", async () => {
		const { definition, enrollment } = fixtures();
		const updated: SequenceDefinition = {
			...definition,
			currentRevision: 2,
			revisions: [...definition.revisions, { revision: 2, steps: [{ id: "stop", type: "stop" }], createdAt: at }],
		};
		const input = { id: definitionId, enrollment_id: enrollmentId, at, subscriber };
		const result = await invokeSequenceSimulateOperation({ simulationSource: fakeSource({ definition: updated, enrollment }).source }, input);
		expect(result).toMatchObject({ revision: 1, current_revision: 2, revision_changed: true, outcome: "unknown" });
		expect(result).toEqual(await fileResult(updated, enrollment, input));
	});

	test("missing records and identity mismatches use the same message as the file store", async () => {
		const { definition, enrollment } = fixtures();
		const cases: [FakeOptions, Record<string, unknown>][] = [
			[{}, { id: definitionId, at }],
			[{ definition }, { id: definitionId, enrollment_id: enrollmentId, at }],
			[{ definition, enrollment: { ...enrollment, sequenceId: randomUUID() } }, { id: definitionId, enrollment_id: enrollmentId, at }],
			[{ definition: { ...definition, revisions: "broken" } }, { id: definitionId, at }],
		];
		for (const [options, input] of cases) {
			await expect(invokeSequenceSimulateOperation({ simulationSource: fakeSource(options).source }, input)).rejects.toThrow(
				"Unable to read matching sequence simulation snapshots",
			);
		}
	});

	test("non-ok schema states are sanitized refusals and no documents are read", async () => {
		const cases: [FakeOptions, string][] = [
			[{ missing: [POSTGRES_READ_ONLY_SCHEMAS.sequences.metaTable] }, "schema_missing"],
			[{ missing: ["listmonk_ops.sequence_enrollments"] }, "schema_missing"],
			[{ version: "2" }, "schema_outdated"],
			[{ version: "4" }, "schema_unsupported"],
		];
		for (const [options, code] of cases) {
			const fake = fakeSource(options);
			const error = await invokeSequenceSimulateOperation({ simulationSource: fake.source }, { id: definitionId, at }).catch((caught: unknown) => caught);
			expect(String((error as Error).message)).toContain(`(${code})`);
			expect(fake.statements.some((text) => text.includes("sequence_definitions WHERE"))).toBe(false);
			expect(fake.closed()).toBe(1);
		}
	});

	test("connection, auth, timeout and permission failures never leak connection strings or server text", async () => {
		const cases: [Error, string][] = [
			[Object.assign(new Error(`connect ECONNREFUSED ${secretUrl}`), { code: "ECONNREFUSED" }), "postgres_unreachable"],
			[Object.assign(new Error("password authentication failed for private-user"), { code: "28P01" }), "postgres_auth_failed"],
			[Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" }), "postgres_timeout"],
			[Object.assign(new Error("permission denied for schema listmonk_ops"), { code: "42501" }), "postgres_permission_denied"],
			[new Error("boom private-password"), "postgres_read_failed"],
		];
		for (const [fail, code] of cases) {
			const fake = fakeSource({ fail });
			const error = await invokeSequenceSimulateOperation({ simulationSource: fake.source }, { id: definitionId, at }).catch((caught: unknown) => caught);
			const message = String((error as Error).message);
			expect(message).toContain(`(${code})`);
			expect(message).not.toContain("private");
			expect(message).not.toContain("ECONNREFUSED");
			expect(fake.closed()).toBe(1);
		}
		const invalid = await invokeSequenceSimulateOperation(
			{ simulationSource: { kind: "postgres", databaseUrl: "mysql://user:private-password@host/db" } },
			{ id: definitionId, at },
		).catch((caught: unknown) => caught);
		expect(String((invalid as Error).message)).toContain("(configuration_invalid)");
		expect(String((invalid as Error).message)).not.toContain("private-password");
	});

	test("oversized stored documents are refused without being transferred", async () => {
		const { definition } = fixtures();
		const error = await invokeSequenceSimulateOperation(
			{ simulationSource: fakeSource({ definition, bytes: MAX_SEQUENCE_SIMULATION_RECORD_BYTES + 1 }).source },
			{ id: definitionId, at },
		).catch((caught: unknown) => caught);
		expect(String((error as Error).message)).toContain("(snapshot_too_large)");
		expect(new SequenceSimulationSourceError("snapshot_too_large").code).toBe("snapshot_too_large");
	});

	test("environment resolution never constructs a Postgres runtime repository and explicit steps never resolve a source", async () => {
		const previous = { url: process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL, store: process.env.LISTMONK_OPS_SEQUENCE_STORE };
		try {
			process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL = secretUrl;
			delete process.env.LISTMONK_OPS_SEQUENCE_STORE;
			expect(resolveSequenceSimulationSource()).toEqual({ kind: "postgres", databaseUrl: secretUrl });
			process.env.LISTMONK_OPS_SEQUENCE_STORE = "/tmp/conflict.json";
			expect(() => resolveSequenceSimulationSource()).toThrow("Configure only one of");
			const result = await invokeSequenceSimulateOperation({}, { at, steps: [{ id: "stop", type: "stop" }] });
			expect(result.outcome).toBe("completed_path");
		} finally {
			if (previous.url === undefined) delete process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL;
			else process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL = previous.url;
			if (previous.store === undefined) delete process.env.LISTMONK_OPS_SEQUENCE_STORE;
			else process.env.LISTMONK_OPS_SEQUENCE_STORE = previous.store;
		}
	});

	test("a Postgres runtime repository passed without a read-only source is refused before any read", async () => {
		const forbidden = new Proxy({ kind: "postgres" }, {
			get(target, key) {
				if (key === "kind") return "postgres";
				if (key === "then") return undefined;
				throw new Error(`Repository touched: ${String(key)}`);
			},
		});
		await expect(invokeSequenceSimulateOperation({ repository: forbidden as never }, { id: definitionId, at })).rejects.toThrow("file repositories only");
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

describe("sequence simulation against a real Postgres database", () => {
	// A throwaway database keeps schema_missing and seeded cases isolated from
	// the shared listmonk_ops schema used by the runtime integration tests.
	const databaseName = `listmonk_ops_sim_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
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

	const source = (): SequenceSimulationSource => ({ kind: "postgres", databaseUrl: isolatedUrl });

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

	async function bootstrap() {
		const repository = createPostgresSequenceRepository({ connectionString: isolatedUrl, maxConnections: 1 });
		try {
			await repository.listDefinitions();
		} finally {
			await repository.close?.();
		}
	}

	postgresTest("a fresh database is a schema_missing refusal and simulation creates nothing", async () => {
		const error = await invokeSequenceSimulateOperation({ simulationSource: source() }, { id: definitionId, at }).catch((caught: unknown) => caught);
		expect(String((error as Error).message)).toContain("(schema_missing)");
		// The CI password ("listmonk") also appears in product names, so assert on the URL itself.
		expect(String((error as Error).message)).not.toContain(isolatedUrl);
		expect(String((error as Error).message)).not.toContain("://");
		expect(String((error as Error).message)).not.toContain(databaseName);
		expect((await snapshot(direct!)).namespaces).toEqual([]);
	});

	postgresTest("seeded runtime state simulates exactly like the file store without writes or advisory locks", async () => {
		const { definition, enrollment } = fixtures();
		const repository = createPostgresSequenceRepository({ connectionString: isolatedUrl, maxConnections: 1 });
		try {
			await repository.createDefinition(definition);
			await repository.createEnrollment(enrollment);
			// A second revision keeps the enrollment pinned to revision 1.
			await repository.updateDefinition(definitionId, { steps: [{ id: "stop", type: "stop" }] }, new Date("2026-01-01T12:00:00.000Z"));
		} finally {
			await repository.close?.();
		}
		const updated = await (async () => {
			const reader = createPostgresSequenceRepository({ connectionString: isolatedUrl, maxConnections: 1 });
			try {
				return await reader.getDefinition(definitionId);
			} finally {
				await reader.close?.();
			}
		})();
		const before = await snapshot(direct!);
		expect(before.relations.length).toBeGreaterThan(0);

		for (const input of [
			{ id: definitionId, at, subscriber, context: { tier: "pro" } },
			{ id: definitionId, enrollment_id: enrollmentId, at, subscriber },
		]) {
			const result = await invokeSequenceSimulateOperation({ simulationSource: source() }, input);
			expect(result).toEqual(await fileResult(updated, enrollment, input));
		}
		const pinned = await invokeSequenceSimulateOperation({ simulationSource: source() }, { id: definitionId, enrollment_id: enrollmentId, at, subscriber });
		expect(pinned).toMatchObject({ source: "enrollment", revision: 1, current_revision: 2, revision_changed: true, outcome: "unknown" });
		const missing = invokeSequenceSimulateOperation({ simulationSource: source() }, { id: randomUUID(), at });
		await expect(missing).rejects.toThrow("Unable to read matching sequence simulation snapshots");

		expect(await snapshot(direct!)).toEqual(before);
		const locks = await direct!<{ count: number }[]>`
			SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory'
		`;
		expect(locks[0]?.count).toBe(0);
	});

	postgresTest("an outdated schema version is refused and not migrated by simulation", async () => {
		// Bootstrap here so this test does not depend on the seeded-state test.
		await bootstrap();
		await direct!.unsafe(
			"UPDATE listmonk_ops.sequence_runtime_meta SET value = '2' WHERE key = 'schema_version'",
		);
		const before = await snapshot(direct!);
		const error = await invokeSequenceSimulateOperation({ simulationSource: source() }, { id: definitionId, at }).catch((caught: unknown) => caught);
		expect(String((error as Error).message)).toContain("(schema_outdated)");
		expect(await snapshot(direct!)).toEqual(before);
	});
});
