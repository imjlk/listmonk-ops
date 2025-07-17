import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { configToHeaders, createConfig, validateConfig } from "../src/config";

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
