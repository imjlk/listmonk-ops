import { afterAll, beforeAll, setDefaultTimeout } from "bun:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListmonkClient } from "@listmonk-ops/openapi";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function resolveApiTokenFromDocker(username: string): string | undefined {
	if (process.env.LISTMONK_API_TOKEN?.trim()) {
		return process.env.LISTMONK_API_TOKEN.trim();
	}

	const dockerCheck = Bun.spawnSync(["docker", "--version"], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (dockerCheck.exitCode !== 0) {
		return undefined;
	}

	const query = `SELECT password FROM users WHERE username='${username}' LIMIT 1;`;
	const tokenResult = Bun.spawnSync(
		[
			"docker",
			"compose",
			"-f",
			"docker-compose.yml",
			"exec",
			"-T",
			"db",
			"psql",
			"-U",
			"listmonk",
			"-d",
			"listmonk",
			"-Atc",
			query,
		],
		{
			cwd: REPO_ROOT,
			stdout: "pipe",
			stderr: "pipe",
		},
	);

	if (tokenResult.exitCode !== 0) {
		return undefined;
	}

	const token = tokenResult.stdout.toString().trim();
	return token.length > 0 ? token : undefined;
}

// Test configuration
export const TEST_CONFIG = {
	baseUrl: process.env.LISTMONK_API_URL || "http://localhost:9000/api",
	username: process.env.LISTMONK_USERNAME || "api-admin",
	password: process.env.LISTMONK_PASSWORD || "",
	apiToken: resolveApiTokenFromDocker(
		process.env.LISTMONK_USERNAME || "api-admin",
	),
};

setDefaultTimeout(30000);

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
			// Verify authenticated API access, not just process availability.
			const response = await client.list.list({
				query: { page: 1, per_page: 1 },
			});
			if (!("error" in response) && response.data) {
				console.log("✅ Listmonk is ready!");
				return true;
			}
		} catch {
			console.log(`⏳ Waiting for Listmonk... (${i + 1}/${maxRetries})`);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}

	console.log("❌ Listmonk authenticated readiness check failed.");
	return false;
}

// Clean up test data
export async function cleanupTestData() {
	const client = createTestClient();

	try {
		// Clean up test campaigns (those starting with "Test-")
		const campaigns = await client.campaign.list({
			query: { page: 1, per_page: 100 },
		});
		if (campaigns.data?.results) {
			for (const campaign of campaigns.data.results) {
				if (
					campaign.name?.startsWith("Test-") &&
					typeof campaign.id === "number"
				) {
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
			query: { page: 1, per_page: 100 },
		});
		if (lists.data?.results) {
			for (const list of lists.data.results) {
				if (list.name?.startsWith("Test-") && typeof list.id === "number") {
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
			query: { page: 1, per_page: 100 },
		});
		if (subscribers.data?.results) {
			for (const subscriber of subscribers.data.results) {
				if (
					(subscriber.email?.includes("test@") ||
						subscriber.email?.includes("example.com")) &&
					typeof subscriber.id === "number"
				) {
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
	const ready = await waitForListmonk();
	if (!ready) {
		throw new Error(
			`Listmonk not ready or auth failed (baseUrl=${TEST_CONFIG.baseUrl}, username=${TEST_CONFIG.username})`,
		);
	}
	await cleanupTestData();
});

afterAll(async () => {
	console.log("🧹 Cleaning up after E2E tests...");
	await cleanupTestData();
});
