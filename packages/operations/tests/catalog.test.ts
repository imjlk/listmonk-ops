import { describe, expect, test } from "bun:test";
import {
	campaignOperationCatalog,
	composeOperationCatalogs,
	defineOperationCatalog,
	getOperationCatalogEntryByMcpName,
	listOperationCatalog,
	listOperationCatalogSummaries,
	listOperations,
} from "../src";

describe("operation catalog", () => {
	test("composes stable discovery summaries for shared operation families", () => {
		const catalog = composeOperationCatalogs([
			listOperationCatalog,
			campaignOperationCatalog,
		]);

		expect(catalog.entries).toHaveLength(10);
		expect(listOperationCatalogSummaries(catalog)).toHaveLength(10);
		expect(listOperationCatalogSummaries(catalog, "lists")).toHaveLength(5);
		expect(listOperationCatalogSummaries(catalog, "missing")).toEqual([]);
		expect(listOperationCatalogSummaries(catalog, " campaigns ")).toEqual(
			listOperationCatalogSummaries(catalog, "campaigns"),
		);

		const first = listOperationCatalogSummaries(catalog, "lists")[0];
		expect(first).toMatchObject({
			family: "lists",
			familyTitle: "Subscriber lists",
			id: listOperations[0]?.id,
			mcpName: listOperations[0]?.mcp.name,
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
		});
		expect(first?.safety).not.toBe(listOperations[0]?.safety);
		expect(
			getOperationCatalogEntryByMcpName(
				catalog,
				"listmonk_get_campaigns",
			)?.operation,
		).toBe(campaignOperationCatalog.operations[0]);
	});

	test("rejects duplicate family, operation, and MCP identities", () => {
		const firstListOperation = listOperations[0];
		if (!firstListOperation) {
			throw new Error("expected a list operation");
		}

		expect(() =>
			defineOperationCatalog({
				id: "duplicate",
				title: "Duplicate operation",
				operations: [firstListOperation, firstListOperation],
			}),
		).toThrow("duplicate operation id");
		expect(() =>
			composeOperationCatalogs([listOperationCatalog, listOperationCatalog]),
		).toThrow("duplicate family id");
		expect(() =>
			composeOperationCatalogs([
				listOperationCatalog,
				defineOperationCatalog({
					id: "copied-list",
					title: "Copied list",
					operations: [firstListOperation],
				}),
			]),
		).toThrow("duplicate operation id");
		expect(() =>
			defineOperationCatalog({
				id: "duplicate-tool",
				title: "Duplicate tool",
				operations: [
					firstListOperation,
					{
						...firstListOperation,
						id: "lists.copied",
						mcp: { ...firstListOperation.mcp },
					},
				],
			}),
		).toThrow("duplicate MCP tool name");
	});
});
