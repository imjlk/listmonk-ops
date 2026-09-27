import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../generated/client";
import { getCampaigns as getGeneratedCampaigns } from "../generated/sdk.gen";
import { createListmonkClient } from "../index";
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

interface RecordedRequest {
	method: string;
	pathname: string;
	contentType: string | null;
	authorization: string | null;
	body: string;
}

function createRecordingFetch(
	requests: RecordedRequest[],
	respond: () => Response,
) {
	return Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const request = new Request(input, init);
			requests.push({
				method: request.method,
				pathname: new URL(request.url).pathname,
				contentType: request.headers.get("content-type"),
				authorization: request.headers.get("authorization"),
				body: await request.text(),
			});
			return respond();
		},
		{ preconnect() {} },
	);
}

function htmlPreview(): Response {
	return new Response("<p>Hi Demo Subscriber</p>", {
		headers: { "Content-Type": "text/html; charset=UTF-8" },
	});
}

// Listmonk 6.2's PreviewCampaign handler (POST /campaigns/{id}/preview and
// its /text alias) reads these with c.FormValue, so a JSON body is ignored.
const previewFields = {
	body: "<p>Hi {{ .Subscriber.Name }}: a+b & c=d 100% 안녕</p>",
	content_type: "richtext",
	template_id: 12,
} as const;
const encodedPreviewFields =
	"body=%3Cp%3EHi+%7B%7B+.Subscriber.Name+%7D%7D%3A+a%2Bb+%26+c%3Dd+100%25+%EC%95%88%EB%85%95%3C%2Fp%3E&content_type=richtext&template_id=12";

describe("Campaign preview form encoding", () => {
	for (const [method, pathname] of [
		["updatePreview", "/api/campaigns/42/preview"],
		["previewText", "/api/campaigns/42/text"],
	] as const) {
		test(`${method} form-encodes the fields the 6.2 handler reads`, async () => {
			const requests: RecordedRequest[] = [];
			const client = createClient({
				baseUrl: "http://localhost/api",
				fetch: createRecordingFetch(requests, htmlPreview),
			});
			const campaigns = createCampaignOperations({ client });

			const result = await campaigns[method]({
				path: { id: 42 },
				body: previewFields,
			});

			expect(requests).toEqual([
				{
					method: "POST",
					pathname,
					contentType: "application/x-www-form-urlencoded",
					authorization: null,
					body: encodedPreviewFields,
				},
			]);
			expect(
				Object.fromEntries(new URLSearchParams(requests[0]?.body)),
			).toEqual({ ...previewFields, template_id: "12" });
			expect(result.data).toBe("<p>Hi Demo Subscriber</p>");
		});
	}

	test("overrides the JSON content type of token-authenticated clients", async () => {
		const requests: RecordedRequest[] = [];
		const originalFetch = globalThis.fetch;
		try {
			// createListmonkClient binds the global fetch when it is created.
			globalThis.fetch = createRecordingFetch(
				requests,
				htmlPreview,
			) as typeof fetch;
			const client = createListmonkClient({
				baseUrl: "http://localhost/api",
				auth: { username: "api-user", token: "test-token" },
			});

			await client.campaign.updatePreview({
				path: { id: 42 },
				body: previewFields,
			});
			await client.campaign.previewText({
				path: { id: 42 },
				body: previewFields,
			});
		} finally {
			globalThis.fetch = originalFetch;
		}

		expect(requests).toEqual(
			["/api/campaigns/42/preview", "/api/campaigns/42/text"].map(
				(pathname) => ({
					method: "POST",
					pathname,
					contentType: "application/x-www-form-urlencoded",
					authorization: "token api-user:test-token",
					body: encodedPreviewFields,
				}),
			),
		);
	});

	test("sends only the provided fields and returns plain-text previews as strings", async () => {
		const requests: RecordedRequest[] = [];
		const client = createClient({
			baseUrl: "http://localhost/api",
			fetch: createRecordingFetch(
				requests,
				() =>
					new Response("Hi Demo Subscriber", {
						headers: { "Content-Type": "text/plain; charset=UTF-8" },
					}),
			),
		});
		const campaigns = createCampaignOperations({ client });

		const plain = await campaigns.previewText({
			path: { id: 7 },
			body: { body: "Hi {{ .Subscriber.Name }}", content_type: "plain" },
		});
		await campaigns.updatePreview({
			path: { id: 7 },
			body: { template_id: 5 },
		});

		expect(requests.map(({ pathname, body }) => [pathname, body])).toEqual([
			[
				"/api/campaigns/7/text",
				"body=Hi+%7B%7B+.Subscriber.Name+%7D%7D&content_type=plain",
			],
			["/api/campaigns/7/preview", "template_id=5"],
		]);
		expect(plain.data).toBe("Hi Demo Subscriber");
	});
});
