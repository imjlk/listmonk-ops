import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../generated/client";
import { getCampaigns as getGeneratedCampaigns } from "../generated/sdk.gen";
import { getCampaigns, type GetCampaignsData } from "../sdk";
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

function createRecordingCampaignClient(requests: URL[]) {
	return createClient({
		baseUrl: "http://localhost/api",
		fetch: Object.assign(
			async (request: RequestInfo | URL) => {
				requests.push(
					new URL(request instanceof Request ? request.url : String(request)),
				);
				return Response.json({
					data: { results: [], total: 0, page: 2, per_page: 7 },
				});
			},
			{ preconnect() {} },
		),
	});
}

describe("Campaign tag query serialization", () => {
	for (const tags of [[], ["news"], ["news & events", "한글"]]) {
		test(`serializes repeated singular tag parameters: ${JSON.stringify(tags)}`, async () => {
			const requests: URL[] = [];
			const client = createRecordingCampaignClient(requests);
			const campaigns = createCampaignOperations({ client });
			const query = { tags, page: 2, per_page: 7 };
			const response = await campaigns.list({ query });
			await getCampaigns({ client, query: { tags, page: 2, per_page: 7 } satisfies GetCampaignsData["query"] });
			await getGeneratedCampaigns({ client, query: { tag: tags, page: 2, per_page: 7 } });
			for (const url of requests) {
				expect(url.searchParams.getAll("tag")).toEqual(tags);
				expect(url.searchParams.has("tags")).toBe(false);
				expect(url.searchParams.get("page")).toBe("2");
				expect(url.searchParams.get("per_page")).toBe("7");
			}
			expect(query.tags).toEqual(tags);
			expect(response.data.total).toBe(0);
		});
	}

	test("supports an omitted query and gives singular tag precedence over its alias", async () => {
		const requests: URL[] = [];
		const client = createRecordingCampaignClient(requests);
		const campaigns = createCampaignOperations({ client });
		await campaigns.list();
		await campaigns.list({ query: { tag: ["canonical"], tags: ["alias"] } });
		expect(requests[0]?.search).toBe("");
		expect(requests[1]?.searchParams.getAll("tag")).toEqual(["canonical"]);
		expect(requests[1]?.searchParams.has("tags")).toBe(false);
	});

	test("serializes the analytics end-of-day bound and repeated ids", async () => {
		const requests: URL[] = [];
		const client = createRecordingCampaignClient(requests);
		const campaigns = createCampaignOperations({ client });
		await campaigns.getAnalytics({
			path: { type: "views" },
			query: {
				from: "2026-09-26",
				to: "2026-09-26 23:59:59.999999",
				id: ["1", "2"],
			},
		});
		expect(requests[0]?.pathname).toBe("/api/campaigns/analytics/views");
		expect(requests[0]?.searchParams.get("from")).toBe("2026-09-26");
		expect(requests[0]?.searchParams.get("to")).toBe(
			"2026-09-26 23:59:59.999999",
		);
		expect(requests[0]?.searchParams.getAll("id")).toEqual(["1", "2"]);
	});
});

describe("Media list pagination", () => {
	test("forwards page, per_page, and query and keeps the server envelope", async () => {
		const requests: URL[] = [];
		const client = createClient({
			baseUrl: "http://localhost/api",
			fetch: Object.assign(
				async (request: RequestInfo | URL) => {
					requests.push(
						new URL(request instanceof Request ? request.url : String(request)),
					);
					// Observed Listmonk 6.2 media page envelope.
					return Response.json({
						data: {
							results: [{ id: 21, filename: "banner.png" }],
							search: "",
							query: "",
							total: 41,
							per_page: 20,
							page: 2,
						},
					});
				},
				{ preconnect() {} },
			),
		});
		const media = createMediaOperations({ client });

		const response = await media.list({
			query: { page: 2, per_page: 20, query: "banner" },
		});

		expect(requests[0]?.pathname).toBe("/api/media");
		expect(requests[0]?.searchParams.get("page")).toBe("2");
		expect(requests[0]?.searchParams.get("per_page")).toBe("20");
		expect(requests[0]?.searchParams.get("query")).toBe("banner");
		expect(response.data).toEqual({
			results: [{ id: 21, filename: "banner.png" }],
			total: 41,
			per_page: 20,
			page: 2,
		});
	});
});
