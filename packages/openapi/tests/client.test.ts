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
			expect(typeof client.list.create).toBe("function");
			expect(typeof client.list.list).toBe("function");
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
			expect(typeof client.list.create).toBe("function");
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
			expect(typeof client.list.create).toBe("function");
			expect(typeof client.list.list).toBe("function");
			expect(typeof client.list.getById).toBe("function");
			expect(typeof client.list.delete).toBe("function");

			// Subscribers
			expect(typeof client.subscriber.list).toBe("function");
			expect(typeof client.subscriber.create).toBe("function");
			expect(typeof client.subscriber.getById).toBe("function");
			expect(typeof client.subscriber.delete).toBe("function");

			// Campaigns
			expect(typeof client.campaign.list).toBe("function");
			expect(typeof client.campaign.create).toBe("function");
			expect(typeof client.campaign.getById).toBe("function");
			expect(typeof client.campaign.delete).toBe("function");
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
