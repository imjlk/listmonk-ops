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

type BounceListPage = {
	results?: { id?: number }[];
	total?: number;
	per_page?: number;
	page?: number;
};

type BounceSummary = { id?: number };

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliBouncesCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "bounces", ...args], {
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
			`CLI bounces ${operation} failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}

	const jsonStart = Math.min(
		...["{", "["]
			.map((marker) => result.stdout.indexOf(marker))
			.filter((index) => index >= 0),
	);
	if (!Number.isFinite(jsonStart)) {
		throw new Error(
			`CLI bounces ${operation} did not return a JSON result: ${diagnosticOutput}`,
		);
	}
	return JSON.parse(result.stdout.slice(jsonStart)) as T;
}

describe("Bounces CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("lists the same bounce page through both adapters", async () => {
		// The CLI list command renders its records as a table, so `--format
		// json` emits the record array while MCP returns the full page
		// envelope. Parity therefore compares the record ids of the same
		// requested page window rather than timestamps or metadata.
		const cliBounces = parseCliJson<BounceSummary[]>(
			runCliBouncesCommand([
				"--format",
				"json",
				"list",
				"--page",
				"1",
				"--per-page",
				"5",
			]),
			"list",
		);

		const mcpResult = await client.callTool("listmonk_get_bounces", {
			page: 1,
			per_page: 5,
		});
		const mcpPage = utils.assertSuccess<BounceListPage>(
			mcpResult,
			"Failed to list bounces through MCP",
		);

		expect(mcpPage.page).toBe(1);
		expect(mcpPage.per_page).toBe(5);
		expect(mcpPage.results?.map((bounce) => bounce.id)).toEqual(
			cliBounces.map((bounce) => bounce.id),
		);
	});

	test("rejects an unsupported filter identically on both adapters", async () => {
		const cliFailure = runCliBouncesCommand([
			"list",
			"--order-by",
			"total",
		]);
		expect(cliFailure.exitCode).not.toBe(0);

		const mcpFailure = await client.callTool("listmonk_get_bounces", {
			order_by: "total",
		});
		utils.assertError(mcpFailure, "order_by");
	});

	test("surfaces a missing bounce through both adapters", async () => {
		// Bounce ids are dense but unbounded; a far-out id is safely absent
		// on every local stack state.
		const missingId = 9_000_001;
		const cliFailure = runCliBouncesCommand([
			"get",
			"--id",
			String(missingId),
		]);
		expect(cliFailure.exitCode).not.toBe(0);

		const mcpFailure = await client.callTool("listmonk_get_bounce", {
			id: missingId,
		});
		utils.assertError(mcpFailure);
	});
});
