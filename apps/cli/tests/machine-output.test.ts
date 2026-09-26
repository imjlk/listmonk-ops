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

const executable = process.env.CLI_TEST_EXECUTABLE?.trim();
const noisyDependencyPreload = resolve(
	cliDirectory,
	"tests/fixtures/noisy-dependency-preload.ts",
);

function spawnCli(args: string[], options: { preload?: string } = {}) {
	const command = executable
		? [executable, ...args]
		: [
				"bun",
				...(options.preload ? ["--preload", options.preload] : []),
				"src/index.ts",
				...args,
			];
	return Bun.spawn(command, {
		cwd: cliDirectory,
		env: {
			...process.env,
			BUN_FORCE_COLOR: "0",
			LISTMONK_API_URL: `http://127.0.0.1:${server.port}/api`,
			LISTMONK_USERNAME: "machine-test",
			LISTMONK_API_TOKEN: "machine-test-token",
			LISTMONK_OPS_AUDIT_STORE: join(temporaryDirectory, "audit.json"),
			LISTMONK_OPS_WEBHOOK_STORE: join(temporaryDirectory, "webhooks.json"),
			LISTMONK_OPS_WEBHOOK_DATABASE_URL: "",
			LISTMONK_OPS_SEQUENCE_DATABASE_URL: "",
			LISTMONK_OPS_SEQUENCE_STORE: join(temporaryDirectory, "sequences.json"),
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

async function runCli(args: string[], options: { preload?: string } = {}) {
	const child = spawnCli(args, options);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("CLI machine output", () => {
	for (const format of ["human", "json", "ndjson", "quiet"]) {
		test(`preserves the complete large operation catalog in ${format} mode`, async () => {
			const result = await runCli(["operations", "--format", format]);
			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			const start = format === "human" ? result.stdout.indexOf("{") : 0;
			const catalog = JSON.parse(result.stdout.slice(start));
			expect(catalog.operations.length).toBeGreaterThan(100);
			expect(catalog.operations.every((operation: { id?: unknown }) => typeof operation.id === "string")).toBe(true);
		}, 15_000);
	}
	for (const worker of [["sequences", "worker"], ["webhooks", "runtime", "worker"]]) {
		test(`${worker.join(" ")} streams NDJSON diagnostics beyond the JSON buffer limit`, async () => {
			const child = spawnCli([...worker, "--confirm", "--format=ndjson", "--interval-ms=250"]);
			const stdoutPromise = new Response(child.stdout).text();
			const reader = child.stderr.getReader();
			const decoder = new TextDecoder();
			const records: Array<{ diagnostic: { level: string; message: string } }> = [];
			let buffer = "";
			const timeout = setTimeout(() => child.kill("SIGTERM"), 15_000);
			try {
				while (records.length < 22) {
					const chunk = await reader.read();
					if (chunk.done) break;
					buffer += decoder.decode(chunk.value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) if (line.trim()) records.push(JSON.parse(line));
				}
			} finally {
				clearTimeout(timeout);
				child.kill("SIGTERM");
				const forceStop = setTimeout(() => child.kill("SIGKILL"), 5_000);
				try {
					let remainder = await reader.read();
					while (!remainder.done) remainder = await reader.read();
					await child.exited;
				} finally {
					clearTimeout(forceStop);
					reader.releaseLock();
				}
			}
			await stdoutPromise;
			expect(child.exitCode).toBe(0);
			expect(records.length).toBeGreaterThan(20);
			expect(records.every((record) => record.diagnostic.level === "info")).toBe(true);
			expect(records[0]?.diagnostic.message).toContain("worker started");
		}, 20_000);
		test(`${worker.join(" ")} rejects buffered JSON mode before starting`, async () => {
			const result = await runCli([...worker, "--confirm", "--format=json"]);
			expect(result.exitCode).not.toBe(0);
			expect(result.stdout).toBe("");
			expect(JSON.parse(result.stderr).error.message).toContain("--format ndjson");
		});
	}

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
				else if (format === "json") expect(JSON.parse(result.stderr).diagnostics[0].level).toBe("info");
				else expect(JSON.parse(result.stderr).diagnostic.level).toBe("info");
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
		const completion = await runCli(["complete", "zsh", "--format=json"]);
		expect(completion.exitCode).toBe(0);
		expect(completion.stdout).toStartWith("#compdef listmonk-cli");
	});
	// A preload can only inject the noisy dependency into the source entrypoint.
	test.skipIf(Boolean(executable))(
		"stray dependency logs during a command stay off machine stdout",
		async () => {
			const noisy = { level: "info", message: "noisy dependency log" };
			for (const format of ["json", "ndjson", "quiet"]) {
				const result = await runCli(["lists", "list", "--format", format], {
					preload: noisyDependencyPreload,
				});
				expect(result.exitCode).toBe(0);
				expect(JSON.parse(result.stdout)).toEqual([]);
				if (format === "quiet") {
					expect(result.stderr).toBe("");
				} else if (format === "json") {
					expect(JSON.parse(result.stderr).diagnostics).toContainEqual(noisy);
				} else {
					const records = result.stderr.trim().split("\n").map((line) => JSON.parse(line));
					expect(records).toContainEqual({ diagnostic: noisy });
				}
			}
			const human = await runCli(["lists", "list"], {
				preload: noisyDependencyPreload,
			});
			expect(human.exitCode).toBe(0);
			expect(human.stdout).toContain("noisy dependency log");
		},
		20_000,
	);
});
