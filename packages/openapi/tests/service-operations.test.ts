import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createClient } from "../generated/client";
import {
	createBounceOperations,
	createSettingsOperations,
} from "../src/client/service-operations";

describe("Service operation factories", () => {
	let server: ReturnType<typeof Bun.serve>;
	let settingsUpdateRequests: number;
	let settingsTestSmtpRequests: number;

	beforeEach(() => {
		settingsUpdateRequests = 0;
		settingsTestSmtpRequests = 0;
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
				if (
					request.method === "POST" &&
					url.pathname === "/api/settings/smtp/test"
				) {
					settingsTestSmtpRequests += 1;
					return Response.json({ data: true });
				}

				return new Response("Not Found", { status: 404 });
			},
		});
	});

	afterEach(async () => {
		await server.stop(true);
	});

	test("createSettingsOperations rejects redacted settings update placeholders", async () => {
		const client = createClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
		});
		const settings = createSettingsOperations({ client });

		await expect(
			settings.update({ body: { smtp: [{ password: "[redacted]" }] } }),
		).rejects.toThrow(
			'Cannot update settings: smtp[0].password still holds the "[redacted]" placeholder',
		);
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: { server: { url: "https://[redacted]@smtp.example.com" } },
			}),
		).rejects.toThrow("Cannot update settings: server.url still holds");
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: { server: { url: "https:\\\\[redacted]@smtp.example.com" } },
			}),
		).rejects.toThrow("Cannot update settings: server.url still holds");
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: {
					redirect:
						"https://app.example/login?redirect=https%3A%2F%2F%5Bredacted%5D%40host",
				},
			}),
		).rejects.toThrow("Cannot update settings: redirect still holds");
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: {
					redirect:
						"https://app.example/login?redirect=https%3A%2F%2Fhost%2Fcb%3Ftoken%3D%5Bredacted%5D",
				},
			}),
		).rejects.toThrow("Cannot update settings: redirect still holds");
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: {
					redirect:
						"https://app.example/login?redirect=https%253A%252F%252F%5Bredacted%5D%2540inner%ZZ",
				},
			}),
		).rejects.toThrow("Cannot update settings: redirect still holds");
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: {
					redirect:
						"https://app.example/login?redirect=https%253A%252F%252Fhost%252F%ED%A0%80%253Ftoken%253D%5Bredacted%5D",
				},
			}),
		).rejects.toThrow("Cannot update settings: redirect still holds");
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: {
					redirect: "https://app.example/callback?clientsecret=[redacted]",
				},
			}),
		).rejects.toThrow("Cannot update settings: redirect still holds");
		expect(settingsUpdateRequests).toBe(0);
		await expect(
			settings.update({
				body: {
					redirect:
						"https://app.example/callback?awsaccesskeyid=[redacted]&awssecretaccesskey=[redacted]",
				},
			}),
		).rejects.toThrow("Cannot update settings: redirect still holds");
		expect(settingsUpdateRequests).toBe(0);
		// The redactor reads "sig%26" as the credential name "sig&", so a
		// placeholder after it must be refused rather than saved.
		await expect(
			settings.update({
				body: {
					"app.logo_url": "https://media.example.com/logo.png?sig%26=[redacted]",
				},
			}),
		).rejects.toThrow("Cannot update settings: app.logo_url still holds");
		expect(settingsUpdateRequests).toBe(0);

		const updated = await settings.update({
			body: {
				smtp: { password: "replacement-secret" },
				note: "Include the literal [redacted] marker in this documentation example",
			},
		});
		expect(updated.data).toBe(true);
		expect(settingsUpdateRequests).toBe(1);
		const cssUpdated = await settings.update({
			body: {
				appearance: {
					admin: {
						custom_css:
							"background:url(https://cdn.example/x?label=[redacted]);background:url(https://cdn.example/x?monkey=[redacted]&hockey=[redacted])",
					},
				},
			},
		});
		expect(cssUpdated.data).toBe(true);
		expect(settingsUpdateRequests).toBe(2);

		// A body JSON cannot serialize passes the guard and fails in the
		// client's serializer as an error result, without a request.
		const cyclicBody: Record<string, unknown> = { "app.site_name": "Lists" };
		cyclicBody.self = cyclicBody;
		const cyclicUpdate = await settings.update({ body: cyclicBody });
		expect(cyclicUpdate.error).toBeDefined();
		expect(settingsUpdateRequests).toBe(2);
	});

	test("createSettingsOperations rejects redacted SMTP test credentials before sending", async () => {
		const client = createClient({
			baseUrl: `http://127.0.0.1:${server.port}/api`,
		});
		const settings = createSettingsOperations({ client });

		await expect(
			settings.testSmtp({
				body: { email: "ops@example.com", server: { password: "[redacted]" } },
			}),
		).rejects.toThrow(
			'Cannot test SMTP settings: server.password still holds the "[redacted]" placeholder',
		);
		expect(settingsTestSmtpRequests).toBe(0);

		const tested = await settings.testSmtp({
			body: { email: "ops@example.com", server: { password: "replacement-secret" } },
		});
		expect(tested.data).toBe(true);
		expect(settingsTestSmtpRequests).toBe(1);
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
