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
		expect(abtestTools).toHaveLength(13);
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
		const createTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_create",
		);
		const runTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_run",
		);
		const tickTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_tick",
		);
		const reconcileTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_reconcile",
		);
		const exportTool = abtestTools.find(
			(tool) => tool.name === "listmonk_abtest_export_assignment",
		);

		expect(listTool?.outputSchema?.type).toBe("object");
		expect(listTool?.annotations?.readOnlyHint).toBe(true);
		expect(deleteTool?.annotations?.destructiveHint).toBe(true);
		expect(deleteTool?.annotations?.idempotentHint).toBe(true);
		expect(stopTool?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: true,
		});
		expect(abtestTools.find((tool) => tool.name === "listmonk_abtest_launch")?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: true,
		});
		expect(createTool?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: true,
		});
		expect(deployWinnerTool?.annotations?.idempotentHint).toBe(false);
		expect(createTool?.inputSchema.required).toEqual([
			"name",
			"lists",
			"variants",
			"confirm",
		]);
		expect(createTool?.inputSchema.properties?.confidence_threshold).toMatchObject(
			{ exclusiveMinimum: 0, exclusiveMaximum: 1 },
		);
		expect(runTool?.inputSchema.required).toEqual(["test_id", "confirm"]);
		expect(tickTool?.inputSchema.required).toEqual(["confirm"]);
		expect(reconcileTool?.inputSchema.required).toEqual(["confirm"]);
		expect(exportTool?.inputSchema.required).toEqual(["test_id"]);
		expect(exportTool?.inputSchema.properties).not.toHaveProperty("confirm");
		expect(exportTool?.outputSchema?.properties?.manifest).toMatchObject({
			type: "object",
		});
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
