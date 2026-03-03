import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createListmonkClient } from "../index";

describe("Resilient Fetch Policy", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = originalFetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("does not retry non-idempotent POST on 5xx", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			return new Response(
				JSON.stringify({
					error: "server error",
				}),
				{
					status: 500,
					headers: {
						"Content-Type": "application/json",
					},
				},
			);
		}) as typeof fetch;

		const client = createListmonkClient({
			baseUrl: "http://localhost:9000/api",
			headers: {
				Authorization: "token api-admin:test-token",
			},
			retries: 3,
		});

		await client.list.create({
			body: {
				name: "Retry policy list",
				type: "private",
				optin: "single",
			},
		});

		expect(calls).toBe(1);
	});

	test("retries idempotent GET on 5xx and eventually succeeds", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			if (calls < 3) {
				return new Response(
					JSON.stringify({
						error: "temporary upstream failure",
					}),
					{
						status: 500,
						headers: {
							"Content-Type": "application/json",
						},
					},
				);
			}

			return new Response("true", {
				status: 200,
				headers: {
					"Content-Type": "application/json",
				},
			});
		}) as typeof fetch;

		const client = createListmonkClient({
			baseUrl: "http://localhost:9000/api",
			headers: {
				Authorization: "token api-admin:test-token",
			},
			retries: 3,
		});

		const result = await client.getHealthCheck();
		expect(calls).toBe(3);
		expect(result.data).toBe(true);
	});

	test("does not retry when the caller aborts the request", async () => {
		let calls = 0;
		globalThis.fetch = (async () => {
			calls += 1;
			throw new DOMException("The operation was aborted.", "AbortError");
		}) as typeof fetch;

		const client = createListmonkClient({
			baseUrl: "http://localhost:9000/api",
			headers: {
				Authorization: "token api-admin:test-token",
			},
			retries: 3,
		});

		const controller = new AbortController();
		controller.abort();

		await client.list.list({
			signal: controller.signal,
		} as any);

		expect(calls).toBe(1);
	});
});
