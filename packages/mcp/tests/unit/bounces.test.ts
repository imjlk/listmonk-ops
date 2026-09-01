import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import { bouncesTools, handleBouncesTools } from "../../src/handlers/bounces";
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

describe("bounce operation adapter", () => {
	test("publishes the shared read tools beside the legacy delete tools", () => {
		expect(bouncesTools.map((tool) => tool.name)).toEqual([
			"listmonk_get_bounces",
			"listmonk_get_bounce",
			"listmonk_delete_bounce",
			"listmonk_delete_bounces",
		]);
		const listTool = bouncesTools.find(
			(tool) => tool.name === "listmonk_get_bounces",
		);
		expect(listTool?.annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
		});
	});

	test("routes bounce reads through the shared operation result adapter", async () => {
		const bounceRecord = {
			id: 1,
			type: "hard",
			source: "api",
			meta: { reason: "550 mailbox unavailable" },
			created_at: "2026-08-31T23:28:53.63484Z",
			email: "reader@example.com",
			subscriber_id: 663,
			subscriber_status: "enabled",
			campaign: { id: 1, name: "Test campaign" },
		};
		const client = {
			bounce: {
				list: async () => ({
					data: {
						results: [bounceRecord],
						total: 1,
						per_page: 20,
						page: 1,
					},
				}),
				getById: async () => ({ data: bounceRecord }),
			},
		} as unknown as ListmonkClient;

		const listResult = await handleBouncesTools(
			request("listmonk_get_bounces", { page: "1", per_page: "20" }),
			client,
		);
		expect(listResult.isError).toBeFalsy();
		expect(listResult.structuredContent).toEqual({
			results: [bounceRecord],
			total: 1,
			per_page: 20,
			page: 1,
		});
		expect(JSON.parse(listResult.content[0]?.text ?? "null")).toEqual(
			listResult.structuredContent,
		);

		const getResult = await handleBouncesTools(
			request("listmonk_get_bounce", { id: "1" }),
			client,
		);
		expect(getResult.isError).toBeFalsy();
		expect(getResult.structuredContent).toEqual(bounceRecord);
	});

	test("reports invalid bounce read inputs as tool errors", async () => {
		const client = {
			bounce: {
				list: async () => {
					throw new Error("must not be called");
				},
			},
		} as unknown as ListmonkClient;

		const result = await handleBouncesTools(
			request("listmonk_get_bounces", { order_by: "total" }),
			client,
		);

		expect(result.isError).toBe(true);
	});

	test("keeps the legacy delete tools dispatchable", async () => {
		const client = {
			bounce: {
				deleteById: async () => ({ data: true }),
				delete: async () => ({ data: true }),
			},
		} as unknown as ListmonkClient;

		const single = await handleBouncesTools(
			request("listmonk_delete_bounce", { id: "1" }),
			client,
		);
		expect(single.isError).toBeFalsy();
		expect(single.content[0]?.text).toContain("Bounce deleted successfully");

		const unknown = await handleBouncesTools(
			request("listmonk_unknown_bounce"),
			client,
		);
		expect(unknown.isError).toBe(true);
	});
});
