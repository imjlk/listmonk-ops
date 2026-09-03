import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindDashboardChartsOperationSpec,
	bindDashboardCountsOperationSpec,
} from "./specs";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	jsonResourceValue,
	readResourceSafety,
	unwrapResourceResponse,
} from "./resource-helpers";

export interface DashboardOperationContext {
	client: Pick<ListmonkClient, "dashboard">;
}

const dashboardCountsInputSchema = z.object({});

const dashboardSubscriberCountsSchema = z.looseObject({
	total: z.number().optional(),
	blocklisted: z.number().nullable().optional(),
	orphans: z.number().optional(),
});

const dashboardListCountsSchema = z.looseObject({
	total: z.number().optional(),
	private: z.number().optional(),
	public: z.number().optional(),
	optin_single: z.number().optional(),
	optin_double: z.number().optional(),
});

const dashboardCampaignCountsSchema = z.looseObject({
	total: z.number().optional(),
	by_status: z.record(z.string(), z.number()).optional(),
});

const dashboardCountsOutputSchema = z.looseObject({
	subscribers: dashboardSubscriberCountsSchema.optional(),
	lists: dashboardListCountsSchema.optional(),
	campaigns: dashboardCampaignCountsSchema.optional(),
	messages: z.number().optional(),
});

const dashboardChartPointSchema = z.looseObject({
	count: z.number().optional(),
	date: z.string().optional(),
});

const dashboardChartsInputSchema = z.object({});

const dashboardChartsOutputSchema = z.looseObject({
	link_clicks: z.array(dashboardChartPointSchema).optional(),
	campaign_views: z.array(dashboardChartPointSchema).optional(),
});

export type DashboardCounts = z.output<typeof dashboardCountsOutputSchema>;
export type DashboardCharts = z.output<typeof dashboardChartsOutputSchema>;

/**
 * Read the installation-level aggregate counters shown on the Listmonk
 * dashboard. The observed 6.2 response nests subscriber, list, and
 * campaign aggregates under `data` and reports `blocklisted` as null
 * until the breakdown is computed; the envelope is returned as observed.
 */
export async function readDashboardCounts(
	{ client }: DashboardOperationContext,
	_input: z.output<typeof dashboardCountsInputSchema>,
): Promise<DashboardCounts> {
	const response = await client.dashboard.getCounts();
	return unwrapResourceResponse(
		response,
		"Failed to read dashboard counts",
	) as DashboardCounts;
}

/**
 * Read the daily campaign-view and link-click series shown on the
 * Listmonk dashboard. Each series carries `{count, date}` buckets.
 */
export async function readDashboardCharts(
	{ client }: DashboardOperationContext,
	_input: z.output<typeof dashboardChartsInputSchema>,
): Promise<DashboardCharts> {
	const response = await client.dashboard.getCharts();
	return unwrapResourceResponse(
		response,
		"Failed to read dashboard charts",
	) as DashboardCharts;
}

export const getDashboardCountsOperation = defineOperation({
	id: "dashboard.counts",
	title: "Read dashboard counts",
	description:
		"Read aggregate subscriber, list, campaign, and message counters from the Listmonk dashboard.",
	inputSchema: dashboardCountsInputSchema,
	outputSchema: dashboardCountsOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_dashboard_counts",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindDashboardCountsOperationSpec(),
	execute: readDashboardCounts,
});

export const getDashboardChartsOperation = defineOperation({
	id: "dashboard.charts",
	title: "Read dashboard charts",
	description:
		"Read the daily campaign-view and link-click series shown on the Listmonk dashboard.",
	inputSchema: dashboardChartsInputSchema,
	outputSchema: dashboardChartsOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_dashboard_charts",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindDashboardChartsOperationSpec(),
	execute: readDashboardCharts,
});

export async function invokeGetDashboardCountsOperation(
	context: DashboardOperationContext,
	input: unknown,
): Promise<DashboardCounts> {
	const parsedInput = parseOperationInput(
		getDashboardCountsOperation.inputSchema,
		input,
	);
	let output: DashboardCounts;
	try {
		output = await readDashboardCounts(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			getDashboardCountsOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		getDashboardCountsOperation.id,
		getDashboardCountsOperation.outputSchema,
		output,
	);
}

export async function invokeGetDashboardChartsOperation(
	context: DashboardOperationContext,
	input: unknown,
): Promise<DashboardCharts> {
	const parsedInput = parseOperationInput(
		getDashboardChartsOperation.inputSchema,
		input,
	);
	let output: DashboardCharts;
	try {
		output = await readDashboardCharts(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			getDashboardChartsOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		getDashboardChartsOperation.id,
		getDashboardChartsOperation.outputSchema,
		output,
	);
}

export const dashboardOperations = [
	getDashboardCountsOperation,
	getDashboardChartsOperation,
] as const;

export const dashboardOperationCatalog = defineOperationCatalog({
	id: "dashboard",
	title: "Dashboard",
	operations: dashboardOperations,
	specMigrationExemptions: [],
});

export type DashboardOperation = (typeof dashboardOperations)[number];

const dashboardOperationsByMcpName = new Map<string, DashboardOperation>(
	dashboardOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getDashboardOperationByMcpName(
	name: string,
): DashboardOperation | undefined {
	return dashboardOperationsByMcpName.get(name);
}

export interface DashboardOperationInvocation {
	operation: DashboardOperation;
	output: Record<string, unknown>;
}

export async function invokeDashboardOperationByMcpName(
	context: DashboardOperationContext,
	name: string,
	input: unknown,
): Promise<DashboardOperationInvocation | undefined> {
	switch (name) {
		case getDashboardCountsOperation.mcp.name:
			return {
				operation: getDashboardCountsOperation,
				output: await invokeGetDashboardCountsOperation(context, input),
			};
		case getDashboardChartsOperation.mcp.name:
			return {
				operation: getDashboardChartsOperation,
				output: await invokeGetDashboardChartsOperation(context, input),
			};
		default:
			return undefined;
	}
}
