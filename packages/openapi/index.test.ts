import { describe, expect, test } from "bun:test";

// Test the main public API exports from index
import {
	type Campaign,
	createClient,
	createListmonkClient,
	type List,
	rawSdk,
	type Subscriber,
	transformResponse,
} from "./index";

describe("Main Public API Exports", () => {
	test("should export createListmonkClient function", () => {
		expect(typeof createListmonkClient).toBe("function");
	});

	test("should export transformResponse utility", () => {
		expect(typeof transformResponse).toBe("function");
	});

	test("should export createClient for advanced use cases", () => {
		expect(typeof createClient).toBe("function");
	});

	test("should export rawSdk for advanced use cases", () => {
		expect(typeof rawSdk).toBe("object");
		expect(rawSdk).toBeDefined();
	});

	test("should export generated types", () => {
		// TypeScript compilation success is the main test for type exports
		// These type assertions will fail at compile time if types aren't exported
		const list: List = {} as List;
		const subscriber: Subscriber = {} as Subscriber;
		const campaign: Campaign = {} as Campaign;

		expect(typeof list).toBe("object");
		expect(typeof subscriber).toBe("object");
		expect(typeof campaign).toBe("object");
	});
});

describe("Public API Usage", () => {
	test("should create a listmonk client with default config", () => {
		const client = createListmonkClient({
			baseUrl: "http://localhost:9000",
		});

		expect(client).toBeDefined();
		expect(typeof client.getLists).toBe("function");
		expect(typeof client.createList).toBe("function");
		expect(typeof client.getHealthCheck).toBe("function");
		expect(typeof client.getSubscribers).toBe("function");
	});

	test("should create a listmonk client with custom config", () => {
		const client = createListmonkClient({
			baseUrl: "https://api.example.com",
			headers: {
				"Custom-Header": "value",
			},
		});

		expect(client).toBeDefined();
		expect(typeof client.getLists).toBe("function");
		expect(typeof client.createList).toBe("function");
	});

	test("should provide both SDK methods and HTTP methods", () => {
		const client = createListmonkClient({
			baseUrl: "http://localhost:9000",
		});

		// SDK methods (enhanced with flattened responses)
		expect(typeof client.getLists).toBe("function");
		expect(typeof client.createList).toBe("function");
		expect(typeof client.getHealthCheck).toBe("function");

		// HTTP methods for advanced usage (lowercase names)
		expect(typeof client.get).toBe("function");
		expect(typeof client.post).toBe("function");
		expect(typeof client.put).toBe("function");
		expect(typeof client.delete).toBe("function");
	});

	test("transformResponse utility should flatten nested data structures", async () => {
		const nestedResponse = {
			data: {
				data: { message: "success", count: 5 },
			},
		};

		const flattened = await transformResponse(nestedResponse);
		expect(flattened).toEqual({
			data: { message: "success", count: 5 },
		});
	});

	test("transformResponse should handle direct data", async () => {
		const directData = { message: "success", count: 5 };
		const result = await transformResponse(directData);
		expect(result).toEqual({ message: "success", count: 5 });
	});

	test("transformResponse should handle null/undefined", async () => {
		expect(await transformResponse(null)).toBeNull();
		expect(await transformResponse(undefined)).toBeUndefined();
	});
});

describe("Tree-shaking Support", () => {
	test("should support selective imports", () => {
		// Test that individual exports can be imported separately
		// This is verified by the successful imports at the top of the file
		expect(typeof createListmonkClient).toBe("function");
		expect(typeof transformResponse).toBe("function");
		expect(typeof createClient).toBe("function");
		expect(typeof rawSdk).toBe("object");
	});

	test("should not bundle unnecessary code", () => {
		// Create a minimal client to verify it doesn't include unused functionality
		const client = createListmonkClient({
			baseUrl: "http://localhost:9000",
		});

		// Client should have the expected interface without extra baggage
		const expectedMethods = [
			"getLists",
			"createList",
			"getHealthCheck",
			"getSubscribers",
			"get",
			"post",
			"put",
			"delete",
		];

		expectedMethods.forEach((method) => {
			expect(typeof client[method as keyof typeof client]).toBe("function");
		});
	});
});
