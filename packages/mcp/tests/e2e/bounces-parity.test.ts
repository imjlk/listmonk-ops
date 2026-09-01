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
		const cliListResult = runCliBouncesCommand([
			"--format",
			"json",
			"list",
			"--page",
			"1",
			"--per-page",
			"5",
		]);
		// A fresh stack can legitimately carry zero bounce records; the CLI
		// then prints its human "No bounces found" line instead of a JSON
		// array, which must compare equal to an empty MCP page.
		const cliBounceIds = ["{", "["].some((marker) =>
			cliListResult.stdout.includes(marker),
		)
			? parseCliJson<BounceSummary[]>(cliListResult, "list").map(
					(bounce) => bounce.id,
				)
			: [];

		const mcpResult = await client.callTool("listmonk_get_bounces", {
			page: 1,
			per_page: 5,
		});
		const mcpPage = utils.assertSuccess<BounceListPage>(
			mcpResult,
			"Failed to list bounces through MCP",
		);

		// A non-empty window must echo the requested page; an empty
		// collection legitimately reports Listmonk's own 0/0 window.
		if (cliBounceIds.length > 0) {
			expect(mcpPage.page).toBe(1);
			expect(mcpPage.per_page).toBe(5);
		}
		expect(mcpPage.results?.map((bounce) => bounce.id)).toEqual(cliBounceIds);
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

	test("previews and echoes a prune through both adapters", async () => {
		// The destructive branch deletes far-out ids whose per-id
		// acknowledgement is the documented no-op, so the parity path runs
		// on any stack state without destroying real records.
		const echoedIds = [9_100_001, 9_100_002];

		// Like the hygiene preview, a destructive-capable operation needs
		// explicit confirmation even for its dry run.
		const cliPreview = parseCliJson<{
			dry_run: boolean;
			bounce_ids: number[];
		}>(
			runCliBouncesCommand([
				"--format",
				"json",
				"prune",
				"--per-page",
				"5",
				"--confirm",
			]),
			"prune",
		);
		expect(cliPreview.dry_run).toBe(true);
		expect(cliPreview.bounce_ids.length).toBeLessThanOrEqual(5);

		const mcpPreview = utils.assertSuccess<{
			dry_run: boolean;
			bounce_ids: number[];
		}>(
			await client.callTool("listmonk_prune_bounces", {
				per_page: 5,
				confirm: true,
			}),
			"Failed to preview the prune through MCP",
		);
		expect(mcpPreview.dry_run).toBe(true);
		expect(mcpPreview.bounce_ids).toEqual(cliPreview.bounce_ids);

		const cliPruned = parseCliJson<{
			dry_run: boolean;
			bounce_ids: number[];
			acknowledged: number;
		}>(
			runCliBouncesCommand([
				"--format",
				"json",
				"prune",
				"--no-dry-run",
				"--bounce-ids",
				echoedIds.join(","),
				"--confirm",
			]),
			"prune destructive",
		);
		expect(cliPruned).toEqual({
			dry_run: false,
			bounce_ids: echoedIds,
			acknowledged: echoedIds.length,
		});

		const mcpPruned = utils.assertSuccess<{
			dry_run: boolean;
			bounce_ids: number[];
			acknowledged: number;
		}>(
			await client.callTool("listmonk_prune_bounces", {
				dry_run: false,
				bounce_ids: echoedIds,
				confirm: true,
			}),
			"Failed to prune through MCP",
		);
		expect(mcpPruned).toEqual({
			dry_run: false,
			bounce_ids: echoedIds,
			acknowledged: echoedIds.length,
		});

		const withoutEcho = await client.callTool("listmonk_prune_bounces", {
			dry_run: false,
			confirm: true,
		});
		utils.assertError(withoutEcho, "bounce_ids");
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

	test("enforces destructive confirmation and reports the acknowledged delete", async () => {
		// Listmonk acknowledges a single-bounce delete of a missing ID with
		// the same success, so a far-out id exercises the full confirmed
		// path on both adapters without mutating a real record.
		const targetId = 9_000_002;

		const blockedCliDeletion = runCliBouncesCommand([
			"delete",
			"--id",
			String(targetId),
		]);
		expect(blockedCliDeletion.exitCode).not.toBe(0);
		expect(`${blockedCliDeletion.stdout}${blockedCliDeletion.stderr}`).toContain(
			"requires explicit confirmation",
		);

		const blockedMcpDeletion = await client.callTool(
			"listmonk_delete_bounce",
			{ id: targetId },
		);
		utils.assertError(blockedMcpDeletion, "requires explicit confirmation");

		const cliDeletion = parseCliJson<{ id: number; deleted: boolean }>(
			runCliBouncesCommand(["delete", "--id", String(targetId), "--confirm"]),
			"delete",
		);
		expect(cliDeletion).toEqual({ id: targetId, deleted: true });

		const mcpDeletion = await client.callTool("listmonk_delete_bounce", {
			id: targetId,
			confirm: true,
		});
		utils.assertSuccess(
			mcpDeletion,
			"Failed to delete the bounce through MCP",
		);
		expect(mcpDeletion.structuredContent).toEqual({
			id: targetId,
			deleted: true,
		});
	});
});
