import { describe, expect, test } from "bun:test";
import {
	handleOperationCatalogTools,
	operationCatalogTools,
} from "../../src/handlers/catalog.js";
import {
	mcpOperationCatalog,
	listMcpOperationCatalogSummaries,
} from "../../src/operation-catalog.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

function request(
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name: "listmonk_list_operations", arguments: arguments_ },
	};
}

describe("operation catalog MCP adapter", () => {
	test("publishes a read-only discovery tool for every shared operation", async () => {
		expect(operationCatalogTools).toHaveLength(1);
		expect(operationCatalogTools[0]).toMatchObject({
			name: "listmonk_list_operations",
			outputSchema: {
				properties: {
					operations: { type: "array", items: { type: "object" } },
				},
			},
			annotations: {
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
			},
		});
		expect(mcpOperationCatalog.entries).toHaveLength(39);
		expect(listMcpOperationCatalogSummaries("ops")).toHaveLength(9);

		const result = await handleOperationCatalogTools(request({ family: "lists" }), {} as never);
		expect(result.isError).not.toBe(true);
		expect(result.structuredContent?.operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					family: "lists",
					mcpName: "listmonk_get_lists",
				}),
			]),
		);
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(
			result.structuredContent,
		);
	});

	test("rejects invalid discovery input and unknown tools", async () => {
		const invalid = await handleOperationCatalogTools(
			request({ family: " " }),
			{} as never,
		);
		expect(invalid.isError).toBe(true);
		expect(invalid.content[0]?.text).toContain("Invalid parameter family");

		const unknown = await handleOperationCatalogTools(
			{
				method: "tools/call",
				params: { name: "listmonk_unknown_catalog_tool", arguments: {} },
			},
			{} as never,
		);
		expect(unknown.isError).toBe(true);
		expect(unknown.content[0]?.text).toContain("Unknown tool");
	});
});
