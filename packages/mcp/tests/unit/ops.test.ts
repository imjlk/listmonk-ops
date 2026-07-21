import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import {
	handleOpsTools,
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
		expect(opsTools).toHaveLength(9);
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
		expect(guard?.annotations?.destructiveHint).toBe(true);
	});

	test("invokes the shared preflight and returns structured output", async () => {
		const client = {
			campaign: {
				getById: async () => ({
					data: {
						id: 42,
						name: "Welcome",
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
