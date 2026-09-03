import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, test } from "bun:test";
import {
	dashboardTools,
	handleDashboardTools,
} from "../../src/handlers/dashboard";
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

describe("dashboard operation adapter", () => {
	test("publishes the shared read tools", () => {
		expect(dashboardTools.map((tool) => tool.name)).toEqual([
			"listmonk_get_dashboard_counts",
			"listmonk_get_dashboard_charts",
		]);
		expect(dashboardTools[0]?.annotations).toMatchObject({
			readOnlyHint: true,
			destructiveHint: false,
		});
	});

	test("routes reads through the shared operation result adapter", async () => {
		const client = {
			dashboard: {
				getCounts: async () => ({
					data: {
						subscribers: { total: 1 },
						messages: 0,
					},
				}),
			},
		} as unknown as ListmonkClient;

		const result = await handleDashboardTools(
			request("listmonk_get_dashboard_counts"),
			client,
		);
		expect(result.isError).toBeFalsy();
		expect(result.structuredContent).toEqual({
			subscribers: { total: 1 },
			messages: 0,
		});
		expect(JSON.parse(result.content[0]?.text ?? "null")).toEqual(
			result.structuredContent,
		);

		const unknown = await handleDashboardTools(
			request("listmonk_unknown_dashboard"),
			client,
		);
		expect(unknown.isError).toBe(true);
	});
});
