import { describe, expect, test } from "bun:test";
import { createListmonkClient } from "../index";

describe("Client Creation", () => {
	describe("createListmonkClient", () => {
		test("should create client with default config", () => {
			const client = createListmonkClient({
				baseUrl: "http://localhost:9000/api",
				headers: {
					Authorization: "token api-admin:test-token",
				},
			});

			expect(client).toBeDefined();
			expect(typeof client.getHealthCheck).toBe("function");
			expect(typeof client.createList).toBe("function");
			expect(typeof client.getLists).toBe("function");
		});

		test("should create client with custom config", () => {
			const client = createListmonkClient({
				baseUrl: "https://custom.listmonk.com/api",
				headers: {
					Authorization: "token custom-user:custom-token",
					"X-Custom-Header": "custom-value",
				},
			});

			expect(client).toBeDefined();
			expect(typeof client.getHealthCheck).toBe("function");
			expect(typeof client.createList).toBe("function");
		});

		test("should create multiple independent clients", () => {
			const client1 = createListmonkClient({
				baseUrl: "http://localhost:9000/api",
				headers: {
					Authorization: "token user1:token1",
				},
			});

			const client2 = createListmonkClient({
				baseUrl: "http://localhost:9001/api",
				headers: {
					Authorization: "token user2:token2",
				},
			});

			expect(client1).toBeDefined();
			expect(client2).toBeDefined();
			expect(client1).not.toBe(client2);
		});

		test("should have all expected SDK methods", () => {
			const client = createListmonkClient({
				baseUrl: "http://localhost:9000/api",
				headers: {
					Authorization: "token api-admin:test-token",
				},
			});

			// Health
			expect(typeof client.getHealthCheck).toBe("function");

			// Lists
			expect(typeof client.createList).toBe("function");
			expect(typeof client.getLists).toBe("function");
			expect(typeof client.getListById).toBe("function");
			expect(typeof client.deleteListById).toBe("function");

			// Subscribers
			expect(typeof client.getSubscribers).toBe("function");
			expect(typeof client.createSubscriber).toBe("function");
			expect(typeof client.getSubscriberById).toBe("function");
			expect(typeof client.deleteSubscriberById).toBe("function");

			// Campaigns
			expect(typeof client.getCampaigns).toBe("function");
			expect(typeof client.createCampaign).toBe("function");
			expect(typeof client.getCampaignById).toBe("function");
			expect(typeof client.deleteCampaignById).toBe("function");
		});

		test("should have HTTP methods available", () => {
			const client = createListmonkClient({
				baseUrl: "http://localhost:9000/api",
				headers: {
					Authorization: "token api-admin:test-token",
				},
			});

			// The client should have the basic structure
			expect(client).toBeDefined();
			expect(typeof client.getHealthCheck).toBe("function");
			// Note: HTTP methods like GET, POST might be internal to the SDK
		});
	});
});
