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
import { handleMediaTools, mediaTools } from "../../src/handlers/media.js";
import type { CallToolRequest } from "../../src/types/mcp.js";
import { MAX_TEMPLATE_MANIFEST_BYTES } from "@listmonk-ops/operations";

function request(
	name: string,
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

describe("campaign, subscriber, template, and media operation adapters", () => {
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
		const reconcileTemplateTool = templatesTools.find(
			(tool) => tool.name === "listmonk_reconcile_template_manifest",
		);
		expect(reconcileTemplateTool?.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
		});
		expect(reconcileTemplateTool?.inputSchema.required).toEqual(
			expect.arrayContaining(["schema_version", "templates", "confirm"]),
		);
		expect(reconcileTemplateTool?.inputSchema.properties?.dry_run).toMatchObject({
			type: "boolean",
			default: true,
		});
		expect(reconcileTemplateTool?.inputSchema.properties?.templates).toMatchObject({
			type: "array",
			maxItems: 500,
		});
		const setDefaultTemplateTool = templatesTools.find(
			(tool) => tool.name === "listmonk_set_default_template",
		);
		expect(setDefaultTemplateTool?.annotations?.destructiveHint).toBe(false);
		expect(setDefaultTemplateTool?.inputSchema.required).not.toContain("confirm");
		expect(mediaTools.map((tool) => tool.name)).toEqual([
			"listmonk_get_media",
			"listmonk_get_media_file",
			"listmonk_delete_media",
			"listmonk_upload_media",
		]);
		const deleteMediaTool = mediaTools.find(
			(tool) => tool.name === "listmonk_delete_media",
		);
		expect(deleteMediaTool?.annotations?.destructiveHint).toBe(true);
		expect(deleteMediaTool?.inputSchema.required).toContain("confirm");
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

	test("routes default template changes through the shared operation", async () => {
		const client = {
			template: {
				setAsDefault: async () => ({
					data: [],
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleTemplatesTools(
			request("listmonk_set_default_template", { id: "12" }),
			client,
		);

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({ id: 12, set_default: true });
		expect(result.content[0]?.text).toBe("Default template set successfully");
	});

	test("routes bounded template manifest plans through the shared operation", async () => {
		const client = {
			template: {
				list: async () => ({ data: { results: [], total: 0 } }),
			},
		} as unknown as ListmonkClient;

		const result = await handleTemplatesTools(
			request("listmonk_reconcile_template_manifest", {
				schema_version: 1,
				templates: [
					{ name: "Sign-in code", type: "tx", body: "<p>OTP</p>" },
				],
				dry_run: true,
			}),
			client,
		);

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			schema_version: 1,
			dry_run: true,
			results: [
				{ name: "Sign-in code", action: "create", applied: false },
			],
		});
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(
			result.structuredContent,
		);
	});

	test("rejects oversized manifests and reports body-free partial apply details", async () => {
		const list = async () => ({ data: { results: [], total: 0 } });
		const oversized = await handleTemplatesTools(
			request("listmonk_reconcile_template_manifest", {
				schema_version: 1,
				templates: [
					{
						name: "Oversized template",
						body: "x".repeat(MAX_TEMPLATE_MANIFEST_BYTES),
					},
				],
			}),
			{ template: { list } } as unknown as ListmonkClient,
		);
		expect(oversized.isError).toBe(true);
		expect(oversized.content[0]?.text).toContain("byte limit");

		const create = async ({ body }: { body: Record<string, unknown> }) => {
			if (body.name === "Password reset code") {
				throw new Error("remote create failed");
			}
			return { data: { id: 20, ...body } };
		};
		const partial = await handleTemplatesTools(
			request("listmonk_reconcile_template_manifest", {
				schema_version: 1,
				templates: [
					{ name: "Account sign-in code", type: "tx", body: "<p>OTP</p>" },
					{ name: "Password reset code", type: "tx", body: "<p>Reset</p>" },
				],
				dry_run: false,
			}),
			{ template: { list, create } } as unknown as ListmonkClient,
		);
		expect(partial.isError).toBe(true);
		expect(partial.content[0]?.text).toContain("Account sign-in code");
		expect(partial.content[0]?.text).not.toContain("<p>OTP</p>");
		expect(partial.content[0]?.text).not.toContain("<p>Reset</p>");
	});

	test("routes media reads through the shared operation result adapter", async () => {
		const client = {
			media: {
				list: async () => ({
					data: {
						results: [
							{ id: 7, filename: "newsletter.png" },
							{ id: 8, filename: "archive.png" },
						],
						total: 2,
						per_page: 2,
						page: 1,
					},
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleMediaTools(
			request("listmonk_get_media", { page: "2", per_page: "1" }),
			client,
		);

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			results: [{ id: 8, filename: "archive.png" }],
			total: 2,
			per_page: 1,
			page: 2,
		});
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(
			result.structuredContent,
		);
	});
});
