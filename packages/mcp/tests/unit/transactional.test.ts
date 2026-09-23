import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	computeTransactionalTargetHash,
	createFileBackedTransactionalIdempotencyStore,
} from "@listmonk-ops/common";
import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	test("inspects the server-selected claim store instead of the environment fallback", async () => {
		const directory = await mkdtemp(join(tmpdir(), "mcp-tx-selected-store-"));
		const target = { baseUrl: "http://127.0.0.1:9000/api", username: "operator" };
		const store = createFileBackedTransactionalIdempotencyStore({ storePath: join(directory, "selected.json") });
		try {
			await store.claim({ key: "selected-claim", payloadHash: "payload", targetHash: computeTransactionalTargetHash(target) });
			const result = await handleTransactionalTools(
				request("listmonk_transactional_records", { key: "selected-claim" }),
				clientWithTransactional({}),
				{ ...target, idempotencyStore: store },
			);
			expect(result.structuredContent).toMatchObject({ records: [{ key: "selected-claim", status: "pending" }] });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	test("publishes the shared schema and side-effect annotations", () => {
		expect(transactionalTools).toHaveLength(3);
		const tool = transactionalTools[0];
		expect(tool?.title).toBe("Send transactional message");
		expect(tool?.inputSchema.required).toEqual(["template_id"]);
		expect(tool?.inputSchema.properties).toMatchObject({
			subscriber_id: {
				anyOf: [{ type: "integer" }, { type: "string" }],
			},
			content_type: { enum: ["html", "markdown", "plain"] },
			headers: { type: "array" },
			messenger: { type: "string" },
			subject: { type: "string" },
			altbody: { type: "string" },
			idempotency_key: { type: "string" },
		});
		expect(tool?.outputSchema?.type).toBe("object");
		expect(tool?.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: true,
		});
		expect(transactionalTools[1]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
		expect(transactionalTools[2]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
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
				messenger: "email-transactional",
				subject: "Order ready",
				altbody: "Your order is ready.",
				data: { order_id: "OPS-42" },
				headers: [{ "X-Request-ID": "request-42" }],
			}),
			clientWithTransactional({ send }),
		);

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toBe("true");
		expect(result.structuredContent).toEqual({
			sent: true,
			status: "accepted",
		});
		expect(send).toHaveBeenCalledWith({
			template_id: 3,
			subscriber_emails: undefined,
			subscriber_ids: [42],
			from_email: undefined,
			content_type: "html",
			messenger: "email-transactional",
			subject: "Order ready",
			altbody: "Your order is ready.",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});
	});

	test("keeps legacy text aligned when Listmonk rejects the message", async () => {
		const send = mock(async () => ({
			data: false,
			request: new Request("https://example.test"),
			response: new Response(),
		}));

		const result = await handleTransactionalTools(
			request("listmonk_send_transactional", {
				template_id: 3,
				subscriber_id: 42,
			}),
			clientWithTransactional({ send }),
		);

		expect(result.isError).toBeFalsy();
		expect(result.content[0]?.text).toBe("false");
		expect(result.structuredContent).toEqual({
			sent: false,
			status: "failed",
		});
	});

	test("returns shared validation and API failures as MCP errors", async () => {
		const missingRecipient = await handleTransactionalTools(
			request("listmonk_send_transactional", { template_id: 3 }),
			clientWithTransactional({}),
		);
		expect(missingRecipient.isError).toBe(true);
		expect(missingRecipient.content[0]?.text).toContain(
			"Exactly one of subscriber_email or subscriber_id is required",
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
