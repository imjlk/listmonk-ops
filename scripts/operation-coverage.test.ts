import { describe, expect, test } from "bun:test";
import { listOperations } from "../packages/operations/src/lists";
import {
	cliOperationCatalog,
	listCliOperationCatalogSummaries,
} from "../apps/cli/src/operation-catalog";
import {
	listMcpOperationCatalogSummaries,
	mcpOperationCatalog,
} from "../packages/mcp/src/operation-catalog";
import {
	allTools,
	toolRegistrations,
} from "../packages/mcp/src/handlers/index";
import { listsTools } from "../packages/mcp/src/handlers/lists";
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

const registeredServerTools = toolRegistrations.flatMap(
	(registration) => registration.tools,
);

describe("shared operation coverage", () => {
	test("keeps CLI and MCP discovery catalogs in direct parity", () => {
		expect(cliOperationCatalog.entries).toHaveLength(39);
		expect(mcpOperationCatalog.entries).toHaveLength(39);
		expect(listCliOperationCatalogSummaries()).toEqual(
			listMcpOperationCatalogSummaries(),
		);
	});

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

	test("rejects an operation missing from server registrations", () => {
		const { operation, familyTool } = firstListOperationFixture();
		const missingServerTools = registeredServerTools.filter(
			(tool) => tool.name !== operation.mcp.name,
		);

		expect(() =>
			assertOperationFamilyPublished(
				"subscriber lists",
				[operation],
				[familyTool],
				allTools,
				missingServerTools,
			),
		).toThrow("must have exactly one server tool");
	});
});
