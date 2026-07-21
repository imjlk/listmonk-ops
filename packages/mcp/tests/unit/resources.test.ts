import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import {
	campaignsTools,
	handleCampaignsTools,
} from "../../src/handlers/campaigns.js";
import {
	handleSubscribersTools,
	subscribersTools,
} from "../../src/handlers/subscribers.js";
import {
	handleTemplatesTools,
	templatesTools,
} from "../../src/handlers/templates.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

function request(
	name: string,
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

describe("campaign, subscriber, and template operation adapters", () => {
	test("publishes shared CRUD metadata and the campaign update tool", () => {
		expect(campaignsTools.map((tool) => tool.name)).toContain(
			"listmonk_update_campaign",
		);
		expect(
			campaignsTools.find((tool) => tool.name === "listmonk_get_campaigns")
				?.outputSchema?.type,
		).toBe("object");
		expect(
			campaignsTools.find((tool) => tool.name === "listmonk_delete_campaign")
				?.annotations?.destructiveHint,
		).toBe(true);
		expect(subscribersTools.map((tool) => tool.name)).toContain(
			"listmonk_update_subscriber",
		);
		expect(templatesTools.map((tool) => tool.name)).toContain(
			"listmonk_update_template",
		);
	});

test("routes campaign reads through the shared operation result adapter", async () => {
		const client = {
			campaign: {
				list: async () => ({
					data: { results: [{ id: 7, name: "Newsletter" }], total: 1 },
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleCampaignsTools(
			request("listmonk_get_campaigns", { page: "2", per_page: "10" }),
			client,
		);

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toMatchObject({
			results: [{ id: 7, name: "Newsletter" }],
			page: 2,
			per_page: 10,
		});
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(
			result.structuredContent,
		);
	});

test("rejects empty subscriber updates at the shared boundary", async () => {
		let called = false;
		const client = {
			subscriber: {
				update: async () => {
					called = true;
					return { data: { id: 4 } };
				},
			},
		} as unknown as ListmonkClient;

		const result = await handleSubscribersTools(
			request("listmonk_update_subscriber", { id: "4" }),
			client,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"At least one subscriber field must be provided",
		);
		expect(called).toBe(false);
	});

test("routes template creation through the shared operation", async () => {
		const client = {
			template: {
				create: async () => ({
					data: { id: 12, name: "Campaign", type: "campaign", body: "<p />" },
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleTemplatesTools(
			request("listmonk_create_template", {
				name: "Campaign",
				type: "campaign",
				body: "<p />",
			}),
			client,
		);

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toMatchObject({ id: 12, name: "Campaign" });
	});
});
