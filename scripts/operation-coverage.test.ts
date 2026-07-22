import { describe, expect, test } from "bun:test";
import { listOperations } from "../packages/operations/src/lists";
import { listsTools } from "../packages/mcp/src/handlers/lists";
import { allTools } from "../packages/mcp/src/handlers/index";
import {
	assertAbTestOperationsPublished,
	assertCampaignOperationsPublished,
	assertOperationFamilyPublished,
	assertListOperationsPublished,
	assertOpsOperationsPublished,
	assertSubscriberOperationsPublished,
	assertTemplateOperationsPublished,
	assertTransactionalOperationsPublished,
} from "./shared-operation-coverage";

function firstListOperationFixture() {
	const operation = listOperations[0];
	if (!operation) {
		throw new Error("expected a shared list operation");
	}
	const familyTool = listsTools.find(
		(tool) => tool.name === operation.mcp.name,
	);
	if (!familyTool) {
		throw new Error("expected a matching list MCP tool");
	}

	return { operation, familyTool };
}

describe("shared operation coverage", () => {
	test("publishes every registered operation through its MCP tool family", () => {
		assertListOperationsPublished();
		assertCampaignOperationsPublished();
		assertSubscriberOperationsPublished();
		assertTemplateOperationsPublished();
		assertTransactionalOperationsPublished();
		assertOpsOperationsPublished();
		assertAbTestOperationsPublished();
	});

	test("rejects a drifted global tool contract", () => {
		const { operation, familyTool } = firstListOperationFixture();
		const driftedGlobalTools = allTools.map((tool) =>
			tool.name === operation.mcp.name
				? { ...tool, title: `${tool.title} drifted` }
				: tool,
		);

		expect(() =>
			assertOperationFamilyPublished(
				"subscriber lists",
				[operation],
				[familyTool],
				driftedGlobalTools,
			),
		).toThrow("global tool does not preserve MCP metadata");
	});

	test("requires exactly one global tool for every operation", () => {
		const { operation, familyTool } = firstListOperationFixture();

		expect(() =>
			assertOperationFamilyPublished(
				"subscriber lists",
				[operation],
				[familyTool],
				[...allTools, familyTool],
			),
		).toThrow("must have exactly one global tool");
	});
});
