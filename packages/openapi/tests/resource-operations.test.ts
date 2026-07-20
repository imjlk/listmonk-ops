import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../generated/client";
import { createMediaOperations } from "../src/client/resource-operations";

describe("Resource operation factories", () => {
	let server: ReturnType<typeof Bun.serve>;

	beforeEach(() => {
		server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (request.method === "GET" && url.pathname === "/api/media") {
					return Response.json({
						data: [{ id: 3, filename: "logo.png" }],
					});
				}

				return new Response("Not Found", { status: 404 });
			},
		});
	});

	afterEach(() => {
		server.stop(true);
	});

	test("createMediaOperations resolves the generated getMedia method", async () => {
		const client = createClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
		});
		const media = createMediaOperations({ client });

		const response = await media.list();

		expect(response.data.results).toHaveLength(1);
		expect(response.data.total).toBe(1);
	});
});
