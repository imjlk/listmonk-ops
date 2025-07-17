import { test, expect, describe } from "bun:test";
import { createMCPTestSuite } from "../mcp-helper.js";
import "../setup.js";

describe("MCP Server Integration", () => {
	const { client, utils } = createMCPTestSuite();

	test("should list all available tools", async () => {
		const tools = await client.listTools();
		
		expect(tools).toBeDefined();
		expect(Array.isArray(tools.tools)).toBe(true);
		expect(tools.tools.length).toBeGreaterThan(0);

		// Check for key tool categories
		const toolNames = tools.tools.map((tool: any) => tool.name);
		
		// Lists tools
		expect(toolNames).toContain("listmonk_get_lists");
		expect(toolNames).toContain("listmonk_create_list");
		expect(toolNames).toContain("listmonk_update_list");
		expect(toolNames).toContain("listmonk_delete_list");

		// Campaign tools
		expect(toolNames).toContain("listmonk_get_campaigns");
		expect(toolNames).toContain("listmonk_create_campaign");
		expect(toolNames).toContain("listmonk_update_campaign_status");
		expect(toolNames).toContain("listmonk_delete_campaign");

		// Subscriber tools
		expect(toolNames).toContain("listmonk_get_subscribers");
		expect(toolNames).toContain("listmonk_create_subscriber");
		expect(toolNames).toContain("listmonk_update_subscriber");
		expect(toolNames).toContain("listmonk_delete_subscriber");

		// Template tools
		expect(toolNames).toContain("listmonk_get_templates");
		expect(toolNames).toContain("listmonk_create_template");
		expect(toolNames).toContain("listmonk_update_template");
		expect(toolNames).toContain("listmonk_delete_template");

		// Settings tools
		expect(toolNames).toContain("listmonk_get_settings");
		expect(toolNames).toContain("listmonk_update_settings");

		// Media tools
		expect(toolNames).toContain("listmonk_get_media");
		expect(toolNames).toContain("listmonk_delete_media");

		// Bounce tools
		expect(toolNames).toContain("listmonk_get_bounces");
		expect(toolNames).toContain("listmonk_delete_bounce");

		// Transactional tools
		expect(toolNames).toContain("listmonk_send_transactional");
	});

	test("should provide server information", async () => {
		const info = await client.getServerInfo();
		
		expect(info).toHaveProperty("name");
		expect(info).toHaveProperty("version");
		expect(info.name).toBe("listmonk-mcp-server");
	});

	test("should handle unknown tool calls", async () => {
		const result = await client.callTool("non_existent_tool", {});
		
		utils.assertError(result, "Unknown tool");
	});

	test("should handle malformed requests", async () => {
		// Test with missing arguments object
		const result = await client.callTool("listmonk_get_lists");
		
		// Should still work (arguments are optional for this tool)
		utils.assertSuccess(result, "Failed to handle request without arguments");
	});

	test("should maintain client state across calls", async () => {
		// Create a list
		const listName = `State-Test-List-${Date.now()}`;
		const createResult = await client.callTool("listmonk_create_list", {
			name: listName,
			type: "private",
		});

		const createdList = utils.assertSuccess<{id: number}>(createResult, "Failed to create list");
		const listId = createdList.id;

		// Update it
		const updateResult = await client.callTool("listmonk_update_list", {
			id: listId.toString(),
			name: `${listName}-updated`,
		});

		utils.assertSuccess(updateResult, "Failed to update list");

		// Get it and verify the update persisted
		const getResult = await client.callTool("listmonk_get_list", {
			id: listId.toString(),
		});

		const updatedList = utils.assertSuccess(getResult, "Failed to get updated list");
		expect(updatedList.name).toBe(`${listName}-updated`);

		// Clean up
		await client.callTool("listmonk_delete_list", { id: listId.toString() });
	});

	test("should handle concurrent requests", async () => {
		// Make multiple concurrent requests
		const promises = [
			client.callTool("listmonk_get_lists", { page: 1, per_page: 5 }),
			client.callTool("listmonk_get_campaigns", { page: 1, per_page: 5 }),
			client.callTool("listmonk_get_subscribers", { page: 1, per_page: 5 }),
			client.callTool("listmonk_get_templates", { page: 1, per_page: 5 }),
		];

		const results = await Promise.all(promises);

		// All requests should succeed
		for (const result of results) {
			utils.assertSuccess(result, "Concurrent request failed");
		}
	});

	test("should validate required parameters", async () => {
		// Test various tools with missing required parameters
		const testCases = [
			{ tool: "listmonk_get_list", args: {}, expectedError: "Missing required parameter: id" },
			{ tool: "listmonk_create_list", args: {}, expectedError: "Missing required parameter: name" },
			{ tool: "listmonk_create_subscriber", args: { name: "Test" }, expectedError: "Missing required parameter: email" },
			{ tool: "listmonk_create_campaign", args: { name: "Test" }, expectedError: "Missing required parameter" },
		];

		for (const testCase of testCases) {
			const result = await client.callTool(testCase.tool, testCase.args);
			utils.assertError(result, testCase.expectedError);
		}
	});

	test("should handle pagination properly", async () => {
		// Test pagination with lists
		const page1Result = await client.callTool("listmonk_get_lists", {
			page: 1,
			per_page: 1,
		});

		const page1Data = utils.assertSuccess(page1Result, "Failed to get page 1");
		expect(page1Data).toHaveProperty("results");
		expect(page1Data).toHaveProperty("total");
		expect(page1Data).toHaveProperty("page");
		expect(page1Data).toHaveProperty("per_page");
		
		if (page1Data.total > 1) {
			const page2Result = await client.callTool("listmonk_get_lists", {
				page: 2,
				per_page: 1,
			});

			const page2Data = utils.assertSuccess(page2Result, "Failed to get page 2");
			expect(page2Data.page).toBe(2);
			
			// Results should be different (assuming we have more than 1 list)
			if (page1Data.results.length > 0 && page2Data.results.length > 0) {
				expect(page1Data.results[0].id).not.toBe(page2Data.results[0].id);
			}
		}
	});

	test("should handle API errors gracefully", async () => {
		// Try to get a non-existent resource
		const result = await client.callTool("listmonk_get_list", {
			id: "999999", // Assuming this ID doesn't exist
		});

		// Just verify it returns an error (message format doesn't matter)
		expect(result.isError).toBe(true);
		expect(result.content).toBeDefined();
		expect(result.content.length).toBeGreaterThan(0);
		expect(result.content[0]?.text).toContain("Error:");
	});
});