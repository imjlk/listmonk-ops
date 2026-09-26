import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createListmonkClient } from "../index";
import { resolveListmonkClientConfig } from "../src/client/factory";
import {
	configToHeaders,
	createConfig,
	resolveListmonkTransportOptions,
	validateConfig,
} from "../src/config";

describe("Configuration Management", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		// Save original environment
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv;
	});

	describe("createConfig", () => {
		test("should create config with default values", () => {
			// Clear environment variables for this test
			const originalEnv = process.env;
			process.env = {};

			const config = createConfig();

			expect(config.baseUrl).toBe("http://localhost:9000/api");
			expect(config.auth.username).toBe("api-admin");
			expect(config.auth.token).toBe("");
			expect(config.timeout).toBe(30000);
			expect(config.retries).toBe(3);
			expect(config.headers).toEqual({});

			// Restore environment
			process.env = originalEnv;
		});

		test("should use environment variables", () => {
			process.env.LISTMONK_API_URL = "https://api.example.com";
			process.env.LISTMONK_USERNAME = "test-user";
			process.env.LISTMONK_API_TOKEN = "test-token";
			process.env.LISTMONK_TIMEOUT = "60000";
			process.env.LISTMONK_RETRIES = "5";

			const config = createConfig();

			expect(config.baseUrl).toBe("https://api.example.com");
			expect(config.auth.username).toBe("test-user");
			expect(config.auth.token).toBe("test-token");
			expect(config.timeout).toBe(60000);
			expect(config.retries).toBe(5);
		});

		test("should prioritize overrides over environment variables", () => {
			process.env.LISTMONK_API_URL = "https://env.example.com";
			process.env.LISTMONK_API_TOKEN = "env-token";

			const config = createConfig({
				baseUrl: "https://override.example.com",
				auth: {
					username: "override-user",
					token: "override-token",
				},
				timeout: 120000,
			});

			expect(config.baseUrl).toBe("https://override.example.com");
			expect(config.auth.username).toBe("override-user");
			expect(config.auth.token).toBe("override-token");
			expect(config.timeout).toBe(120000);
		});

		test("should preserve explicit zero retries", () => {
			process.env.LISTMONK_RETRIES = "5";

			const config = createConfig({
				retries: 0,
			});

			expect(config.retries).toBe(0);
		});

		test("should handle partial overrides", () => {
			// Clear environment variables for this test
			const originalEnv = process.env;
			process.env = { LISTMONK_API_TOKEN: "env-token" };

			const config = createConfig({
				auth: {
					username: "partial-user",
					token: "partial-token",
				},
			});

			expect(config.auth.username).toBe("partial-user");
			expect(config.auth.token).toBe("partial-token");
			expect(config.baseUrl).toBe("http://localhost:9000/api"); // from default

			// Restore environment
			process.env = originalEnv;
		});

		test("never completes explicit auth with environment credentials", () => {
			process.env.LISTMONK_USERNAME = "env-user";
			process.env.LISTMONK_API_TOKEN = "env-secret-token";

			const config = createConfig({
				baseUrl: "https://staging.example.com/api",
				auth: { username: "staging-bot", token: "" },
			});

			expect(config.auth).toEqual({ username: "staging-bot", token: "" });
			expect(() => validateConfig(config)).toThrow("auth.token is required");
			expect(() =>
				createListmonkClient({
					baseUrl: "https://staging.example.com/api",
					auth: { username: "staging-bot", token: "" },
				}),
			).toThrow("auth.token is required");
			expect(() =>
				createListmonkClient({
					baseUrl: "https://staging.example.com/api",
					auth: { username: "", token: "explicit-token" },
				}),
			).toThrow("auth.username is required");
		});

		test("rejects malformed timeout and retry environment variables", () => {
			for (const [name, value] of [
				["LISTMONK_TIMEOUT", "abc"],
				["LISTMONK_TIMEOUT", "30s"],
				["LISTMONK_TIMEOUT", "0"],
				["LISTMONK_TIMEOUT", "-5"],
				["LISTMONK_TIMEOUT", "2147483648"],
				["LISTMONK_RETRIES", "abc"],
				["LISTMONK_RETRIES", "1.5"],
				["LISTMONK_RETRIES", "11"],
			] as const) {
				process.env = { [name]: value };
				expect(() => createConfig()).toThrow(name);
			}
		});

		test("treats blank transport variables as unset and trims values", () => {
			process.env = { LISTMONK_TIMEOUT: "   ", LISTMONK_RETRIES: " 2 " };

			expect(resolveListmonkTransportOptions()).toEqual({
				timeout: 30000,
				retries: 2,
			});
		});

		test("explicit transport values leave malformed variables unread", () => {
			process.env = { LISTMONK_TIMEOUT: "abc", LISTMONK_RETRIES: "abc" };

			expect(resolveListmonkTransportOptions({ timeout: 500, retries: 1 })).toEqual(
				{ timeout: 500, retries: 1 },
			);
		});

		test("raw header clients honor transport variables like auth clients", () => {
			process.env = { LISTMONK_TIMEOUT: "4500", LISTMONK_RETRIES: "0" };

			const direct = resolveListmonkClientConfig({
				baseUrl: "https://listmonk.example.com/api",
				headers: { Authorization: "token api-admin:token" },
			});
			const auth = resolveListmonkClientConfig({
				baseUrl: "https://listmonk.example.com/api",
				auth: { username: "api-admin", token: "token" },
			});

			expect({ timeout: direct.timeout, retries: direct.retries }).toEqual({
				timeout: 4500,
				retries: 0,
			});
			expect({ timeout: auth.timeout, retries: auth.retries }).toEqual({
				timeout: 4500,
				retries: 0,
			});
		});

		test("reads no environment when the runtime has no process object", () => {
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
			let config: ReturnType<typeof createConfig> | undefined;
			try {
				Object.defineProperty(globalThis, "process", {
					value: undefined,
					configurable: true,
					writable: true,
				});
				config = createConfig({
					baseUrl: "https://listmonk.example.com/api",
					auth: { username: "api-admin", token: "token" },
				});
			} finally {
				if (descriptor) {
					Object.defineProperty(globalThis, "process", descriptor);
				}
			}

			expect(config).toMatchObject({
				baseUrl: "https://listmonk.example.com/api",
				timeout: 30000,
				retries: 3,
			});
		});

		test("should merge headers correctly", () => {
			const config = createConfig({
				headers: {
					"X-Custom-Header": "custom-value",
					"X-Another-Header": "another-value",
				},
			});

			expect(config.headers).toEqual({
				"X-Custom-Header": "custom-value",
				"X-Another-Header": "another-value",
			});
		});
	});

	describe("validateConfig", () => {
		test("should pass validation for valid config", () => {
			const config = createConfig({
				baseUrl: "https://api.example.com",
				auth: {
					username: "test-user",
					token: "test-token",
				},
			});

			expect(() => validateConfig(config)).not.toThrow();
		});

		test("should throw error for missing baseUrl", () => {
			const config = createConfig();
			config.baseUrl = "";

			expect(() => validateConfig(config)).toThrow("baseUrl is required");
		});

		test("should throw error for missing username", () => {
			const config = createConfig();
			config.auth.username = "";

			expect(() => validateConfig(config)).toThrow("auth.username is required");
		});

		test("should throw error for missing token", () => {
			// Clear environment variables for this test
			const originalEnv = process.env;
			process.env = {};

			const config = createConfig();
			// token is empty by default

			expect(() => validateConfig(config)).toThrow("auth.token is required");

			// Restore environment
			process.env = originalEnv;
		});

		test("should throw error for invalid URL", () => {
			const config = createConfig({
				auth: {
					username: "test-user",
					token: "test-token",
				},
			});
			config.baseUrl = "not-a-valid-url";

			expect(() => validateConfig(config)).toThrow("Invalid baseUrl");
		});
	});

	describe("configToHeaders", () => {
		test("should convert config to headers", () => {
			const config = createConfig({
				baseUrl: "https://api.example.com",
				auth: {
					username: "test-user",
					token: "test-token",
				},
				headers: {
					"X-Custom-Header": "custom-value",
				},
			});

			const headers = configToHeaders(config);

			expect(headers).toEqual({
				"Content-Type": "application/json",
				Authorization: "token test-user:test-token",
				"X-Custom-Header": "custom-value",
			});
		});

		test("should handle empty custom headers", () => {
			const config = createConfig({
				auth: {
					username: "test-user",
					token: "test-token",
				},
			});

			const headers = configToHeaders(config);

			expect(headers).toEqual({
				"Content-Type": "application/json",
				Authorization: "token test-user:test-token",
			});
		});

		test("should override default headers with custom ones", () => {
			const config = createConfig({
				auth: {
					username: "test-user",
					token: "test-token",
				},
				headers: {
					"Content-Type": "application/xml", // Override default
					Authorization: "Bearer custom-token", // Override default
				},
			});

			const headers = configToHeaders(config);

			expect(headers).toEqual({
				"Content-Type": "application/xml",
				Authorization: "Bearer custom-token",
			});
		});
	});
});
