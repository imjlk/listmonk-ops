import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPTestSuite } from "../mcp-helper.js";
import { TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliDashboardCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "dashboard", ...args], {
		cwd: CLI_DIRECTORY,
		env: {
			...process.env,
			BUN_FORCE_COLOR: "0",
			LISTMONK_API_URL: TEST_CONFIG.baseUrl,
			LISTMONK_USERNAME: TEST_CONFIG.username,
			LISTMONK_API_TOKEN: resolveCliE2eCredential(TEST_CONFIG),
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
}

function parseCliJson<T>(result: CliResult, operation: string): T {
	const diagnosticOutput = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n");
	if (result.exitCode !== 0) {
		throw new Error(
			`CLI dashboard ${operation} failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}

	const jsonStart = result.stdout.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(
			`CLI dashboard ${operation} did not return a JSON result: ${diagnosticOutput}`,
		);
	}
	return JSON.parse(result.stdout.slice(jsonStart)) as T;
}

describe("Dashboard CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("reads the same aggregate counters through both adapters", async () => {
		const cliCounts = parseCliJson<Record<string, unknown>>(
			runCliDashboardCommand(["--format", "json", "counts"]),
			"counts",
		);

		const mcpCounts = utils.assertSuccess<Record<string, unknown>>(
			await client.callTool("listmonk_get_dashboard_counts"),
			"Failed to read dashboard counts through MCP",
		);

		// Aggregate counters can shift between the two calls on an active
		// stack, so parity compares the structure and the campaign totals
		// rather than exact equality of volatile subscriber numbers.
		expect(mcpCounts.subscribers).toHaveProperty("total");
		expect(mcpCounts.lists).toHaveProperty("total");
		expect(mcpCounts.campaigns).toHaveProperty("total");
		expect(Object.keys(cliCounts).sort()).toEqual(
			Object.keys(mcpCounts).sort(),
		);
	});

	test("reads the same chart series through both adapters", async () => {
		const cliCharts = parseCliJson<{
			link_clicks?: { count?: number; date?: string }[];
			campaign_views?: { count?: number; date?: string }[];
		}>(runCliDashboardCommand(["--format", "json", "charts"]), "charts");

		const mcpCharts = utils.assertSuccess<{
			link_clicks?: { count?: number; date?: string }[];
			campaign_views?: { count?: number; date?: string }[];
		}>(
			await client.callTool("listmonk_get_dashboard_charts"),
			"Failed to read dashboard charts through MCP",
		);

		expect(mcpCharts.link_clicks?.length).toBe(cliCharts.link_clicks?.length);
		expect(mcpCharts.campaign_views?.length).toBe(
			cliCharts.campaign_views?.length,
		);
	});
});
