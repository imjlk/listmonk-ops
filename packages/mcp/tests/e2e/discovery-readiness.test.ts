import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListmonkMCPServer } from "../../src/server.js";
import { createMCPTestSuite } from "../mcp-helper.js";
import { TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

type ReadinessOutput = {
	surface: "cli" | "mcp";
	specs: {
		schema_version: string;
		operations: number;
		described: number;
		migrations: number;
	};
	listmonk: {
		configured: boolean;
		reachable: boolean;
		authentication: { state: string };
	};
	target?: {
		url: string;
		auth: "token" | "none";
	};
	readiness: {
		catalog: boolean;
		specs: boolean;
		listmonk: boolean;
	};
};

function runCliStatus(credential = TEST_CONFIG.apiToken || TEST_CONFIG.password, expectedExit = 0): ReadinessOutput {
	const result = Bun.spawnSync(
		[
			"bun",
			CLI_ENTRY,
			"--format",
			"ndjson",
			"status",
			"--check",
			"--permissions=lists,subscribers,campaigns",
		],
		{
			cwd: CLI_DIRECTORY,
			env: {
				...process.env,
				BUN_FORCE_COLOR: "0",
				LISTMONK_API_URL: TEST_CONFIG.baseUrl,
				LISTMONK_USERNAME: TEST_CONFIG.username,
				LISTMONK_API_TOKEN: credential,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const stdout = result.stdout.toString().trim();
	const diagnostics = `${stdout}\n${result.stderr.toString()}`.trim();
	if (result.exitCode !== expectedExit) {
		throw new Error(`CLI readiness failed: ${diagnostics}`);
	}
	const line = stdout.split(/\r?\n/u).filter(Boolean).at(-1);
	if (line === undefined) {
		throw new Error(`CLI readiness returned no JSON: ${diagnostics}`);
	}
	return JSON.parse(line) as ReadinessOutput;
}

describe("agent discovery local-stack readiness", () => {
	const { client, utils } = createMCPTestSuite();

	test("rejects invalid credentials through both adapters despite healthy public endpoint", async () => {
		const invalidToken = "readiness-invalid-token";
		const cli = runCliStatus(invalidToken, 1);
		const server = createListmonkMCPServer({
			baseUrl: TEST_CONFIG.baseUrl,
			username: TEST_CONFIG.username,
			apiToken: invalidToken,
		});
		const response = await server.callTool({ method: "tools/call", params: { name: "listmonk_status", arguments: { permissions: ["lists", "subscribers", "campaigns"] } } });
		const mcp = utils.assertSuccess<ReadinessOutput>(response);
		expect(cli.listmonk.reachable).toBe(true);
		expect(cli.listmonk.authentication.state).toBe("denied");
		expect(cli.readiness.listmonk).toBe(false);
		expect(mcp.listmonk).toEqual(cli.listmonk);
		expect(mcp.readiness).toEqual(cli.readiness);
	});

	test("reports the same typed catalog and reachable Listmonk through CLI and MCP", async () => {
		const cli = runCliStatus();
		const mcpResult = await client.callTool("listmonk_status", { permissions: ["lists", "subscribers", "campaigns"] });
		const mcp = utils.assertSuccess<ReadinessOutput>(
			mcpResult,
			"MCP readiness failed",
		);

		expect(cli.surface).toBe("cli");
		expect(mcp.surface).toBe("mcp");
		expect(cli.specs).toEqual(mcp.specs);
		expect(cli.listmonk).toMatchObject({
			configured: true,
			reachable: true,
		});
		expect(mcp.listmonk).toMatchObject({
			configured: true,
			reachable: true,
		});
		expect(mcp.listmonk).toEqual(cli.listmonk);
		expect(mcp.target).toEqual(cli.target);
		expect(cli.readiness).toEqual({
			catalog: true,
			specs: true,
			listmonk: true,
		});
		expect(mcp.readiness).toEqual(cli.readiness);
	});
});
