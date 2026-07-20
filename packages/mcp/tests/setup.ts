import { afterAll, beforeAll, setDefaultTimeout } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListmonkClient } from "@listmonk-ops/openapi";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TESTS_DIR, "../../..");
const TEST_ENV_PATH = resolve(TESTS_DIR, ".env.test");
const TEST_ENV_LOCAL_PATH = resolve(TESTS_DIR, ".env.test.local");
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);
const CLEANUP_PAGE_SIZE = 200;
const LOCAL_TOKEN_PATH =
	process.env.LISTMONK_TEST_TOKEN_FILE || "/tmp/listmonk-ops-api-token";

export const TEST_RESOURCE_PREFIX = "lmops-e2e";

function loadTestEnvironment(): void {
	const loadFile = (path: string): void => {
		if (!existsSync(path)) {
			return;
		}

		const lines = readFileSync(path, "utf8").split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) {
				continue;
			}

			const separatorIndex = trimmed.indexOf("=");
			if (separatorIndex < 0) {
				continue;
			}

			const key = trimmed.slice(0, separatorIndex).trim();
			if (!key) {
				continue;
			}

			let value = trimmed.slice(separatorIndex + 1).trim();
			if (
				(value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))
			) {
				value = value.slice(1, -1);
			}

			if (process.env[key] === undefined) {
				process.env[key] = value;
			}
		}
	};

	// Explicit process env wins, then .env.test.local, then committed defaults.
	for (const envPath of [TEST_ENV_LOCAL_PATH, TEST_ENV_PATH]) {
		loadFile(envPath);
	}
}

function readEnvValue(...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = process.env[key]?.trim();
		if (value) {
			return value;
		}
	}

	return undefined;
}

function normalizeApiUrl(url: string): string {
	const trimmed = url.trim();
	const withoutTrailingSlash = trimmed.endsWith("/")
		? trimmed.slice(0, -1)
		: trimmed;
	const withApiSuffix = withoutTrailingSlash.endsWith("/api")
		? withoutTrailingSlash
		: `${withoutTrailingSlash}/api`;

	return new URL(withApiSuffix).toString().replace(/\/$/, "");
}

function isLocalTarget(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		return LOCAL_HOSTNAMES.has(url.hostname);
	} catch {
		return false;
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String(error.message);
	}
	return String(error);
}

function hasResponseError<T>(response: {
	data?: T;
	error?: unknown;
}): response is { data?: T; error: unknown } {
	return "error" in response && response.error !== undefined;
}

function createResourceSlug(label: string): string {
	const normalized = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return normalized.length > 0 ? normalized : "resource";
}

export function buildTestName(label: string): string {
	return `${TEST_RESOURCE_PREFIX}-${createResourceSlug(label)}-${Date.now()}-${Math.random()
		.toString(36)
		.slice(2, 8)}`;
}

export function buildTestEmail(label = "user"): string {
	return `${buildTestName(label)}@example.com`;
}

export function isManagedTestName(name: string | undefined): boolean {
	return (
		typeof name === "string" && name.startsWith(`${TEST_RESOURCE_PREFIX}-`)
	);
}

export function isManagedTestEmail(email: string | undefined): boolean {
	return (
		typeof email === "string" && email.includes(`${TEST_RESOURCE_PREFIX}-`)
	);
}

loadTestEnvironment();

function resolveApiTokenFromLocalStack(): string | undefined {
	if (process.env.LISTMONK_API_TOKEN?.trim()) {
		return process.env.LISTMONK_API_TOKEN.trim();
	}
	if (existsSync(LOCAL_TOKEN_PATH)) {
		const token = readFileSync(LOCAL_TOKEN_PATH, "utf8").trim();
		if (token) {
			return token;
		}
	}

	const dockerCheck = Bun.spawnSync(["docker", "--version"], {
		cwd: REPO_ROOT,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (dockerCheck.exitCode !== 0) {
		return undefined;
	}

	const bootstrapResult = Bun.spawnSync(
		["bun", "run", "stack:bootstrap-auth"],
		{ cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
	);
	if (bootstrapResult.exitCode !== 0 || !existsSync(LOCAL_TOKEN_PATH)) {
		return undefined;
	}

	const token = readFileSync(LOCAL_TOKEN_PATH, "utf8").trim();
	return token.length > 0 ? token : undefined;
}

const resolvedBaseUrl = normalizeApiUrl(
	readEnvValue("LISTMONK_API_URL", "LISTMONK_URL") ||
		"http://localhost:9000/api",
);
const resolvedUsername = readEnvValue("LISTMONK_USERNAME") || "api-admin";
const resolvedPassword = readEnvValue("LISTMONK_PASSWORD") || "";
const resolvedApiToken =
	readEnvValue("LISTMONK_API_TOKEN") || resolveApiTokenFromLocalStack();
const allowRemoteE2E = readEnvValue("LISTMONK_E2E_ALLOW_REMOTE") === "1";

process.env.LISTMONK_API_URL = resolvedBaseUrl;
process.env.LISTMONK_USERNAME = resolvedUsername;
process.env.LISTMONK_PASSWORD = resolvedPassword;
process.env.LISTMONK_API_TOKEN = resolvedApiToken || "";

export const TEST_CONFIG = {
	baseUrl: resolvedBaseUrl,
	username: resolvedUsername,
	password: resolvedPassword,
	apiToken: resolvedApiToken,
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

function assertSafeTestTarget(): void {
	if (!isLocalTarget(TEST_CONFIG.baseUrl) && !allowRemoteE2E) {
		throw new Error(
			`Refusing to run MCP E2E against non-local target ${TEST_CONFIG.baseUrl}. Set LISTMONK_E2E_ALLOW_REMOTE=1 to override.`,
		);
	}
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
	if (!isLocalTarget(TEST_CONFIG.baseUrl) && !allowRemoteE2E) {
		console.warn("⚠️ Skipping cleanup for non-local MCP E2E target");
		return;
	}

	const client = createTestClient();

	try {
		// Clean up tagged test campaigns.
		const campaigns = await client.campaign.list({
			query: { page: 1, per_page: CLEANUP_PAGE_SIZE },
		});
		if (hasResponseError(campaigns)) {
			throw new Error(formatError(campaigns.error));
		}
		if (campaigns.data?.results) {
			for (const campaign of campaigns.data.results) {
				if (
					isManagedTestName(campaign.name) &&
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

		// Clean up tagged test lists.
		const lists = await client.list.list({
			query: { page: 1, per_page: CLEANUP_PAGE_SIZE },
		});
		if (hasResponseError(lists)) {
			throw new Error(formatError(lists.error));
		}
		if (lists.data?.results) {
			for (const list of lists.data.results) {
				if (isManagedTestName(list.name) && typeof list.id === "number") {
					try {
						await client.list.delete({ path: { list_id: list.id } });
					} catch {
						// Ignore errors when cleaning up
					}
				}
			}
		}

		// Clean up tagged test subscribers.
		const subscribers = await client.subscriber.list({
			query: { page: 1, per_page: CLEANUP_PAGE_SIZE },
		});
		if (hasResponseError(subscribers)) {
			throw new Error(formatError(subscribers.error));
		}
		if (subscribers.data?.results) {
			for (const subscriber of subscribers.data.results) {
				if (
					isManagedTestEmail(subscriber.email) &&
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

		// Clean up tagged test templates.
		const templates = await client.template.list({
			query: { page: 1, per_page: CLEANUP_PAGE_SIZE },
		});
		if (hasResponseError(templates)) {
			throw new Error(formatError(templates.error));
		}
		if (templates.data?.results) {
			for (const template of templates.data.results) {
				if (
					isManagedTestName(template.name) &&
					typeof template.id === "number"
				) {
					try {
						await client.template.delete({ path: { id: template.id } });
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
	assertSafeTestTarget();
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
