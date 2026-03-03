import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createListmonkClient } from "../index";

type CapturedRequest = {
	method: string;
	pathname: string;
	body: unknown;
};

describe("Template Operations Contract", () => {
	let server: ReturnType<typeof Bun.serve>;
	let requests: CapturedRequest[] = [];
	let client: ReturnType<typeof createListmonkClient>;

	beforeEach(() => {
		requests = [];

		server = Bun.serve({
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
				let body: unknown = undefined;
				if (!["GET", "HEAD"].includes(request.method)) {
					try {
						body = await request.json();
					} catch {
						body = undefined;
					}
				}

				requests.push({
					method: request.method,
					pathname: url.pathname,
					body,
				});

				if (request.method === "GET" && url.pathname === "/api/templates") {
					return Response.json({
						data: [
							{
								id: 1,
								name: "Template A",
								body: "<p>Hello</p>",
								type: "campaign",
								is_default: false,
							},
						],
					});
				}

				if (request.method === "POST" && url.pathname === "/api/templates") {
					return Response.json({
						data: {
							id: 2,
							...(body as Record<string, unknown>),
							is_default: false,
						},
					});
				}

				if (request.method === "PUT" && url.pathname === "/api/templates/1") {
					return Response.json({
						data: {
							id: 1,
							...(body as Record<string, unknown>),
							is_default: false,
						},
					});
				}

				if (request.method === "PUT" && url.pathname === "/api/templates/1/default") {
					return Response.json({
						data: {
							id: 1,
							name: "Template A",
							body: "<p>Hello</p>",
							type: "campaign",
							is_default: true,
						},
					});
				}

				return new Response("Not Found", { status: 404 });
			},
		});

		client = createListmonkClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
			headers: {
				Authorization: "token api-admin:test-token",
			},
		});
	});

	afterEach(() => {
		server.stop(true);
	});

	test("template.list should normalize array payload to results format", async () => {
		const response = await client.template.list();

		expect(Array.isArray(response.data.results)).toBe(true);
		expect(response.data.results.length).toBe(1);
		expect(response.data.total).toBe(1);
		expect(response.data.page).toBe(1);
		expect(response.data.per_page).toBe(1);
		expect(requests[0]?.method).toBe("GET");
		expect(requests[0]?.pathname).toBe("/api/templates");
	});

	test("template.create should call POST /api/templates", async () => {
		const response = await client.template.create({
			body: {
				name: "New Template",
				type: "campaign",
				body: "<p>Hi</p>",
			},
		});

		expect(response.data.id).toBe(2);
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.pathname).toBe("/api/templates");
	});

	test("template.update should call PUT /api/templates/{id}", async () => {
		const response = await client.template.update({
			path: { id: 1 },
			body: {
				name: "Updated Template",
			},
		});

		if ("error" in response) {
			throw new Error(String(response.error));
		}

		expect(response.data.id).toBe(1);
		expect(requests[0]?.method).toBe("PUT");
		expect(requests[0]?.pathname).toBe("/api/templates/1");
	});

	test("template.setAsDefault should call PUT /api/templates/{id}/default", async () => {
		const response = await client.template.setAsDefault({
			path: { id: 1 },
		});

		expect(response.data.id).toBe(1);
		expect(response.data.is_default).toBe(true);
		expect(requests[0]?.method).toBe("PUT");
		expect(requests[0]?.pathname).toBe("/api/templates/1/default");
	});
});
