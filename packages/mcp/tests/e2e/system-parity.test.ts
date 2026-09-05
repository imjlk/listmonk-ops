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

function runCliSystemCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "system", ...args], {
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
			`CLI system ${operation} failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}
	const jsonStart = result.stdout.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(
			`CLI system ${operation} did not return a JSON result: ${diagnosticOutput}`,
		);
	}
	return JSON.parse(result.stdout.slice(jsonStart)) as T;
}

describe("System CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("reads the same build identity through both adapters", async () => {
		const cliAbout = parseCliJson<{ version?: string; build?: string }>(
			runCliSystemCommand(["--format", "json", "about"]),
			"about",
		);
		expect(cliAbout.version).toBeTruthy();

		const mcpAbout = utils.assertSuccess<{ version?: string; build?: string }>(
			await client.callTool("listmonk_get_about"),
			"Failed to read build identity through MCP",
		);
		expect(mcpAbout.version).toBe(cliAbout.version);
		expect(mcpAbout.build).toBe(cliAbout.build);
	});

	test("reads the same server logs through both adapters", async () => {
		const cliLogs = parseCliJson<{ logs?: string[] }>(
			runCliSystemCommand(["--format", "json", "logs"]),
			"logs",
		);
		expect(Array.isArray(cliLogs.logs)).toBe(true);

		const mcpLogs = utils.assertSuccess<{ logs?: string[] }>(
			await client.callTool("listmonk_get_logs"),
			"Failed to read server logs through MCP",
		);
		expect(mcpLogs.logs?.[0]).toBe(cliLogs.logs?.[0]);
		expect(mcpLogs.logs?.length).toBe(cliLogs.logs?.length);
	});
});
