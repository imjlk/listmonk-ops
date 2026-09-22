import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = mkdtempSync(
	join(tmpdir(), "listmonk-machine-output-"),
);
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch() {
		return Response.json({
			data: { results: [], total: 0, page: 1, per_page: 20 },
		});
	},
});
afterAll(() => {
	server.stop(true);
	rmSync(temporaryDirectory, { recursive: true, force: true });
});

async function runCli(args: string[]) {
	const executable = process.env.CLI_TEST_EXECUTABLE?.trim();
	const command = executable
		? [executable, ...args]
		: ["bun", "src/index.ts", ...args];
	const child = Bun.spawn(command, {
		cwd: cliDirectory,
		env: {
			...process.env,
			BUN_FORCE_COLOR: "0",
			LISTMONK_API_URL: `http://127.0.0.1:${server.port}/api`,
			LISTMONK_USERNAME: "machine-test",
			LISTMONK_API_TOKEN: "machine-test-token",
			LISTMONK_OPS_AUDIT_STORE: join(temporaryDirectory, "audit.json"),
			LISTMONK_OPS_WEBHOOK_STORE: join(temporaryDirectory, "webhooks.json"),
			LISTMONK_OPS_SEQUENCE_STORE: join(temporaryDirectory, "sequences.json"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("CLI machine output", () => {
	for (const format of ["json", "ndjson", "quiet"]) {
		test(`${format} discovery stdout parses without removing banners`, async () => {
			const result = await runCli(["capabilities", `--format=${format}`]);
			expect(result.exitCode).toBe(0);
			expect(JSON.parse(result.stdout).operations).toBeGreaterThan(0);
			if (format !== "json") expect(result.stdout.trim().split("\n")).toHaveLength(1);
		});
		test(`${format} lists return an empty array for every resource family`, async () => {
			for (const family of ["campaigns", "lists", "subscribers", "templates", "media", "bounces"]) {
				const result = await runCli([family, "list", "--format", format]);
				expect(result.exitCode).toBe(0);
				expect(JSON.parse(result.stdout)).toEqual([]);
				if (format === "quiet") expect(result.stderr).toBe("");
			}
		}, 20_000);
		test(`${format} validation errors are structured stderr with no stdout`, async () => {
			const result = await runCli(["campaigns", "get", "--id", "0", "--format", format]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toBe("");
			expect(JSON.parse(result.stderr)).toMatchObject({
				error: { code: "cli_error" },
			});
			expect(JSON.parse(result.stderr).error.message).toContain("--id");
		});
	}
	test("human errors contain the diagnostic without minified source or a stack", async () => {
		const result = await runCli(["campaigns", "get", "--id", "0"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("--id");
		expect(result.stderr.length).toBeLessThan(500);
		expect(result.stderr).not.toMatch(/\$bunfs|\n\s+at |\d+ \|/);
	});
	test("machine mode rejects prompts and Markdown-only output before execution", async () => {
		for (const args of [["--interactive", "lists", "list"], ["abtest", "interactive"], ["ops", "digest", "--markdown-only"]]) {
			const result = await runCli([...args, "--format=json"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toBe("");
			expect(JSON.parse(result.stderr).error.message).toContain(
				"--format human",
			);
		}
	});
	test("invalid global flags use compact diagnostics", async () => {
		const result = await runCli(["status", "--format"]);
		expect(result.exitCode).not.toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("--format requires");
		expect(result.stderr.length).toBeLessThan(500);
	});
	test("explicit help and version remain text in machine mode", async () => {
		const help = await runCli(["abtest", "interactive", "--help", "--format=json"]);
		expect(help.exitCode).toBe(0);
		expect(help.stdout).toContain("interactive");
		const version = await runCli(["--version", "--format=json"]);
		expect(version.exitCode).toBe(0);
		expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
	});
});
