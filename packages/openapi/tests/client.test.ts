import { describe, expect, test } from "bun:test";
import { createClient, createListmonkClient } from "../index";

function resolveRequestedUrl(input: URL | RequestInfo): string {
	if (typeof input === "string") {
		return input;
	}

	if (input instanceof URL) {
		return input.toString();
	}

	return input.url;
}

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

			test("should include configured baseUrl in raw client buildUrl", () => {
				const client = createClient({
					baseUrl: "http://localhost:9000/api",
				});

				expect(client.buildUrl({ url: "/lists" })).toBe(
					"http://localhost:9000/api/lists",
				);
			});

			test("should call the origin /health endpoint even when baseUrl includes /api", async () => {
				const originalFetch = globalThis.fetch;
				let requestedUrl = "";

				try {
					globalThis.fetch = (async (input) => {
						requestedUrl = resolveRequestedUrl(input);
						return new Response(JSON.stringify({ data: true }), {
							status: 200,
							headers: { "Content-Type": "application/json" },
						});
					}) as typeof fetch;

					const client = createListmonkClient({
						baseUrl: "http://localhost:9000/api",
						headers: {
							Authorization: "token api-admin:test-token",
						},
					});

					const result = await client.getHealthCheck();

					expect(requestedUrl).toBe("http://localhost:9000/health");
					expect(result.data).toBe(true);
				} finally {
					globalThis.fetch = originalFetch;
				}
			});

			test("should preserve list API errors instead of normalizing them to empty results", async () => {
				const originalFetch = globalThis.fetch;
				let requestedUrl = "";

				try {
					globalThis.fetch = (async (input) => {
						requestedUrl = resolveRequestedUrl(input);
						return new Response(
							JSON.stringify({ message: "invalid API credentials" }),
							{
								status: 403,
								headers: { "Content-Type": "application/json" },
							},
						);
					}) as typeof fetch;

					const client = createListmonkClient({
						baseUrl: "http://localhost:9000/api",
						headers: {
							Authorization: "token api-admin:test-token",
						},
					});

					const result = await client.list.list({
						query: { page: 1, per_page: 1 },
					});

					expect(requestedUrl).toBe("http://localhost:9000/api/lists?page=1&per_page=1");
					expect("error" in result).toBe(true);

					if ("error" in result) {
						expect(result.error).toEqual({
							message: "invalid API credentials",
						});
					}
				} finally {
					globalThis.fetch = originalFetch;
				}
			});
	});
});
