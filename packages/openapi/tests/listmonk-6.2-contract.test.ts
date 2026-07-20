import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createListmonkClient } from "../index";
import {
	getAboutInfo,
	getImportSubscriberLogs,
	patchSubscriberById,
	setDefaultTemplateById,
	updateTemplateById,
} from "../sdk";

type CapturedRequest = {
	method: string;
	pathname: string;
	body: unknown;
};

describe("Listmonk v6.2 contracts", () => {
	let server: ReturnType<typeof Bun.serve>;
	let requests: CapturedRequest[] = [];
	let client: ReturnType<typeof createListmonkClient>;

	beforeEach(() => {
		requests = [];
		server = Bun.serve({
			port: 0,
			async fetch(request) {
				const url = new URL(request.url);
				let body: unknown;
				if (!["GET", "HEAD"].includes(request.method)) {
					body = await request.json().catch(() => undefined);
				}

				requests.push({ method: request.method, pathname: url.pathname, body });

				if (request.method === "GET" && url.pathname === "/api/about") {
					return Response.json({ version: "v6.2.0", build: "test" });
				}
				if (
					request.method === "PATCH" &&
					url.pathname === "/api/subscribers/42"
				) {
					return Response.json({
						data: { id: 42, email: "before@example.com", ...(body as object) },
					});
				}
				if (request.method === "POST" && url.pathname === "/api/tx") {
					return Response.json({ data: true });
				}
				if (
					request.method === "POST" &&
					url.pathname === "/api/campaigns/7/test"
				) {
					return Response.json({ data: true });
				}
				if (
					request.method === "GET" &&
					url.pathname === "/api/import/subscribers/logs"
				) {
					return Response.json({ data: "import complete" });
				}

				return new Response("Not Found", { status: 404 });
			},
		});

		client = createListmonkClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
			headers: { Authorization: "token api-admin:test-token" },
		});
	});

	afterEach(() => {
		server.stop(true);
	});

	test("exports the renamed v6.2 raw operations", () => {
		expect(typeof getAboutInfo).toBe("function");
		expect(typeof getImportSubscriberLogs).toBe("function");
		expect(typeof patchSubscriberById).toBe("function");
		expect(typeof updateTemplateById).toBe("function");
		expect(typeof setDefaultTemplateById).toBe("function");
	});

	test("reads the running Listmonk version from /about", async () => {
		const response = await client.system.getAbout();

		expect(response.data.version).toBe("v6.2.0");
		expect(requests[0]).toMatchObject({
			method: "GET",
			pathname: "/api/about",
		});
	});

	test("partially updates subscribers with PATCH", async () => {
		const response = await client.subscriber.patch({
			path: { id: 42 },
			body: { name: "Updated Name" },
		});

		if ("error" in response) {
			throw new Error(String(response.error));
		}

		expect(response.data.name).toBe("Updated Name");
		expect(requests[0]).toMatchObject({
			method: "PATCH",
			pathname: "/api/subscribers/42",
		});
	});

	test("passes the complete v6.2 transactional payload", async () => {
		const response = await client.transactional.send({
			subscriber_mode: "external",
			subscriber_emails: ["recipient@example.com"],
			template_id: 1,
			subject: "Receipt",
			altbody: "Plain-text fallback",
			headers: [{ "X-Request-ID": "request-1" }],
		});

		expect(response.data).toBe(true);
		expect(requests[0]?.body).toMatchObject({
			subscriber_mode: "external",
			subscriber_emails: ["recipient@example.com"],
			subject: "Receipt",
			altbody: "Plain-text fallback",
		});
	});

	test("passes campaign test fields omitted by the upstream spec", async () => {
		const response = await client.campaign.test({
			path: { id: 7 },
			body: {
				name: "Visual campaign",
				subject: "Preview",
				from_email: "Sender <sender@example.com>",
				content_type: "visual",
				messenger: "email",
				type: "regular",
				body: "<p>Preview</p>",
				altbody: "Preview",
				headers: [{ "X-Campaign": "preview" }],
				lists: [1],
				media: [3],
				subscribers: ["recipient@example.com"],
			},
		});

		expect(response.data).toBe(true);
		expect(requests[0]).toMatchObject({
			method: "POST",
			pathname: "/api/campaigns/7/test",
			body: {
				content_type: "visual",
				altbody: "Preview",
				media: [3],
				subscribers: ["recipient@example.com"],
			},
		});
	});

	test("uses the renamed import logs operation", async () => {
		const response = await client.import.logs();

		expect(response.data).toBe("import complete");
		expect(requests[0]).toMatchObject({
			method: "GET",
			pathname: "/api/import/subscribers/logs",
		});
	});
});
