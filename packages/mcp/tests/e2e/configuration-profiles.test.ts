import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEST_CONFIG } from "../setup";

const projectRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);

test("CLI and MCP authenticate to local Listmonk with the same token-file profile", async () => {
	const home = await mkdtemp(join(tmpdir(), "listmonk-profile-e2e-"));
	const configFile = join(home, "profiles.json");
	const tokenFile = join(home, "token");
	await writeFile(tokenFile, TEST_CONFIG.apiToken || TEST_CONFIG.password, { mode: 0o600 });
	await writeFile(configFile, JSON.stringify({ schemaVersion: 1, profiles: { local: { baseUrl: TEST_CONFIG.baseUrl, username: TEST_CONFIG.username, tokenFile: "token" } } }));
	const env = {
		...process.env,
		HOME: home,
		LISTMONK_API_URL: "http://127.0.0.1:1/api",
		LISTMONK_USERNAME: "ignored",
		LISTMONK_API_TOKEN: "ignored",
	};
	const transport = new StdioClientTransport({
		command: "bun",
		args: ["src/index.ts", "--stdio", "--config", configFile, "--profile=local"],
		cwd: join(projectRoot, "packages/mcp"),
		env,
		stderr: "pipe",
	});
	const client = new Client({ name: "profile-e2e", version: "1.0.0" });
	try {
		const child = Bun.spawn(
			[
				"bun",
				"src/index.ts",
				"status",
				"--check",
				"--format=json",
				"--config",
				configFile,
				"--profile=local",
				"--permissions=lists,subscribers,campaigns",
			],
			{
				cwd: join(projectRoot, "apps/cli"),
				env,
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		expect(code).toBe(0);
		expect(stderr).toBe("");
		const cli = JSON.parse(stdout);
		await client.connect(transport);
		const result = await client.callTool({ name: "listmonk_status", arguments: { permissions: ["lists", "subscribers", "campaigns"] } });
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent?.listmonk).toEqual(cli.listmonk);
		expect(result.structuredContent?.readiness).toEqual(cli.readiness);
		expect(cli.readiness.listmonk).toBe(true);
	} finally {
		await client.close();
		await rm(home, { recursive: true, force: true });
	}
});
