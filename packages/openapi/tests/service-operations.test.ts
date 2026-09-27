import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../generated/client";
import {
	createBounceOperations,
	createSettingsOperations,
} from "../src/client/service-operations";

describe("Service operation factories", () => {
	let server: ReturnType<typeof Bun.serve>;
	let settingsUpdateRequests: number;

	beforeEach(() => {
		settingsUpdateRequests = 0;
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
				if (request.method === "PUT" && url.pathname === "/api/settings") {
					settingsUpdateRequests += 1;
					return Response.json({ data: true });
				}

				return new Response("Not Found", { status: 404 });
			},
		});
	});

	afterEach(() => {
		server.stop(true);
	});

	test("createSettingsOperations refuses redacted placeholders before update", async () => {
		const client = createClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
		});
		const settings = createSettingsOperations({ client });

		await expect(
			settings.update({ body: { smtp: { password: "[redacted]" } } }),
		).rejects.toThrow('Cannot update settings with "[redacted]" placeholders');
		expect(settingsUpdateRequests).toBe(0);

		const updated = await settings.update({
			body: { smtp: { password: "replacement-secret" } },
		});
		expect(updated.data).toBe(true);
		expect(settingsUpdateRequests).toBe(1);
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
