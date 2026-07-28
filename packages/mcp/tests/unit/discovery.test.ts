import { describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoveryTools,
	handleDiscoveryTools,
} from "../../src/handlers/discovery.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

const MCP_PACKAGE_DIRECTORY = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const PROJECT_ROOT = resolve(MCP_PACKAGE_DIRECTORY, "../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

function request(
	name: string,
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

const healthyClient = {
	getHealthCheck: async () => ({ data: true }),
} as unknown as ListmonkClient;

function runCliJson(args: string[]): Record<string, unknown> {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, ...args, "--format=json"], {
		cwd: CLI_DIRECTORY,
		env: {
			...process.env,
			BUN_FORCE_COLOR: "0",
			LISTMONK_API_TOKEN: "",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = `${result.stdout.toString()}${result.stderr.toString()}`.trim();
	if (result.exitCode !== 0) {
		throw new Error(`Discovery CLI failed: ${output}`);
	}
	const jsonStart = output.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(`Discovery CLI did not return JSON: ${output}`);
	}
	return JSON.parse(output.slice(jsonStart)) as Record<string, unknown>;
}

describe("agent discovery MCP adapter", () => {
	test("publishes seven typed read-only tools", () => {
		expect(discoveryTools).toHaveLength(7);
		expect(discoveryTools.map(({ name }) => name)).toEqual([
			"listmonk_schema_search",
			"listmonk_schema_describe",
			"listmonk_list_playbooks",
			"listmonk_playbook_get",
			"listmonk_capabilities",
			"listmonk_prime",
			"listmonk_status",
		]);
		for (const tool of discoveryTools) {
			expect(tool.annotations).toMatchObject({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			});
			expect(tool.inputSchema.type).toBe("object");
			expect(tool.outputSchema?.type).toBe("object");
		}
	});

	test("keeps schema search and capabilities in CLI/MCP parity", async () => {
		const cliSearch = runCliJson([
			"specs",
			"search",
			"--query",
			"schedule campaign",
			"--limit",
			"5",
		]);
		const mcpSearch = await handleDiscoveryTools(
			request("listmonk_schema_search", {
				query: "schedule campaign",
				limit: 5,
			}),
			healthyClient,
		);
		expect(mcpSearch.isError).not.toBe(true);
		expect(mcpSearch.structuredContent).toEqual(cliSearch);

		const cliCapabilities = runCliJson(["capabilities"]);
		const mcpCapabilities = await handleDiscoveryTools(
			request("listmonk_capabilities"),
			healthyClient,
		);
		expect(mcpCapabilities.structuredContent).toEqual(cliCapabilities);
	});

	test("reports MCP readiness and validates lookup input", async () => {
		const status = await handleDiscoveryTools(
			request("listmonk_status"),
			healthyClient,
			{
				url: "http://127.0.0.1:9000/api",
				auth: "token",
			},
		);
		expect(status.structuredContent).toMatchObject({
			surface: "mcp",
			target: {
				url: "http://127.0.0.1:9000/api",
				auth: "token",
			},
			listmonk: {
				configured: true,
				reachable: true,
			},
			readiness: {
				catalog: true,
				specs: true,
				listmonk: true,
			},
		});

		const invalid = await handleDiscoveryTools(
			request("listmonk_schema_describe", { operation: " " }),
			healthyClient,
		);
		expect(invalid.isError).toBe(true);
		expect(invalid.content[0]?.text).toContain(
			"Missing required parameter: operation",
		);
	});
});
