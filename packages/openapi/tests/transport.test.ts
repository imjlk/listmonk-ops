import { afterEach, describe, expect, test } from "bun:test";

import { createListmonkClient } from "../index";
import {
	createResilientFetch,
	type FetchFn,
	ListmonkRedirectError,
} from "../src/client/transport";

const AUTH_HEADERS = { Authorization: "token api-admin:test-token" };

function stalledBodyServer() {
	return Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			new Response(
				new ReadableStream({
					start(controller) {
						// Send part of a JSON body, then never finish it.
						controller.enqueue(new TextEncoder().encode('{"data":{"results":['));
					},
				}),
				{ headers: { "Content-Type": "application/json" } },
			),
	});
}

describe("resilient fetch deadline", () => {
	const servers: Array<{ stop(force?: boolean): void }> = [];

	afterEach(() => {
		for (const server of servers.splice(0)) server.stop(true);
	});

	test("keeps the deadline armed while a response body stalls", async () => {
		const server = stalledBodyServer();
		servers.push(server);
		const client = createListmonkClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
			headers: AUTH_HEADERS,
			timeout: 100,
			retries: 0,
		});

		const started = Date.now();
		const result = (await client.list.list()) as { error?: unknown };

		expect(Date.now() - started).toBeLessThan(2_000);
		expect(result.error).toBeDefined();
		expect(String((result.error as Error).message ?? result.error)).toContain(
			"timed out after 100 ms",
		);
	});

	test("names the timeout instead of reporting a bare abort", async () => {
		const resilientFetch = createResilientFetch({
			timeoutMs: 20,
			retries: 0,
			baseFetch: (_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(init.signal?.reason),
					);
				}),
		});

		const error = await resilientFetch("https://listmonk.test/api/lists").catch(
			(caught: unknown) => caught,
		);
		expect(error).toBeInstanceOf(DOMException);
		expect((error as DOMException).name).toBe("TimeoutError");
		expect((error as DOMException).message).toBe(
			"Listmonk request timed out after 20 ms",
		);
	});

	test("releases the deadline once the body has been read", async () => {
		let signal: AbortSignal | undefined;
		const resilientFetch = createResilientFetch({
			timeoutMs: 30,
			retries: 0,
			baseFetch: async (_input, init) => {
				signal = init?.signal ?? undefined;
				return Response.json({ data: true });
			},
		});

		const response = await resilientFetch("https://listmonk.test/api/health");
		expect(await response.json()).toEqual({ data: true });
		await Bun.sleep(80);

		expect(signal?.aborted).toBe(false);
	});

	test("cancels the discarded body of a retried 5xx response", async () => {
		let cancelled = 0;
		let calls = 0;
		const resilientFetch = createResilientFetch({
			timeoutMs: 1_000,
			retries: 1,
			baseFetch: async () => {
				calls += 1;
				if (calls === 1) {
					return new Response(
						new ReadableStream({
							cancel() {
								cancelled += 1;
							},
						}),
						{ status: 503 },
					);
				}
				return Response.json({ data: [] });
			},
		});

		const response = await resilientFetch("https://listmonk.test/api/lists");

		expect(response.status).toBe(200);
		expect(calls).toBe(2);
		expect(cancelled).toBe(1);
	});
});

describe("resilient fetch redirects", () => {
	test("does not follow redirects for non-idempotent requests", async () => {
		for (const status of [301, 302, 307, 308]) {
			const error = await createResilientFetch({
				timeoutMs: 1_000,
				retries: 3,
				baseFetch: async () =>
					new Response(null, {
						status,
						headers: { Location: "https://elsewhere.test/api/lists" },
					}),
			})("https://listmonk.test/api/lists", { method: "POST" }).catch(
				(caught: unknown) => caught,
			);
			expect(error).toBeInstanceOf(ListmonkRedirectError);
			expect((error as ListmonkRedirectError).status).toBe(status);
		}
	});

	test("asks for manual redirects only for non-idempotent methods", async () => {
		const redirectModes: Record<string, RequestRedirect | undefined> = {};
		const resilientFetch = createResilientFetch({
			timeoutMs: 1_000,
			retries: 0,
			baseFetch: async (_input, init) => {
				redirectModes[init?.method ?? "GET"] = init?.redirect;
				return Response.json({ data: true });
			},
		});

		for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
			await resilientFetch("https://listmonk.test/api/lists", { method });
		}

		expect(redirectModes).toEqual({
			GET: undefined,
			POST: "manual",
			PUT: "manual",
			PATCH: "manual",
			DELETE: "manual",
		});
	});

	test("a redirected create surfaces an error and never reaches the target", async () => {
		let targetHits = 0;
		const target = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () => {
				targetHits += 1;
				return Response.json({ data: { id: 1 } });
			},
		});
		const origin = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () =>
				Response.redirect(`http://127.0.0.1:${target.port}/api/lists`, 302),
		});
		try {
			const client = createListmonkClient({
				baseUrl: `http://127.0.0.1:${origin.port}/api`,
				headers: AUTH_HEADERS,
			});
			const result = (await client.list.create({
				body: { name: "Redirected", type: "private", optin: "single" },
			})) as { data?: unknown; error?: unknown };

			expect(result.error).toBeInstanceOf(ListmonkRedirectError);
			expect(result.data).toBeUndefined();
			expect(targetHits).toBe(0);
		} finally {
			origin.stop(true);
			target.stop(true);
		}
	});
});

describe("resilient fetch configuration", () => {
	test("rejects timeouts and retry counts that would disable requests", () => {
		const baseFetch: FetchFn = async () => new Response(null);
		for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31]) {
			expect(() =>
				createResilientFetch({ timeoutMs, retries: 0, baseFetch }),
			).toThrow(RangeError);
		}
		for (const retries of [-1, 1.5, Number.NaN, 11]) {
			expect(() =>
				createResilientFetch({ timeoutMs: 1_000, retries, baseFetch }),
			).toThrow(RangeError);
		}
		expect(() =>
			createListmonkClient({
				baseUrl: "http://127.0.0.1:9/api",
				headers: AUTH_HEADERS,
				retries: Number.NaN,
			}),
		).toThrow(RangeError);
	});
});
