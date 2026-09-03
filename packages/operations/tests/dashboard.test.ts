import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	dashboardOperationCatalog,
	dashboardOperations,
	getDashboardOperationByMcpName,
	invokeDashboardOperationByMcpName,
	invokeGetDashboardChartsOperation,
	invokeGetDashboardCountsOperation,
} from "../src/dashboard";
import { OperationExecutionError } from "../src/operation";

type DashboardClient = Pick<ListmonkClient, "dashboard">;

function dashboardContext(
	methods: Partial<DashboardClient["dashboard"]>,
): { client: DashboardClient } {
	return { client: { dashboard: methods } as DashboardClient };
}

const countsPayload = {
	subscribers: { total: 13, blocklisted: null, orphans: 8 },
	lists: {
		total: 137,
		private: 87,
		public: 50,
		optin_single: 136,
		optin_double: 1,
	},
	campaigns: {
		total: 174,
		by_status: { cancelled: 8, draft: 22, finished: 144 },
	},
	messages: 0,
};

describe("shared dashboard operations", () => {
	test("exposes a read-only registry with safety metadata", () => {
		expect(dashboardOperations).toHaveLength(2);
		expect(dashboardOperationCatalog.id).toBe("dashboard");
		for (const operation of dashboardOperations) {
			expect(operation.safety).toEqual({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: true,
			});
		}
		expect(
			getDashboardOperationByMcpName("listmonk_get_dashboard_charts"),
		).toBe(dashboardOperations[1]);
		expect(getDashboardOperationByMcpName("listmonk_unknown")).toBe(undefined);
	});

	test("reads the aggregate counters as observed", async () => {
		const getCounts = mock(async () => ({ data: countsPayload }));

		await expect(
			invokeGetDashboardCountsOperation(
				dashboardContext({
					getCounts: getCounts as DashboardClient["dashboard"]["getCounts"],
				}),
				{},
			),
		).resolves.toEqual(countsPayload);
		expect(getCounts).toHaveBeenCalledTimes(1);
	});

	test("reads the daily chart series as observed", async () => {
		const getCharts = mock(async () => ({
			data: {
				link_clicks: [{ count: 1, date: "2026-09-03" }],
				campaign_views: [{ count: 2, date: "2026-09-03" }],
			},
		}));

		await expect(
			invokeGetDashboardChartsOperation(
				dashboardContext({
					getCharts: getCharts as DashboardClient["dashboard"]["getCharts"],
				}),
				{},
			),
		).resolves.toEqual({
			link_clicks: [{ count: 1, date: "2026-09-03" }],
			campaign_views: [{ count: 2, date: "2026-09-03" }],
		});
	});

	test("surfaces transport failures through the operation error contract", async () => {
		const getCounts = mock(async () => ({
			error: "invalid API credentials",
			response: { status: 403 },
		}));

		const error = await invokeGetDashboardCountsOperation(
			dashboardContext({
				getCounts: getCounts as unknown as DashboardClient["dashboard"]["getCounts"],
			}),
			{},
		).catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(OperationExecutionError);
		expect(error).toHaveProperty("operationId", "dashboard.counts");
	});

	test("dispatches MCP names through the named operations", async () => {
		const getCounts = mock(async () => ({ data: countsPayload }));
		const context = dashboardContext({
			getCounts: getCounts as DashboardClient["dashboard"]["getCounts"],
		});

		await expect(
			invokeDashboardOperationByMcpName(
				context,
				"listmonk_get_dashboard_counts",
				{},
			),
		).resolves.toMatchObject({
			operation: dashboardOperations[0],
			output: countsPayload,
		});
		await expect(
			invokeDashboardOperationByMcpName(context, "listmonk_unknown", {}),
		).resolves.toBe(undefined);
	});
});
