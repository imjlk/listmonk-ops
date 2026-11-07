import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import {
	handleOpsTools,
	createOpsToolsHandler,
	isOpsToolName,
	opsTools,
} from "../../src/handlers/ops.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

function request(
	name: string,
	args: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: args },
	};
}

describe("ops operation MCP adapter", () => {
	test("publishes registry metadata for every ops tool", () => {
		expect(opsTools).toHaveLength(10);
		expect(isOpsToolName("listmonk_ops_preflight")).toBe(true);
		expect(isOpsToolName("listmonk_ops_preflight_extra")).toBe(false);

		const preflight = opsTools.find(
			(tool) => tool.name === "listmonk_ops_preflight",
		);
		expect(preflight?.title).toBe("Run campaign preflight");
		expect(preflight?.inputSchema.required).toEqual(["campaign_id"]);
		expect(preflight?.outputSchema?.type).toBe("object");
		expect(preflight?.annotations).toMatchObject({
		readOnlyHint: true,
		destructiveHint: false,
	});

		const guard = opsTools.find(
			(tool) => tool.name === "listmonk_ops_deliverability_guard",
		);
		expect(guard?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: true,
		});
		expect(guard?.inputSchema.required).toEqual(["campaign_id", "confirm"]);
		expect(guard?.inputSchema.properties?.confirm).toMatchObject({
			type: "boolean",
			const: true,
		});
	});

	test("invokes the shared preflight and returns structured output", async () => {
		const client = {
			campaign: {
				preview: async () => ({ data: '<p>Campaign</p><a href="https://newsletter.test/subscription/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000">Leave list</a>' }),
				getById: async () => ({
					data: {
						id: 42,
						name: "Welcome",
						updated_at: "2026-01-01T00:00:00Z",
						status: "draft",
						subject: "Hello",
						body: "Unsubscribe",
						lists: [{ id: 7 }],
					},
				}),
			},
			list: {
				getById: async () => ({
					data: { id: 7, name: "Audience", subscriber_count: 10 },
				}),
			},
			template: {
				getById: async () => ({ data: { id: 3 } }),
			},
		} as unknown as ListmonkClient;

		const result = await handleOpsTools(
			request("listmonk_ops_preflight", { campaign_id: "42" }),
			client,
		);

		expect(result.isError).toBeFalsy();
		expect(result.structuredContent?.campaignId).toBe(42);
		expect(result.content[0]?.text).toContain('"campaignId": 42');
	});

	test("returns shared input and unknown-tool errors", async () => {
		const invalid = await handleOpsTools(
			request("listmonk_ops_deliverability_guard", {
				campaign_id: 42,
				bounce_threshold: null,
			}),
			{} as ListmonkClient,
		);
		expect(invalid.isError).toBe(true);
		expect(invalid.content[0]?.text).toContain(
			"Missing required parameter: bounce_threshold",
		);

		const unknown = await handleOpsTools(
			request("listmonk_ops_unknown"),
			{} as ListmonkClient,
		);
		expect(unknown.isError).toBe(true);
		expect(unknown.content[0]?.text).toContain(
			"Unknown tool: listmonk_ops_unknown",
		);
	});
});

test("health MCP is read-only, structured and does not consult the remote client", async () => {
	const handler = createOpsToolsHandler({
		sequenceSource: { kind: "postgres" },
		webhookSource: { kind: "conflict" },
	});
	const client = new Proxy({}, { get() { throw new Error("Remote access forbidden"); } }) as ListmonkClient;
	const result = await handler(request("listmonk_ops_health", { at: "2026-11-07T00:00:00Z" }), client);
	expect(result.isError).toBeFalsy();
	expect(result.structuredContent).toMatchObject({
		severity: "unknown",
		check_passed: false,
		complete: false,
	});
	expect(opsTools.find((tool) => tool.name === "listmonk_ops_health")?.annotations).toMatchObject(
		{ readOnlyHint: true, destructiveHint: false, openWorldHint: false },
	);
});
