import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import { handleListsTools, listsTools } from "../../src/handlers/lists.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

function request(
	name: string,
	args: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: args },
	};
}

function clientWithList(
	list: Partial<Pick<ListmonkClient, "list">["list"]>,
): ListmonkClient {
	return { list } as unknown as ListmonkClient;
}

describe("list operation MCP adapter", () => {
	test("publishes registry schemas and safety annotations", () => {
		expect(listsTools).toHaveLength(5);

		const readTool = listsTools.find(
			(tool) => tool.name === "listmonk_get_lists",
		);
		expect(readTool?.title).toBe("List subscriber lists");
		expect(readTool?.inputSchema.type).toBe("object");
		expect(readTool?.inputSchema.required).toBeUndefined();
		expect(readTool?.outputSchema?.type).toBe("object");
		expect(readTool?.annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
		});

		const deleteTool = listsTools.find(
			(tool) => tool.name === "listmonk_delete_list",
		);
		expect(deleteTool?.annotations?.destructiveHint).toBe(true);
		expect(deleteTool?.inputSchema.properties?.id).toMatchObject({
			anyOf: [{ type: "integer" }, { type: "string" }],
		});

		const createTool = listsTools.find(
			(tool) => tool.name === "listmonk_create_list",
		);
		expect(createTool?.inputSchema.required).toEqual(["name"]);
	});

	test("returns validated structured output with compatible text content", async () => {
		const result = await handleListsTools(
			request("listmonk_get_lists", { page: "2", per_page: 5000 }),
			clientWithList({
				list: async () => ({
					data: {
						results: [{ id: 4, name: "News" }],
						total: 6,
						page: 2,
						per_page: 5000,
					},
					request: new Request("https://example.test"),
					response: new Response(),
				}),
			}),
		);

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			results: [{ id: 4, name: "News" }],
			total: 6,
			page: 2,
			per_page: 5000,
		});
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(
			result.structuredContent,
		);
	});

	test("preserves update text while exposing the updated list", async () => {
		const result = await handleListsTools(
			request("listmonk_update_list", { id: "8", name: "Updates" }),
			clientWithList({
				update: async () => ({
					data: { id: 8, name: "Updates" },
					request: new Request("https://example.test"),
					response: new Response(),
				}),
			}),
		);

		expect(result.content[0]?.text).toBe("List updated successfully");
		expect(result.structuredContent).toEqual({ id: 8, name: "Updates" });
	});

	test("returns validation and API failures as MCP errors", async () => {
		const missing = await handleListsTools(
			request("listmonk_create_list", { type: "private" }),
			clientWithList({}),
		);
		expect(missing.isError).toBe(true);
		expect(missing.content[0]?.text).toContain(
			"Missing required parameter: name",
		);

		const apiFailure = await handleListsTools(
			request("listmonk_update_list", { id: 8, name: "Duplicate" }),
			clientWithList({
				update: async () => ({ error: { error: "conflict" } }),
			}),
		);
		expect(apiFailure.isError).toBe(true);
		expect(apiFailure.content[0]?.text).toContain(
			"Failed to update list: conflict",
		);

		const emptyUpdate = await handleListsTools(
			request("listmonk_update_list", { id: 8 }),
			clientWithList({
				update: async () => ({
					data: { id: 8, name: "Should not be called" },
				}),
			}),
		);
		expect(emptyUpdate.isError).toBe(true);
		expect(emptyUpdate.content[0]?.text).toContain(
			"At least one list field must be provided for update",
		);
	});
});
