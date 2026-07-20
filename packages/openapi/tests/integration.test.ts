import { beforeAll, describe, expect, test } from "bun:test";
import { createListmonkClient } from "../index";

// Read environment variables from process.env
const LISTMONK_API_URL =
	process.env.LISTMONK_API_URL || "http://localhost:9000/api";
const LISTMONK_USERNAME = process.env.LISTMONK_USERNAME || "api-admin";
const LISTMONK_API_TOKEN = process.env.LISTMONK_API_TOKEN || "";

// Integration tests require a running Listmonk server
// Run with: docker-compose up -d
describe("API Integration", () => {
	let client: ReturnType<typeof createListmonkClient>;
	let serverAvailable = false;

	beforeAll(async () => {
		if (!LISTMONK_API_TOKEN) {
			console.warn(
				"⚠️  LISTMONK_API_TOKEN not found, skipping integration tests",
			);
			return;
		}

		client = createListmonkClient({
			baseUrl: LISTMONK_API_URL,
			headers: {
				Authorization: `token ${LISTMONK_USERNAME}:${LISTMONK_API_TOKEN}`,
			},
		});

		// Check if server is available
		try {
			const healthResponse = await client.getHealthCheck();
			serverAvailable = healthResponse?.data === true;
		} catch {
			serverAvailable = false;
			console.warn(
				"⚠️  Listmonk server not available, skipping integration tests",
			);
		}
	});

	describe("Health Check", () => {
		test("should get health check status", async () => {
			if (!serverAvailable) {
				console.log("⏭️  Skipping: Server not available");
				return;
			}

			const healthResponse = await client.getHealthCheck();

			expect(healthResponse.data).toBe(true);
			expect(healthResponse.response.status).toBe(200);
		});
	});

	describe("Authentication", () => {
		test("should surface authentication errors on authenticated endpoints", async () => {
			if (!serverAvailable) {
				console.log("⏭️  Skipping: Server not available");
				return;
			}

			// Create client with invalid credentials
			const badClient = createListmonkClient({
				baseUrl: LISTMONK_API_URL,
				headers: {
					Authorization: "token invalid:invalid",
				},
			});

			const listsResponse = await badClient.list.list({
				query: { page: 1, per_page: 1 },
			});

			expect("error" in listsResponse).toBe(true);
			if ("error" in listsResponse) {
				expect(listsResponse.error).toBeDefined();
			}
		});
	});

	describe("Basic Operations", () => {
		test("should demonstrate basic functionality", async () => {
			if (!serverAvailable) {
				console.log("⏭️  Skipping: Server not available");
				return;
			}

			// Just verify we can call the API
			const listsResponse = await client.list.list();
			expect(listsResponse).toBeDefined();
		});
	});
});
