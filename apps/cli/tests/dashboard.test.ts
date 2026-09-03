import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderDashboardCharts,
	renderDashboardCounts,
	type DashboardCliContext,
} from "../src/commands/dashboard";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
		warning: mock(() => undefined),
	};
}

describe("dashboard CLI actions", () => {
	test("renders counts through the shared operation", async () => {
		const getCounts = mock(async () => ({
			data: {
				subscribers: { total: 13 },
				lists: { total: 137 },
				campaigns: { total: 174 },
			},
		}));
		const cliContext = {
			client: { dashboard: { getCounts } } as unknown as Pick<
				ListmonkClient,
				"dashboard"
			>,
			output: output(),
		} satisfies DashboardCliContext;

		await renderDashboardCounts(cliContext);

		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Dashboard: 13 subscribers, 137 lists, 174 campaigns, 0 messages",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({
			subscribers: { total: 13 },
			lists: { total: 137 },
			campaigns: { total: 174 },
		});
	});

	test("renders charts through the shared operation", async () => {
		const getCharts = mock(async () => ({
			data: {
				link_clicks: [{ count: 1, date: "2026-09-03" }],
				campaign_views: [],
			},
		}));
		const cliContext = {
			client: { dashboard: { getCharts } } as unknown as Pick<
				ListmonkClient,
				"dashboard"
			>,
			output: output(),
		} satisfies DashboardCliContext;

		await renderDashboardCharts(cliContext);

		expect(cliContext.output.json).toHaveBeenCalledWith({
			link_clicks: [{ count: 1, date: "2026-09-03" }],
			campaign_views: [],
		});
	});
});
