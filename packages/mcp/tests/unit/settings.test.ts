import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import { handleSettingsTools } from "../../src/handlers/settings";
import {
	handleSharedSettingsTools,
	sharedSettingsTools,
} from "../../src/handlers/settings-shared";
import type { CallToolRequest } from "../../src/types/mcp";

function request(
	name: string,
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

describe("settings shared adapter", () => {
	test("publishes the redacted read tool", () => {
		expect(sharedSettingsTools.map((tool) => tool.name)).toEqual([
			"listmonk_get_settings",
			"listmonk_test_smtp",
		]);
		expect(sharedSettingsTools[0]?.annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
		});
		expect(sharedSettingsTools[1]?.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
		});
	});

	test("routes the read and never exposes credentials", async () => {
		const client = {
			settings: {
				get: async () => ({
					data: {
						"app.site_name": "Mailing list",
						"bounce.sendgrid_key": "SG.super-secret",
						messengers: [
							{
								name: "sms-gateway",
								root_url:
									"https://gw-user:gw-pass@sms.example.com/listmonk?api_key=sms-api-key&channel=sms",
							},
						],
					},
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleSharedSettingsTools(
			request("listmonk_get_settings"),
			client,
		);
		expect(result.isError).toBeFalsy();
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("Mailing list");
		for (const secret of ["SG.super-secret", "gw-pass", "sms-api-key"]) {
			expect(text).not.toContain(secret);
			expect(JSON.stringify(result.structuredContent)).not.toContain(secret);
		}
		expect(result.structuredContent).toMatchObject({
			settings: {
				messengers: [
					{
						root_url:
							"https://[redacted]@sms.example.com/listmonk?api_key=[redacted]&channel=sms",
					},
				],
			},
		});
	});
});

describe("legacy server config tool", () => {
	/** A Listmonk 6.2 `GET /api/config` document with URL credentials. */
	function listmonk62ServerConfig() {
		return {
			root_url: "https://stage-user:stage-basic-pass@lists.example.com",
			from_email: "listmonk <noreply@example.com>",
			public_subscription: {
				enabled: true,
				captcha_enabled: false,
				captcha_provider: null,
				captcha_key: null,
				altcha_complexity: 300000,
				redirect_urls: [
					"https://example.com/thanks?token=trusted-redirect-token",
					"https://example.com/welcome",
				],
			},
			privacy: { disable_tracking: false, individual_tracking: false },
			media_provider: "filesystem",
			messengers: ["email", "sms-gateway"],
			langs: [{ code: "en", name: "English (en)" }],
			lang: "en",
			permissions: [
				{ group: "settings", permissions: ["settings:get", "settings:manage"] },
			],
			update: null,
			needs_restart: false,
			has_legacy_user: false,
			version: "v6.2.0",
		};
	}

	test("redacts credentials in the settings-derived URLs it echoes", async () => {
		const client = {
			system: { getConfig: async () => ({ data: listmonk62ServerConfig() }) },
		} as unknown as ListmonkClient;

		const result = await handleSettingsTools(
			request("listmonk_get_server_config"),
			client,
		);

		expect(result.isError).toBeFalsy();
		const text = result.content[0]?.text ?? "";
		for (const secret of [
			"stage-user",
			"stage-basic-pass",
			"trusted-redirect-token",
		]) {
			expect(text).not.toContain(secret);
		}
		expect(JSON.parse(text)).toEqual({
			...listmonk62ServerConfig(),
			root_url: "https://[redacted]@lists.example.com/",
			public_subscription: {
				...listmonk62ServerConfig().public_subscription,
				redirect_urls: [
					"https://example.com/thanks?token=[redacted]",
					"https://example.com/welcome",
				],
			},
		});
	});

	test("keeps reporting API errors", async () => {
		const client = {
			system: {
				getConfig: async () => ({ error: { message: "forbidden" } }),
			},
		} as unknown as ListmonkClient;

		const result = await handleSettingsTools(
			request("listmonk_get_server_config"),
			client,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toBe(
			"Error: Failed to fetch server config: forbidden",
		);
	});
});
