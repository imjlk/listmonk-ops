import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These tests run real argv through the CLI entry (or CLI_TEST_EXECUTABLE)
// against a local capture server, so they observe exactly what Gunshi parsed
// and what reached the Listmonk API. No real Listmonk instance is contacted.
const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = mkdtempSync(join(tmpdir(), "listmonk-cli-argv-"));

type CapturedRequest = {
	method: string;
	path: string;
	query: URLSearchParams;
};

const requests: CapturedRequest[] = [];

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const url = new URL(request.url);
		requests.push({
			method: request.method,
			path: url.pathname,
			query: url.searchParams,
		});
		if (/^\/api\/campaigns\/\d+$/.test(url.pathname)) {
			return Response.json({ data: { id: 1, name: "Campaign", lists: [] } });
		}
		return Response.json({
			data: { results: [], total: 0, page: 1, per_page: 20 },
		});
	},
});

afterAll(() => {
	server.stop(true);
	rmSync(home, { recursive: true, force: true });
});

beforeEach(() => {
	requests.length = 0;
});

async function runCli(args: string[]) {
	const executable = process.env.CLI_TEST_EXECUTABLE?.trim();
	const child = Bun.spawn(
		executable ? [executable, ...args] : ["bun", "src/index.ts", ...args],
		{
			cwd: cliDirectory,
			// A minimal environment keeps developer profiles and stores out of the run.
			env: {
				PATH: process.env.PATH ?? "",
				HOME: home,
				BUN_FORCE_COLOR: "0",
				LISTMONK_API_URL: `http://127.0.0.1:${server.port}/api`,
				LISTMONK_USERNAME: "argv-test",
				LISTMONK_API_TOKEN: "argv-test-token",
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("CLI argv parsing", () => {
	test("--no-body asks Listmonk to omit bodies", async () => {
		for (const [args, path] of [
			[["campaigns", "get", "--id", "1", "--no-body"], "/api/campaigns/1"],
			[["campaigns", "list", "--no-body"], "/api/campaigns"],
			[["templates", "list", "--no-body"], "/api/templates"],
		] as const) {
			requests.length = 0;
			const result = await runCli([...args, "--format=json"]);
			expect(result.exitCode).toBe(0);
			expect(requests).toHaveLength(1);
			expect(requests[0]?.path).toBe(path);
			expect(requests[0]?.query.get("no_body")).toBe("true");
		}
	}, 30_000);

	test("--no-body help shows the flag without a double negation", async () => {
		const result = await runCli(["campaigns", "get", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("--no-body");
		expect(result.stdout).not.toContain("--no-no-body");
	});
});
