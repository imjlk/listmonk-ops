import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	handleMaintenanceTools,
	maintenanceTools,
} from "../../src/handlers/maintenance";
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

describe("maintenance operation adapter", () => {
	test("publishes destructive one-shot tools with confirmation inputs", () => {
		expect(maintenanceTools.map((tool) => tool.name)).toEqual([
			"listmonk_gc_subscribers",
			"listmonk_gc_unconfirmed_subscriptions",
			"listmonk_gc_analytics",
		]);
		for (const tool of maintenanceTools) {
			expect(tool.annotations).toMatchObject({
				readOnlyHint: false,
				destructiveHint: true,
			});
			expect(tool.inputSchema.required).toEqual(
				expect.arrayContaining(["confirm"]),
			);
		}
	});

	test("executes a confirmed collection through the shared dispatcher", async () => {
		const gcSubscribers = mock(async () => ({ data: { count: 2 } }));
		const client = {
			maintenance: { gcSubscribers },
		} as unknown as ListmonkClient;

		const result = await handleMaintenanceTools(
			request("listmonk_gc_subscribers", { type: "orphan", confirm: true }),
			client,
		);
		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			type: "orphan",
			count: 2,
		});
	});

	test("reports unknown maintenance tools as errors", async () => {
		const client = {} as unknown as ListmonkClient;
		const result = await handleMaintenanceTools(
			request("listmonk_unknown_maintenance"),
			client,
		);
		expect(result.isError).toBe(true);
	});
});
