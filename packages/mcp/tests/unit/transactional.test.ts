import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	handleTransactionalTools,
	transactionalTools,
} from "../../src/handlers/transactional.js";
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

function clientWithTransactional(
	transactional: Partial<Pick<ListmonkClient, "transactional">["transactional"]>,
): ListmonkClient {
	return { transactional } as unknown as ListmonkClient;
}

describe("transactional operation MCP adapter", () => {
	test("publishes the shared schema and side-effect annotations", () => {
		expect(transactionalTools).toHaveLength(1);
		const tool = transactionalTools[0];
		expect(tool?.title).toBe("Send transactional message");
		expect(tool?.inputSchema.required).toEqual(["template_id"]);
		expect(tool?.inputSchema.properties).toMatchObject({
			subscriber_id: {
				anyOf: [{ type: "integer" }, { type: "string" }],
			},
			content_type: { enum: ["html", "markdown", "plain"] },
			headers: { type: "array" },
		});
		expect(tool?.outputSchema?.type).toBe("object");
		expect(tool?.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		});
	});

	test("returns structured output while preserving boolean text", async () => {
		const send = mock(async () => ({
			data: true,
			request: new Request("https://example.test"),
			response: new Response(),
		}));

		const result = await handleTransactionalTools(
			request("listmonk_send_transactional", {
				template_id: "3",
				subscriber_id: "42",
				content_type: "html",
				data: { order_id: "OPS-42" },
				headers: [{ "X-Request-ID": "request-42" }],
			}),
			clientWithTransactional({ send }),
		);

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toBe("true");
		expect(result.structuredContent).toEqual({ sent: true });
		expect(send).toHaveBeenCalledWith({
			template_id: 3,
			subscriber_email: undefined,
			subscriber_id: 42,
			from_email: undefined,
			content_type: "html",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});
	});

	test("returns shared validation and API failures as MCP errors", async () => {
		const missingRecipient = await handleTransactionalTools(
			request("listmonk_send_transactional", { template_id: 3 }),
			clientWithTransactional({}),
		);
		expect(missingRecipient.isError).toBe(true);
		expect(missingRecipient.content[0]?.text).toContain(
			"Either subscriber_email or subscriber_id is required",
		);

		const apiFailure = await handleTransactionalTools(
			request("listmonk_send_transactional", {
				template_id: 3,
				subscriber_id: 42,
			}),
			clientWithTransactional({
				send: async () => ({ error: { error: "smtp unavailable" } }),
			}),
		);
		expect(apiFailure.isError).toBe(true);
		expect(apiFailure.content[0]?.text).toContain(
			"Failed to send transactional message: smtp unavailable",
		);
	});
});
