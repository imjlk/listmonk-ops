import { afterEach, describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runningProcesses: Bun.Subprocess[] = [];

function reservePort(): number {
	const server = Bun.serve({
		port: 0,
		fetch() {
			return new Response("ok");
		},
	});
	const { port } = server;
	server.stop(true);
	return port;
}

async function waitForHealth(url: string, timeoutMs = 5000): Promise<void> {
	const start = Date.now();

	while (Date.now() - start < timeoutMs) {
		try {
			const response = await fetch(url);
			if (response.ok) {
				return;
			}
		} catch {
			// Server not ready yet.
		}

		await Bun.sleep(100);
	}

	throw new Error(`Timed out waiting for MCP health endpoint at ${url}`);
}

afterEach(async () => {
	while (runningProcesses.length > 0) {
		const proc = runningProcesses.pop();
		if (!proc) {
			continue;
		}

		proc.kill();
		await proc.exited;
	}
});

describe("mcp runtime entrypoint", () => {
	test("published bin prints help through Bun", async () => {
		const proc = Bun.spawn({
			cmd: ["bun", "./bin/listmonk-mcp.js", "--help"],
			cwd: PACKAGE_ROOT,
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});

		const exitCode = await proc.exited;
		const stdout = await new Response(proc.stdout).text();
		const stderr = await new Response(proc.stderr).text();

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).toContain("Usage:");
		expect(stdout).toContain("listmonk-mcp");
	});

	test("published bin starts successfully with minimal Bun runtime config", async () => {
		const port = reservePort();
		const proc = Bun.spawn({
			cmd: [
				"bun",
				"./bin/listmonk-mcp.js",
				"--listmonk-url",
				"http://127.0.0.1:9000/api",
				"--listmonk-username",
				"api-admin",
				"--listmonk-api-token",
				"dummy-token",
				"--host",
				"127.0.0.1",
				"--port",
				String(port),
			],
			cwd: PACKAGE_ROOT,
			stdout: "pipe",
			stderr: "pipe",
			env: process.env,
		});
		runningProcesses.push(proc);

		await waitForHealth(`http://127.0.0.1:${port}/health`);

		const response = await fetch(`http://127.0.0.1:${port}/health`);
		const payload = await response.json();

		expect(response.ok).toBe(true);
		expect(payload).toMatchObject({ status: "ok" });
	});
});
