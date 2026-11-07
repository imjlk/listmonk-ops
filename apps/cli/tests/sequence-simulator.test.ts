import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = mkdtempSync(join(tmpdir(), "sequence-simulator-cli-"));
const store = join(directory, "must-not-exist.json");
afterAll(() => rmSync(directory, { recursive: true, force: true }));
async function run(args: string[]) {
	const child = Bun.spawn(
		[
			"bun",
			"src/index.ts",
			"sequences",
			"simulate",
			"--format",
			"json",
			...args,
		],
		{
			cwd: cliDirectory,
			env: {
				...process.env,
				BUN_FORCE_COLOR: "0",
				LISTMONK_OPS_SEQUENCE_STORE: store,
				LISTMONK_OPS_SEQUENCE_DATABASE_URL: "postgres://unused.invalid/not-used",
				LISTMONK_OPS_AUDIT_STORE: join(directory, "audit.json"),
				LISTMONK_API_URL: "http://unused.invalid/api",
				LISTMONK_USERNAME: "",
				LISTMONK_API_TOKEN: "",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, code };
}
describe("sequence simulator CLI", () => {
	test("offline steps need no auth/repository even with conflicting database configuration", async () => {
		const steps = JSON.stringify([
			{
				id: "condition",
				type: "condition",
				path: "tier",
				operator: "equals",
				value: "pro",
				on_true: "wait",
				on_false: "stop",
			},
			{ id: "wait", type: "wait", duration_seconds: 60 },
			{ id: "send", type: "send", template_id: 3 },
			{ id: "stop", type: "stop" },
		]);
		const result = await run(["--at", "2026-01-01T00:00:00Z", "--steps", steps, "--context", '{"tier":"pro"}', "--subscriber", '{"status":"enabled","lists":[],"email":"secret@example.test"}']);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		const output = JSON.parse(result.stdout);
		expect(output.source).toBe("steps");
		expect(output.outcome).toBe("send_boundary");
		expect(output.timeline[1].earliest_next_at).toBe("2026-01-01T00:01:00.000Z");
		expect(result.stdout).not.toContain("secret@example.test");
		expect(existsSync(store)).toBe(false);
	}, 15000);
	test("missing fixed clock, unsupported steps and malformed JSON fail safely without touching state", async () => {
		const stop = JSON.stringify([{ id: "stop", type: "stop" }]);
		for (const args of [["--steps", stop], ["--at", "2026-01-01T00:00:00Z", "--steps", '[{"id":"unsupported","type":"future"}]'], ["--at", "2026-01-01T00:00:00Z", "--steps", "{private-json-secret"]]) {
			const result = await run(args);
			expect(result.code).not.toBe(0);
			expect(result.stdout + result.stderr).not.toContain("private-json-secret");
		}
		expect(existsSync(store)).toBe(false);
	}, 15000);
});
