import { beforeAll, describe, expect, test } from "bun:test";
import type { List } from "../index";
import { createListmonkClient } from "../index";

// Integration tests require a running Listmonk server
// Run with: docker-compose up -d
describe("API Integration", () => {
	let client: ReturnType<typeof createListmonkClient>;

	beforeAll(() => {
		client = createListmonkClient({
			baseUrl: "http://localhost:9000/api",
			headers: {
				Authorization: "token api-admin:pOIw1gMMYh1Ozjf7Z5uuDE0DZiCnr4hB",
			},
		});
	});

	describe("Health Check", () => {
		test("should get health check status", async () => {
			const health = await client.getHealthCheck();

			expect(health).toBeDefined();
			expect(health.data).toBe(true);
			expect(health.response).toBeInstanceOf(Response);
			expect(health.request).toBeInstanceOf(Request);
		});
	});

	describe("Authentication", () => {
		test("should handle authentication errors", async () => {
			const unauthorizedClient = createListmonkClient({
				baseUrl: "http://localhost:9000/api",
				headers: {
					Authorization: "token invalid:invalid",
				},
			});

			try {
				await unauthorizedClient.getHealthCheck();
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				expect(error).toBeDefined();
			}
		});
	});

	describe("Lists CRUD Operations", () => {
		let createdList: List;

		test("should create a new list", async () => {
			const listResponse = await client.createList({
				body: {
					name: `Test List ${Date.now()}`,
					type: "public",
					optin: "single",
				},
			});

			expect(listResponse.data).toBeDefined();
			expect(listResponse.data.name).toContain("Test List");
			expect(listResponse.data.type).toBe("public");
			expect(listResponse.data.optin).toBe("single");
			expect(typeof listResponse.data.id).toBe("number");
			expect(listResponse.data.id).toBeDefined();

			createdList = listResponse.data;
		});

		test("should get list by ID", async () => {
			if (!createdList?.id || !createdList?.name) {
				throw new Error("Created list data is missing");
			}

			const listResponse = await client.getListById({
				path: { list_id: createdList.id },
			});

			if ("error" in listResponse) {
				throw new Error("Failed to get list by ID");
			}

			expect(listResponse.data).toBeDefined();
			expect(listResponse.data.id).toBe(createdList.id);
			expect(listResponse.data.name).toBe(createdList.name);
		});

		test("should get all lists", async () => {
			const listsResponse = await client.getLists();

			expect(listsResponse.data).toBeDefined();
			expect(listsResponse.data.results).toBeArray();
			expect(listsResponse.data.results.length).toBeGreaterThan(0);
			expect(typeof listsResponse.data.total).toBe("number");
			expect(typeof listsResponse.data.page).toBe("number");
			expect(typeof listsResponse.data.per_page).toBe("number");

			// Our created list should be in the results
			const foundList = listsResponse.data.results.find(
				(list: List) => list.id === createdList?.id,
			);
			expect(foundList).toBeDefined();
		});

		test("should delete list by ID", async () => {
			if (!createdList?.id) {
				throw new Error("Created list ID is missing");
			}

			const deleteResponse = await client.deleteListById({
				path: { list_id: createdList.id },
			});

			expect(deleteResponse.data).toBe(true);

			// Verify list is deleted
			const getResponse = await client.getListById({
				path: { list_id: createdList.id },
			});

			expect("error" in getResponse).toBe(true);
		});
	});

	describe("Error Handling", () => {
		test("should handle non-existent list", async () => {
			const response = await client.getListById({
				path: { list_id: 999999 },
			});

			expect("error" in response).toBe(true);
		});

		test("should validate required fields when creating list", async () => {
			try {
				await client.createList({
					body: {
						// Missing required fields
						name: "",
						type: "public",
						optin: "single",
					},
				});
				expect(true).toBe(false); // Should not reach here
			} catch (error) {
				expect(error).toBeDefined();
			}
		});
	});

	describe("Subscribers", () => {
		test("should get subscribers list", async () => {
			const subscribersResponse = await client.getSubscribers();

			expect(subscribersResponse.data).toBeDefined();
			expect(subscribersResponse.data.results).toBeArray();
			expect(typeof subscribersResponse.data.total).toBe("number");
		});
	});

	describe("Campaigns", () => {
		test("should get campaigns list", async () => {
			const campaignsResponse = await client.getCampaigns();

			expect(campaignsResponse.data).toBeDefined();
			expect(campaignsResponse.data.results).toBeArray();
			expect(typeof campaignsResponse.data.total).toBe("number");
		});
	});
});
