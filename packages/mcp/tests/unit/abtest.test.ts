import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abtestTools, handleAbTestTools } from "../../src/handlers/abtest.js";

let tempDir: string | undefined;
let previousStorePath: string | undefined;

afterEach(async () => {
	if (previousStorePath === undefined) {
		delete process.env.LISTMONK_OPS_ABTEST_STORE;
	} else {
		process.env.LISTMONK_OPS_ABTEST_STORE = previousStorePath;
	}
	previousStorePath = undefined;
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("MCP A/B test operation adapter", () => {
	test("publishes the shared lifecycle metadata", () => {
		expect(abtestTools).toHaveLength(9);
		const listTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_list",
		);
		const deleteTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_delete",
		);
		const stopTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_stop",
		);
		const deployWinnerTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_deploy_winner",
		);

		expect(listTool?.outputSchema?.type).toBe("object");
		expect(listTool?.annotations?.readOnlyHint).toBe(true);
		expect(deleteTool?.annotations?.destructiveHint).toBe(true);
		expect(stopTool?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: false,
		});
		expect(abtestTools.find((tool) => tool.name === "listmonk_abtest_launch")?.annotations).toMatchObject({
			destructiveHint: false,
			idempotentHint: false,
		});
		expect(abtestTools.find((tool) => tool.name === "listmonk_abtest_create")?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: false,
		});
		expect(deployWinnerTool?.annotations?.idempotentHint).toBe(false);
	});

	test("returns structured content while preserving the legacy list text", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-mcp-abtest-"));
		previousStorePath = process.env.LISTMONK_OPS_ABTEST_STORE;
		process.env.LISTMONK_OPS_ABTEST_STORE = join(tempDir, "abtests.json");

		const result = await handleAbTestTools(
			{
				method: "tools/call",
				params: {
					name: "listmonk_abtest_list",
					arguments: { status: "draft" },
				},
			},
			{} as never,
		);

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual({ tests: [] });
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual([]);
	});

	test("returns shared validation errors for invalid status", async () => {
		const result = await handleAbTestTools(
			{
				method: "tools/call",
				params: {
					name: "listmonk_abtest_list",
					arguments: { status: "unknown" },
				},
			},
			{} as never,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain("Invalid parameter status");
	});
});
