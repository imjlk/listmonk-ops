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

function runCliMaintenanceCommand(args: string[]): CliResult {
	const result = Bun.spawnSync(["bun", CLI_ENTRY, "maintenance", ...args], {
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

describe("Maintenance CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("enforces confirmation on both destructive collections", async () => {
		const blocked = runCliMaintenanceCommand([
			"gc-subscribers",
			"--type",
			"orphan",
		]);
		expect(blocked.exitCode).not.toBe(0);
		expect(`${blocked.stdout}${blocked.stderr}`).toContain(
			"requires explicit confirmation",
		);

		const blockedMcp = await client.callTool("listmonk_gc_subscribers", {
			type: "orphan",
		});
		utils.assertError(blockedMcp, "requires explicit confirmation");

		const blockedUnconfirmed = await client.callTool(
			"listmonk_gc_unconfirmed_subscriptions",
			{ before_date: "2020-01-01T00:00:00Z" },
		);
		utils.assertError(blockedUnconfirmed, "requires explicit confirmation");

		const blockedAnalytics = await client.callTool("listmonk_gc_analytics", {
			type: "views",
			before_date: "2020-01-01T00:00:00Z",
		});
		utils.assertError(blockedAnalytics, "requires explicit confirmation");
	});

	test("runs the safe no-op collections through both adapters", async () => {
		// The orphan GC already emptied the local set during probing, so a
		// confirmed run is a documented count-0 no-op — exactly the retry
		// convergence the spec describes, exercised live on both surfaces.
		const confirmedMcp = utils.assertSuccess<{ type?: string; count?: number }>(
			await client.callTool("listmonk_gc_subscribers", {
				type: "orphan",
				confirm: true,
			}),
			"Failed to run the orphan collection through MCP",
		);
		expect(confirmedMcp).toMatchObject({ type: "orphan" });
		expect(confirmedMcp.count).toBeGreaterThanOrEqual(0);

		const cliExit = runCliMaintenanceCommand([
			"--format",
			"json",
			"gc-unconfirmed",
			"--before-date",
			"2020-01-01T00:00:00Z",
			"--confirm",
		]);
		expect(cliExit.exitCode).toBe(0);
		const jsonStart = cliExit.stdout.indexOf("{");
		const cliResult = JSON.parse(cliExit.stdout.slice(jsonStart)) as {
			count?: number;
		};
		expect(cliResult.count).toBeGreaterThanOrEqual(0);
		// system.reload is deliberately NOT exercised here: the observed
		// reload gracefully restarts the HTTP server in-process and drops
		// concurrent sockets, breaking tests that run after this file.
	});

	test("collects pre-history analytics through both adapters", async () => {
		// A cutoff predating the stack deletes nothing on any state — the
		// server still answers its bare boolean acknowledgement — so the
		// destructive path is exercised live without losing analytics.
		const cutoff = "2020-01-01T00:00:00Z";
		const cliGc = runCliMaintenanceCommand([
			"--format",
			"json",
			"gc-analytics",
			"--type",
			"views",
			"--before-date",
			cutoff,
			"--confirm",
		]);
		expect(cliGc.exitCode).toBe(0);
		const jsonStart = cliGc.stdout.indexOf("{");
		expect(jsonStart).toBeGreaterThanOrEqual(0);
		const cliResult = JSON.parse(cliGc.stdout.slice(jsonStart)) as {
			type?: string;
			before_date?: string;
			deleted?: boolean;
		};
		expect(cliResult).toEqual({
			type: "views",
			before_date: cutoff,
			deleted: true,
		});

		const mcpGc = utils.assertSuccess<{
			type?: string;
			before_date?: string;
			deleted?: boolean;
		}>(
			await client.callTool("listmonk_gc_analytics", {
				type: "clicks",
				before_date: cutoff,
				confirm: true,
			}),
			"Failed to collect analytics through MCP",
		);
		expect(mcpGc).toEqual({
			type: "clicks",
			before_date: cutoff,
			deleted: true,
		});

		const mcpRejectedType = await client.callTool("listmonk_gc_analytics", {
			type: "bounces",
			before_date: cutoff,
			confirm: true,
		});
		utils.assertError(mcpRejectedType, "type");
	});
});
