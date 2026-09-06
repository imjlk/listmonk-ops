import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import {
	handleSettingsSharedTools,
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
		]);
		expect(sharedSettingsTools[0]?.annotations).toMatchObject({
			readOnlyHint: true,
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
					},
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleSettingsSharedTools(
			request("listmonk_get_settings"),
			client,
		);
		expect(result.isError).toBeFalsy();
		const text = result.content[0]?.text ?? "";
		expect(text).toContain("Mailing list");
		expect(text).not.toContain("SG.super-secret");
		expect(JSON.stringify(result.structuredContent)).not.toContain(
			"SG.super-secret",
		);
	});
});
