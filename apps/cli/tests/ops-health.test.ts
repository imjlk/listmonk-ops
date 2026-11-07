import { afterAll, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const dir = mkdtempSync(join(tmpdir(), "ops-health-cli-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const at = "2026-11-07T00:00:00Z";
const source = join(dir, "sequences.json");
writeFileSync(
	source,
	JSON.stringify({
		version: 1,
		definitions: [],
		enrollments: [],
		workers: [{ status: "running", heartbeatAt: at }],
	}),
);
function cli(args: string[], environment: Record<string, string> = {}) {
	const executable = process.env.CLI_TEST_EXECUTABLE?.trim();
	return Bun.spawnSync(
		executable
			? [executable, ...args]
			: ["bun", resolve(import.meta.dir, "../src/index.ts"), ...args],
		{
			env: {
				...process.env,
				LISTMONK_API_TOKEN: "",
				LISTMONK_OPS_SEQUENCE_STORE: source,
				LISTMONK_OPS_SEQUENCE_DATABASE_URL: "",
				LISTMONK_OPS_WEBHOOK_STORE: "",
				LISTMONK_OPS_WEBHOOK_DATABASE_URL: "",
				LISTMONK_OPS_AUDIT_STORE: join(dir, "audit.json"),
				...environment,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
}
describe("ops health CLI", () => {
	test("healthy check exits zero and preserves JSON with no source/audit/outbox writes or auth", () => {
		const before = readFileSync(source);
		const result = cli([
			"ops",
			"health",
			"--scope",
			"sequences",
			"--at",
			at,
			"--check",
			"--format",
			"json",
		]);
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout.toString())).toMatchObject({
			severity: "healthy",
			check_passed: true,
		});
		expect(readFileSync(source)).toEqual(before);
		expect(readdirSync(dir)).toEqual(["sequences.json"]);
	});
	test("unknown check exits one but ordinary inspection remains zero and always emits the report", () => {
		const environment = {
			LISTMONK_OPS_SEQUENCE_STORE: join(dir, "missing.json"),
		};
		for (const check of [false, true]) {
			const result = cli(
				[
					"ops",
					"health",
					"--scope",
					"sequences",
					"--at",
					at,
					"--format",
					"json",
					...(check ? ["--check"] : []),
				],
				environment,
			);
			expect(result.exitCode).toBe(check ? 1 : 0);
			expect(JSON.parse(result.stdout.toString())).toMatchObject({
				severity: "unknown",
				check_passed: false,
			});
		}
		expect(readdirSync(dir)).toEqual(["sequences.json"]);
	});
	test("unsupported Postgres and conflicting webhook configuration never resolve mutation-capable lifecycle repositories", () => {
		const database = "postgres://private-user:private-password@127.0.0.1:1/private";
		const result = cli(
			["ops", "health", "--at", at, "--check", "--format", "json"],
			{
				LISTMONK_OPS_SEQUENCE_STORE: "",
				LISTMONK_OPS_SEQUENCE_DATABASE_URL: database,
				LISTMONK_OPS_WEBHOOK_STORE: join(dir, "outbox.json"),
				LISTMONK_OPS_WEBHOOK_DATABASE_URL: database,
			},
		);
		expect(result.exitCode).toBe(1);
		const report = JSON.parse(result.stdout.toString());
		expect(report.components.map((component: { availability: string }) => component.availability)).toEqual(
			["unsupported", "unavailable"],
		);
		expect(result.stdout.toString() + result.stderr.toString()).not.toContain(
			"private-password",
		);
		expect(readdirSync(dir)).toEqual(["sequences.json"]);
	});
});
