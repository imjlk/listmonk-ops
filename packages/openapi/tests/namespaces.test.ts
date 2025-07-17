import { describe, expect, test } from "bun:test";
import { createListmonkClient } from "../src/client/index";

describe("Enhanced Client Namespaces", () => {
	const client = createListmonkClient({
		baseUrl: "http://localhost:9000/api",
		headers: {
			Authorization: "token api-admin:test-token",
		},
	});

	test("should have import namespace", () => {
		expect(client.import).toBeDefined();
		expect(typeof client.import.get).toBe("function");
		expect(typeof client.import.stop).toBe("function");
		expect(typeof client.import.logs).toBe("function");
		expect(typeof client.import.start).toBe("function");
	});

	test("should have bounce namespace", () => {
		expect(client.bounce).toBeDefined();
		expect(typeof client.bounce.get).toBe("function");
		expect(typeof client.bounce.getById).toBe("function");
		expect(typeof client.bounce.delete).toBe("function");
		expect(typeof client.bounce.deleteById).toBe("function");
	});

	test("should have transactional namespace", () => {
		expect(client.transactional).toBeDefined();
		expect(typeof client.transactional.send).toBe("function");
	});

	test("should maintain existing namespaces", () => {
		expect(client.list).toBeDefined();
		expect(client.subscriber).toBeDefined();
		expect(client.campaign).toBeDefined();
		expect(client.template).toBeDefined();
		expect(client.media).toBeDefined();
	});
});