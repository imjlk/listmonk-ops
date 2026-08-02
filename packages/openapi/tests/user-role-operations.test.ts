import { afterEach, describe, expect, test } from "bun:test";
import { createListmonkClient } from "../index";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

describe("user role operations", () => {
	test("lists, creates, and updates roles through the handwritten facade", async () => {
		const requests: Array<{
			url: string;
			method: string;
			authorization: string | null;
			body?: unknown;
		}> = [];
		globalThis.fetch = (async (input, init) => {
			const request = new Request(input, init);
			const body = request.method === "GET"
				? undefined
				: await request.clone().json();
			requests.push({
				url: request.url,
				method: request.method,
				authorization: request.headers.get("Authorization"),
				body,
			});

			if (request.method === "GET") {
				return Response.json({
					data: [
						{
							id: 2,
							type: "user",
							name: "Transactional runtime",
							permissions: ["tx:send", "subscribers:manage"],
						},
					],
				});
			}
			const inputRole = body as { name: string; permissions: string[] };
			return Response.json({
				data: {
					id: request.method === "POST" ? 3 : 2,
					type: "user",
					...inputRole,
				},
			});
		}) as typeof fetch;

		const client = createListmonkClient({
			baseUrl: "https://example.com/newsletter/api/",
			headers: { Authorization: "token provisioner:test-token" },
			retries: 0,
		});
		await expect(client.userRole.list()).resolves.toMatchObject({
			data: {
				results: [{ id: 2, name: "Transactional runtime" }],
				total: 1,
				page: 1,
			},
		});
		await expect(
			client.userRole.create({
				body: {
					name: "Template provisioner",
					permissions: ["templates:get", "templates:manage"],
				},
			}),
		).resolves.toMatchObject({ data: { id: 3, name: "Template provisioner" } });
		await expect(
			client.userRole.update({
				path: { id: 2 },
				body: {
					name: "Transactional runtime",
					permissions: ["subscribers:manage", "tx:send"],
				},
			}),
		).resolves.toMatchObject({ data: { id: 2, name: "Transactional runtime" } });

		expect(requests).toEqual([
			{
				url: "https://example.com/newsletter/api/roles/users",
				method: "GET",
				authorization: "token provisioner:test-token",
				body: undefined,
			},
			{
				url: "https://example.com/newsletter/api/roles/users",
				method: "POST",
				authorization: "token provisioner:test-token",
				body: {
					name: "Template provisioner",
					permissions: ["templates:get", "templates:manage"],
				},
			},
			{
				url: "https://example.com/newsletter/api/roles/users/2",
				method: "PUT",
				authorization: "token provisioner:test-token",
				body: {
					name: "Transactional runtime",
					permissions: ["subscribers:manage", "tx:send"],
				},
			},
		]);
	});

	test("preserves non-success role responses as typed errors", async () => {
		globalThis.fetch = (async () =>
			Response.json(
				{ message: "permission denied" },
				{ status: 403 },
			)) as typeof fetch;
		const client = createListmonkClient({
			baseUrl: "http://localhost:9000/api",
			headers: { Authorization: "token runtime:test-token" },
			retries: 0,
		});

		const result = await client.userRole.create({
			body: { name: "Denied", permissions: ["tx:send"] },
		});
		expect(result).toMatchObject({
			error: { message: "permission denied" },
			response: { status: 403 },
		});
	});

	test("normalizes exhausted transport failures without rejecting", async () => {
		const transportError = new TypeError("connection refused");
		globalThis.fetch = (async () => {
			throw transportError;
		}) as typeof fetch;
		const client = createListmonkClient({
			baseUrl: "http://127.0.0.1:9000/api",
			headers: { Authorization: "token provisioner:test-token" },
			retries: 0,
		});

		await expect(
			client.userRole.create({
				body: { name: "Unavailable", permissions: ["tx:send"] },
			}),
		).resolves.toMatchObject({
			error: transportError,
			request: { method: "POST" },
		});
	});
});
