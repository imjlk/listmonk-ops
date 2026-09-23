import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveListmonkConfiguration } from "@listmonk-ops/common";
import { createListmonkMCPServer } from "../../src/server";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("MCP observes token-file rotation between calls and does not reuse an old token after read failure", async () => {
	const home = await mkdtemp(join(tmpdir(), "mcp-token-rotation-"));
	directories.push(home);
	const tokenFile = join(home, "token");
	await writeFile(tokenFile, "first");
	let expectedToken = "first";
	let authenticatedCalls = 0;
	const backend = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			if (new URL(request.url).pathname === "/health") return Response.json({ data: true });
			authenticatedCalls++;
			if (request.headers.get("authorization") !== `token test:${expectedToken}`) return Response.json({ message: "rejected" }, { status: 403 });
			return Response.json({ version: "6.2.0" });
		},
	});
	try {
		const resolved = await resolveListmonkConfiguration({ homeDirectory: home, env: {}, baseUrl: `http://127.0.0.1:${backend.port}/api`, username: "test", tokenFile });
		const server = createListmonkMCPServer({
			baseUrl: resolved.summary.baseUrl,
			username: resolved.summary.username,
			apiToken: "unused-fallback",
			credentialProvider: resolved.readCredential,
			configuration: resolved.summary,
		});
		const request = {
			method: "tools/call" as const,
			params: { name: "listmonk_status", arguments: {} },
		};
		const first = await server.callTool(request);
		expect(first.structuredContent).toMatchObject({
			readiness: { listmonk: true },
		});
		expectedToken = "second";
		await writeFile(`${tokenFile}.new`, expectedToken);
		await rename(`${tokenFile}.new`, tokenFile);
		const second = await server.callTool(request);
		expect(second.structuredContent).toMatchObject({
			readiness: { listmonk: true },
		});
		expect(authenticatedCalls).toBe(2);
		await rm(tokenFile);
		const missing = await server.callTool(request);
		expect(missing.isError).toBe(true);
		expect(authenticatedCalls).toBe(2);
		const metadata = await server.callTool({ method: "tools/call", params: { name: "listmonk_capabilities", arguments: {} } });
		expect(metadata.isError).not.toBe(true);
		const config = await server.callTool({ method: "tools/call", params: { name: "listmonk_config", arguments: {} } });
		expect(config.structuredContent).toEqual(resolved.summary);
		expect(JSON.stringify(config)).not.toContain("unused-fallback");
	} finally {
		backend.stop(true);
	}
});

test("published MCP and CLI load the same profile and expose the same secret-free sources", async () => {
	const home = await mkdtemp(join(tmpdir(), "profile-adapter-parity-"));
	directories.push(home);
	const configFile = join(home, "profiles.json");
	await writeFile(join(home, "token"), "profile-secret");
	await writeFile(configFile, JSON.stringify({ schemaVersion: 1, profiles: { selected: { baseUrl: "http://127.0.0.1:1/api", username: "profile-user", tokenFile: "token" } } }));
	const projectRoot = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"../../../..",
	);
	const env = {
		...process.env,
		HOME: home,
		LISTMONK_API_URL: "https://wrong.test",
		LISTMONK_API_TOKEN: "wrong-secret",
		LISTMONK_USERNAME: "wrong-user",
	};
	const child = Bun.spawn(
		[
			"bun",
			"src/index.ts",
			"config",
			"show",
			"--config",
			configFile,
			"--profile",
			"selected",
			"--format=json",
		],
		{ cwd: join(projectRoot, "apps/cli"), env, stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
	expect(code).toBe(0);
	expect(stderr).toBe("");
	const transport = new StdioClientTransport({
		command: "bun",
		args: [
			"./bin/listmonk-mcp.js",
			"--stdio",
			"--config",
			configFile,
			"--profile=selected",
		],
		cwd: join(projectRoot, "packages/mcp"),
		env,
		stderr: "pipe",
	});
	const client = new Client({ name: "profile-parity", version: "1.0.0" });
	try {
		await client.connect(transport);
		const result = await client.callTool({ name: "listmonk_config", arguments: {} });
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual(JSON.parse(stdout));
		expect(JSON.stringify(result)).not.toContain("profile-secret");
		expect(JSON.stringify(result)).not.toContain("wrong-secret");
	} finally {
		await client.close();
	}
});
