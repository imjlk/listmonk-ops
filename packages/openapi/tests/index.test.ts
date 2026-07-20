import { describe, expect, test } from "bun:test";
import type {
	Campaign,
	List,
	ListmonkClient,
	ListmonkConfig,
	Subscriber,
	Template,
} from "../index";
import { createListmonkClient } from "../index";

describe("Main Public API Exports", () => {
	test("should export createListmonkClient function", () => {
		expect(typeof createListmonkClient).toBe("function");
	});

	test("should export essential type definitions", () => {
		// TypeScript types - can't test at runtime, but importing them verifies they exist
		const _typeCheck = {} as ListmonkClient;
		const _configCheck = {} as ListmonkConfig;
		const _campaignCheck = {} as Campaign;
		const _listCheck = {} as List;
		const _subscriberCheck = {} as Subscriber;
		const _templateCheck = {} as Template;

		// If we get here, all essential types are exported correctly
		expect(true).toBe(true);
	});

	test("should have minimal exports for smaller bundle size", () => {
		// Import the module and check it only exports what we expect
		const indexModule = require("../index");
		const exportedKeys = Object.keys(indexModule);

		// Should only have the essential exports
		expect(exportedKeys).toContain("createListmonkClient");
		expect(exportedKeys.length).toBeLessThan(10); // Much smaller than before
	});
});

describe("Client Creation", () => {
	test("should create client with only registered namespaces", () => {
		const client = createListmonkClient({
			baseUrl: "http://localhost:9000/api",
			headers: {
				Authorization: "token test:test",
			},
		});

		// Should have registered namespaces
		expect(client.list).toBeDefined();
		expect(client.subscriber).toBeDefined();
		expect(client.campaign).toBeDefined();
		expect(client.template).toBeDefined();
		expect(client.media).toBeDefined();
		expect(client.import).toBeDefined();
		expect(client.bounce).toBeDefined();
		expect(client.transactional).toBeDefined();
		expect(client.getHealthCheck).toBeDefined();

		// Should NOT have raw SDK methods or internal utilities
		const runtimeClient = client as unknown as Record<string, unknown>;
		expect(runtimeClient.createList).toBeUndefined();
		expect(runtimeClient.getLists).toBeUndefined();
		expect(runtimeClient.rawSdk).toBeUndefined();
		expect(runtimeClient.transformResponse).toBeUndefined();
	});

	test("should have clean autocomplete interface", () => {
		const client = createListmonkClient({
			baseUrl: "http://localhost:9000/api",
			headers: {
				Authorization: "token test:test",
			},
		});

		// Test that only clean namespaces are available
		const keys = Object.keys(client);
		const expectedKeys = [
			"getHealthCheck",
			"list",
			"subscriber",
			"campaign",
			"template",
			"media",
			"import",
			"bounce",
			"transactional",
		];

		for (const key of expectedKeys) {
			expect(keys.includes(key)).toBe(true);
		}

		// Should not have hundreds of generated SDK methods
		expect(keys.length).toBeLessThan(20);
	});
});
