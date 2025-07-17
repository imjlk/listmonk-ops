import { describe, expect, test } from "bun:test";
import { createListmonkClient } from "../index";
import type {
	ListmonkClient,
	ListmonkConfig,
	Campaign,
	List,
	Subscriber,
	Template,
} from "../index";

describe("Main Public API Exports", () => {
	test("should export createListmonkClient function", () => {
		expect(typeof createListmonkClient).toBe("function");
	});

	test("should export essential type definitions", () => {
		// TypeScript types - can't test at runtime, but importing them verifies they exist
		const _typeCheck: ListmonkClient = {} as any;
		const _configCheck: ListmonkConfig = {} as any;
		const _campaignCheck: Campaign = {} as any;
		const _listCheck: List = {} as any;
		const _subscriberCheck: Subscriber = {} as any;
		const _templateCheck: Template = {} as any;

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
		expect((client as any).createList).toBeUndefined();
		expect((client as any).getLists).toBeUndefined();
		expect((client as any).rawSdk).toBeUndefined();
		expect((client as any).transformResponse).toBeUndefined();
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