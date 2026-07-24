import { describe, expect, test } from "bun:test";
import { listOperations } from "../packages/operations/src/lists";
import { mediaOperations } from "../packages/operations/src/media";
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
import { mediaTools } from "../packages/mcp/src/handlers/media";
import {
	assertAbTestOperationsPublished,
	assertCampaignOperationsPublished,
	assertOperationFamilyPublished,
	assertListOperationsPublished,
	assertMediaOperationsPublished,
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

function firstDestructiveListOperationFixture() {
	const operation = listOperations.find(
		(candidate) => candidate.safety.destructiveHint,
	);
	if (!operation) {
		throw new Error("expected a destructive shared list operation");
	}
	const familyTool = listsTools.find(
		(tool) => tool.name === operation.mcp.name,
	);
	if (!familyTool) {
		throw new Error("expected a matching destructive list MCP tool");
	}

	return { operation, familyTool };
}

const registeredServerTools = toolRegistrations.flatMap(
	(registration) => registration.tools,
);

describe("shared operation coverage", () => {
	test("keeps CLI and MCP discovery catalogs in direct parity", () => {
		expect(cliOperationCatalog.entries).toHaveLength(47);
		expect(mcpOperationCatalog.entries).toHaveLength(47);
		expect(listCliOperationCatalogSummaries()).toEqual(
			listMcpOperationCatalogSummaries(),
		);
	});

	test("publishes every registered operation through its MCP tool family", () => {
		assertListOperationsPublished();
		assertCampaignOperationsPublished();
		assertSubscriberOperationsPublished();
		assertTemplateOperationsPublished();
		assertMediaOperationsPublished();
		assertTransactionalOperationsPublished();
		assertOpsOperationsPublished();
		assertAbTestOperationsPublished();
	});

	test("publishes media operations with matching shared metadata", () => {
		const operation = mediaOperations[0];
		if (!operation) {
			throw new Error("expected a shared media operation");
		}
		const tool = mediaTools.find(
			(candidate) => candidate.name === operation.mcp.name,
		);
		if (!tool) {
			throw new Error("expected a matching media MCP tool");
		}

		expect(() =>
			assertOperationFamilyPublished("media", [operation], [tool]),
		).not.toThrow();
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

	test("requires the MCP-only confirmation control for destructive operations", () => {
		const { operation, familyTool } = firstDestructiveListOperationFixture();
		const toolWithoutConfirmation = {
			...familyTool,
			inputSchema: operation.inputJsonSchema,
		};

		expect(() =>
			assertOperationFamilyPublished(
				"subscriber lists",
				[operation],
				[toolWithoutConfirmation],
			),
		).toThrow("family tool does not preserve MCP schemas");
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
