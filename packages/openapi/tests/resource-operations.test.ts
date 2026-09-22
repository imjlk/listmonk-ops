import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../generated/client";
import { getCampaigns } from "../generated/sdk.gen";
import {
	createCampaignOperations,
	createMediaOperations,
} from "../src/client/resource-operations";

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

describe("Campaign tag query serialization", () => {
	for (const tags of [[], ["news"], ["news & events", "한글"]]) {
		test(`serializes repeated singular tag parameters: ${JSON.stringify(tags)}`, async () => {
			const requests: URL[] = [];
			const client = createClient({
				baseUrl: "http://localhost/api",
				fetch: async (request) => {
					requests.push(new URL(request.url));
					return Response.json({
						data: { results: [], total: 0, page: 2, per_page: 7 },
					});
				},
			});
			const campaigns = createCampaignOperations({ client });
			const query = { tags, page: 2, per_page: 7, status: "draft" as const };
			const response = await campaigns.list({ query });
			await getCampaigns({ client, query: { tag: tags, page: 2, per_page: 7, status: "draft" } });
			for (const url of requests) {
				expect(url.searchParams.getAll("tag")).toEqual(tags);
				expect(url.searchParams.has("tags")).toBe(false);
				expect(url.searchParams.get("page")).toBe("2");
				expect(url.searchParams.get("per_page")).toBe("7");
				expect(url.searchParams.get("status")).toBe("draft");
			}
			expect(query.tags).toEqual(tags);
			expect(response.data.total).toBe(0);
		});
	}

	test("supports an omitted query and gives singular tag precedence over its alias", async () => {
		const requests: URL[] = [];
		const client = createClient({
			baseUrl: "http://localhost/api",
			fetch: async (request) => {
				requests.push(new URL(request.url));
				return Response.json({ data: { results: [], total: 0 } });
			},
		});
		const campaigns = createCampaignOperations({ client });
		await campaigns.list();
		await campaigns.list({ query: { tag: ["canonical"], tags: ["alias"] } });
		expect(requests[0]?.search).toBe("");
		expect(requests[1]?.searchParams.getAll("tag")).toEqual(["canonical"]);
		expect(requests[1]?.searchParams.has("tags")).toBe(false);
	});
});
