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
let transactionalAcknowledgement = true;

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
		if (url.pathname === "/api/tx") {
			return Response.json({ data: transactionalAcknowledgement });
		}
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
	transactionalAcknowledgement = true;
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

	test("malformed ID lists fail before any request instead of shrinking the set", async () => {
		const create = await runCli([
			"campaigns",
			"create",
			"--name",
			"Weekly update",
			"--subject",
			"News",
			"--from-email",
			"ops@example.com",
			"--body",
			"<p>Hello</p>",
			"--template-id",
			"1",
			"--lists",
			"12,O4",
			"--format=json",
		]);
		expect(create.exitCode).not.toBe(0);
		expect(create.stdout).toBe("");
		expect(JSON.parse(create.stderr).error.message).toContain(
			"Invalid list IDs 'O4': expected a positive integer",
		);

		const update = await runCli([
			"subscribers",
			"update",
			"--id",
			"7",
			"--lists",
			"1,2x,3",
			"--format=json",
		]);
		expect(update.exitCode).not.toBe(0);
		expect(JSON.parse(update.stderr).error.message).toContain(
			"Invalid list IDs '2x': expected a positive integer",
		);
		expect(requests).toEqual([]);
	}, 30_000);

	test("scalar ID options reject hexadecimal and exponent forms", async () => {
		for (const id of ["0x10", "1e1"]) {
			const result = await runCli(["campaigns", "get", "--id", id, "--format=json"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toBe("");
			expect(JSON.parse(result.stderr).error.message).toContain(
				`--id: expected a positive decimal integer, received "${id}"`,
			);
		}
		expect(requests).toEqual([]);

		const accepted = await runCli(["campaigns", "get", "--id", "16", "--format=json"]);
		expect(accepted.exitCode).toBe(0);
		expect(requests.map((request) => request.path)).toEqual([
			"/api/campaigns/16",
		]);
	}, 30_000);

	test("tx send exits nonzero with parseable output when Listmonk rejects it", async () => {
		const send = [
			"tx",
			"send",
			"--template-id",
			"3",
			"--subscriber-email",
			"reader@example.com",
		];
		const accepted = await runCli([...send, "--format=json"]);
		expect(accepted.exitCode).toBe(0);
		expect(JSON.parse(accepted.stdout)).toEqual({
			sent: true,
			status: "accepted",
		});

		transactionalAcknowledgement = false;
		const rejected = await runCli([...send, "--format=json"]);
		expect(rejected.exitCode).toBe(1);
		expect(JSON.parse(rejected.stdout)).toEqual({
			sent: false,
			status: "failed",
		});
		expect(JSON.parse(rejected.stderr).diagnostics).toContainEqual({
			level: "warning",
			message: "Transactional message was rejected by Listmonk",
		});

		const quiet = await runCli([...send, "--format=quiet"]);
		expect(quiet.exitCode).toBe(1);
		expect(JSON.parse(quiet.stdout)).toEqual({ sent: false, status: "failed" });
		expect(quiet.stderr).toBe("");

		const human = await runCli(send);
		expect(human.exitCode).toBe(1);
		expect(human.stdout).toContain(
			"⚠️  Transactional message was rejected by Listmonk",
		);
		expect(human.stdout).not.toContain("✅");
		expect(requests.filter((request) => request.path === "/api/tx")).toHaveLength(4);
	}, 30_000);

	test("the abtest create example passes argument validation", async () => {
		const listing = await runCli(["examples", "--format=json"]);
		expect(listing.exitCode).toBe(0);
		const example = (JSON.parse(listing.stdout).examples as string[]).find(
			(line) => line.startsWith("listmonk-cli abtest create "),
		);
		// Split the documented shell line the way a POSIX shell would for its
		// simple quoting: single- or double-quoted words, otherwise whitespace.
		const argv = [
			...(example ?? "").matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g),
		].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
		expect(argv.slice(0, 3)).toEqual(["listmonk-cli", "abtest", "create"]);

		requests.length = 0;
		const result = await runCli([...argv.slice(1), "--format=json"]);
		expect(result.stderr).not.toMatch(/is required|Unknown option/);
		// Reaching Listmonk proves every required argument parsed and validated.
		expect(requests.length).toBeGreaterThan(0);
	}, 30_000);

	test("--no-body help shows the flag without a double negation", async () => {
		const result = await runCli(["campaigns", "get", "--help"]);
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("--no-body");
		expect(result.stdout).not.toContain("--no-no-body");
	});
});
