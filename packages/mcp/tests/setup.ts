import { afterAll, beforeAll } from "bun:test";
import { createListmonkClient } from "@listmonk-ops/openapi";

// Test configuration
export const TEST_CONFIG = {
	baseUrl: process.env.LISTMONK_API_URL || "http://localhost:9000/api",
	username: process.env.LISTMONK_USERNAME || "test",
	password: process.env.LISTMONK_PASSWORD || "",
	apiToken: process.env.LISTMONK_API_TOKEN || "6Yf5w3IKrkcd5MrVWjqDgBePs5zj0rCM",
};

// Create test client
export function createTestClient() {
	const authString = TEST_CONFIG.apiToken 
		? `${TEST_CONFIG.username}:${TEST_CONFIG.apiToken}`
		: `${TEST_CONFIG.username}:${TEST_CONFIG.password}`;

	return createListmonkClient({
		baseUrl: TEST_CONFIG.baseUrl,
		headers: {
			Authorization: `token ${authString}`,
		},
	});
}

// Test utilities
export async function waitForListmonk(maxRetries = 30) {
	const client = createTestClient();
	
	for (let i = 0; i < maxRetries; i++) {
		try {
			// Try to get lists instead of health endpoint
			const response = await client.list.list({
				query: { page: 1, per_page: 1 }
			});
			if (response.data) {
				console.log("✅ Listmonk is ready!");
				return true;
			}
		} catch {
			console.log(`⏳ Waiting for Listmonk... (${i + 1}/${maxRetries})`);
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	}
	
	console.log("❌ Listmonk is not available, but continuing with tests...");
	return false; // Don't throw error, just continue
}

// Clean up test data
export async function cleanupTestData() {
	const client = createTestClient();
	
	try {
		// Clean up test campaigns (those starting with "Test-")
		const campaigns = await client.campaign.list({
			query: { page: 1, per_page: 100 }
		});
		if (campaigns.data?.results) {
			for (const campaign of campaigns.data.results) {
				if (campaign.name?.startsWith("Test-") && typeof campaign.id === 'number') {
					try {
						await client.campaign.delete({ path: { id: campaign.id } });
					} catch {
						// Ignore errors when cleaning up
					}
				}
			}
		}

		// Clean up test lists (those starting with "Test-")
		const lists = await client.list.list({
			query: { page: 1, per_page: 100 }
		});
		if (lists.data?.results) {
			for (const list of lists.data.results) {
				if (list.name?.startsWith("Test-") && typeof list.id === 'number') {
					try {
						await client.list.delete({ path: { list_id: list.id } });
					} catch {
						// Ignore errors when cleaning up
					}
				}
			}
		}

		// Clean up test subscribers (those with test emails)
		const subscribers = await client.subscriber.list({
			query: { page: 1, per_page: 100 }
		});
		if (subscribers.data?.results) {
			for (const subscriber of subscribers.data.results) {
				if ((subscriber.email?.includes("test@") || subscriber.email?.includes("example.com")) && typeof subscriber.id === 'number') {
					try {
						await client.subscriber.delete({ path: { id: subscriber.id } });
					} catch {
						// Ignore errors when cleaning up
					}
				}
			}
		}
	} catch {
		console.warn("⚠️ Some cleanup operations failed, continuing...");
	}
}

// Setup and teardown for all tests
beforeAll(async () => {
	console.log("🚀 Setting up E2E tests...");
	await waitForListmonk();
	await cleanupTestData();
});

afterAll(async () => {
	console.log("🧹 Cleaning up after E2E tests...");
	await cleanupTestData();
});