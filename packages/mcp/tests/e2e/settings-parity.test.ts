import { describe, expect, test } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPTestSuite } from "../mcp-helper.js";
import { TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

type CliResult = { exitCode: number; stdout: string; stderr: string };

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliSettingsCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "settings", ...args], {
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

describe("Settings CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("reads the same redacted settings through both adapters", async () => {
		const cliExit = runCliSettingsCommand(["--format", "json", "get"]);
		expect(cliExit.exitCode).toBe(0);
		const jsonStart = cliExit.stdout.indexOf("{");
		const cliSettings = JSON.parse(cliExit.stdout.slice(jsonStart)) as Record<
			string,
			unknown
		>;

		const mcpResult = await client.callTool("listmonk_get_settings");
		const mcpSettings = utils.assertSuccess<{
			settings?: Record<string, unknown>;
		}>(mcpResult, "Failed to read settings through MCP");

		expect(cliSettings["app.site_name"]).toBeTruthy();
		expect(mcpSettings.settings).toEqual(cliSettings);

		const serialized = JSON.stringify([cliSettings, mcpSettings]);
		// The Mailpit stack runs SMTP without auth; verify no credential
		// field could ever pass through by checking the redaction markers
		// machinery directly rather than for absent values.
		expect(serialized).not.toMatch(/"(?:password|client_secret)"\s*:\s*"(?!\[redacted\])/);
	});
});
