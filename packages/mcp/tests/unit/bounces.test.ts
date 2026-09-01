import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
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
	test("publishes the shared read and delete tools beside the legacy bulk tool", () => {
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
		const deleteTool = bouncesTools.find(
			(tool) => tool.name === "listmonk_delete_bounce",
		);
		expect(deleteTool?.annotations).toMatchObject({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
		});
		expect(deleteTool?.inputSchema.required).toEqual(
			expect.arrayContaining(["id", "confirm"]),
		);
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

	test("routes the single bounce delete through the shared operation", async () => {
		// The confirmation gate itself lives at the server boundary
		// (enforced by the e2e suite); this exercises the shared dispatch
		// once a request is confirmed.
		const deleteById = mock(async () => ({ data: true }));
		const client = {
			bounce: {
				deleteById,
			},
		} as unknown as ListmonkClient;

		const confirmed = await handleBouncesTools(
			request("listmonk_delete_bounce", { id: "1", confirm: true }),
			client,
		);
		expect(confirmed.isError).toBeFalsy();
		expect(confirmed.structuredContent).toEqual({ id: 1, deleted: true });
		expect(confirmed.content[0]?.text).toBe("Bounce deleted successfully");
		expect(deleteById).toHaveBeenCalledWith({ path: { id: 1 } });

		const rejected = await handleBouncesTools(
			request("listmonk_delete_bounce", { id: true }),
			client,
		);
		expect(rejected.isError).toBe(true);
	});

	test("keeps the legacy bulk delete tool dispatchable", async () => {
		const deleteById = mock(async () => ({ data: true }));
		const deleteBulk = mock(async () => ({ data: true }));
		const client = {
			bounce: {
				deleteById,
				delete: deleteBulk,
			},
		} as unknown as ListmonkClient;

		const bulk = await handleBouncesTools(
			request("listmonk_delete_bounces", { ids: ["1", "2"] }),
			client,
		);
		expect(bulk.isError).toBeFalsy();
		expect(bulk.content[0]?.text).toContain("Bounces deleted successfully");
		expect(deleteBulk).toHaveBeenCalledWith({ query: { id: "1,2" } });

		const unknown = await handleBouncesTools(
			request("listmonk_unknown_bounce"),
			client,
		);
		expect(unknown.isError).toBe(true);
	});
});
