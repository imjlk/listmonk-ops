import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../generated/client";
import { createBounceOperations } from "../src/client/service-operations";

describe("Service operation factories", () => {
	let server: ReturnType<typeof Bun.serve>;

	beforeEach(() => {
		server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (request.method === "GET" && url.pathname === "/api/bounces") {
					return Response.json({
						data: {
							results: [{ id: 7, type: "hard", source: "campaign" }],
							total: 1,
							per_page: 20,
							page: 2,
						},
					});
				}

				return new Response("Not Found", { status: 404 });
			},
		});
	});

	afterEach(() => {
		server.stop(true);
	});

	test("createBounceOperations normalizes list metadata", async () => {
		const client = createClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
		});
		const bounce = createBounceOperations({ client });

		const response = await bounce.list({ page: 2, per_page: 20 });

		expect(response.data.results).toHaveLength(1);
		expect(response.data.total).toBe(1);
		expect(response.data.per_page).toBe(20);
		expect(response.data.page).toBe(2);
	});
});
