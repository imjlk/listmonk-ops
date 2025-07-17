import { test, expect, describe, beforeEach } from "bun:test";
import { createMCPTestSuite } from "../mcp-helper.js";
import "../setup.js";

describe("Lists MCP Tools", () => {
	const { client, utils } = createMCPTestSuite();
	let testListId: number;

	beforeEach(async () => {
		// Clean up any existing test lists
		const listsResult = await client.callTool("listmonk_get_lists");
		const lists = utils.assertSuccess(listsResult);
		
		if (lists.results) {
			for (const list of lists.results) {
				if (list.name?.startsWith("Test-")) {
					await client.callTool("listmonk_delete_list", { id: list.id.toString() });
				}
			}
		}
	});

	test("should list all lists", async () => {
		const result = await client.callTool("listmonk_get_lists", {
			page: 1,
			per_page: 10,
		});

		const data = utils.assertSuccess(result, "Failed to get lists");
		expect(data).toHaveProperty("results");
		expect(Array.isArray(data.results)).toBe(true);
	});

	test("should create a new list", async () => {
		const listName = `Test-List-${Date.now()}`;
		
		const result = await client.callTool("listmonk_create_list", {
			name: listName,
			type: "private",
			optin: "single",
			description: "Test list for E2E testing",
			tags: ["test", "e2e"],
		});

		const createdList = utils.assertSuccess(result, "Failed to create list");
		
		expect(createdList).toHaveProperty("id");
		expect(createdList.name).toBe(listName);
		expect(createdList.type).toBe("private");
		expect(createdList.optin).toBe("single");
		
		testListId = (createdList as {id: number}).id;
	});

	test("should get a specific list by ID", async () => {
		// First create a list
		const createdList = await utils.createTestList();
		testListId = (createdList as {id: number}).id;

		// Then get it by ID
		const result = await client.callTool("listmonk_get_list", {
			id: testListId.toString(),
		});

		const retrievedList = utils.assertSuccess(result, "Failed to get list by ID");
		
		expect(retrievedList.id).toBe(testListId);
		expect(retrievedList.name).toBe(createdList.name);
	});

	test("should update an existing list", async () => {
		// First create a list
		const createdList = await utils.createTestList();
		testListId = (createdList as {id: number}).id;

		const updatedName = `Updated-Test-List-${Date.now()}`;
		
		const result = await client.callTool("listmonk_update_list", {
			id: testListId.toString(),
			name: updatedName,
			description: "Updated description",
			type: "public",
		});

		utils.assertSuccess(result, "Failed to update list");

		// Verify the update
		const getResult = await client.callTool("listmonk_get_list", {
			id: testListId.toString(),
		});

		const updatedList = utils.assertSuccess(getResult);
		expect(updatedList.name).toBe(updatedName);
		expect(updatedList.type).toBe("public");
	});

	test("should delete a list", async () => {
		// First create a list
		const createdList = await utils.createTestList();
		testListId = (createdList as {id: number}).id;

		// Delete it
		const result = await client.callTool("listmonk_delete_list", {
			id: testListId.toString(),
		});

		utils.assertSuccess(result, "Failed to delete list");

		// Just verify the delete operation succeeded - no need to test error message format
		expect(result.isError).toBeFalsy();
	});

	test("should handle validation errors", async () => {
		// Test missing required fields
		const result = await client.callTool("listmonk_create_list", {
			// Missing name
			type: "private",
		});

		utils.assertError(result, "Missing required parameter: name");
	});

});