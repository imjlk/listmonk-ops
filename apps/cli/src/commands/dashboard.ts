import type { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeGetDashboardChartsOperation,
	invokeGetDashboardCountsOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { getOutput } from "../lib/output";
import { defineCommand, defineGroup, type HandlerArgs } from "../lib/command";
import { toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type DashboardOutput = Pick<typeof OutputUtils, "info" | "json" | "success">;

export interface DashboardCliContext {
	client: Pick<ListmonkClient, "dashboard">;
	output: DashboardOutput;
}

export function createDashboardCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderDashboardCounts(
	context: DashboardCliContext,
): Promise<void> {
	const counts = await invokeGetDashboardCountsOperation(context, {});
	context.output.success(
		`Dashboard: ${counts.subscribers?.total ?? 0} subscribers, ${counts.lists?.total ?? 0} lists, ${counts.campaigns?.total ?? 0} campaigns`,
	);
	context.output.json(counts);
}

export async function renderDashboardCharts(
	context: DashboardCliContext,
): Promise<void> {
	const charts = await invokeGetDashboardChartsOperation(context, {});
	const views = charts.campaign_views?.length ?? 0;
	const clicks = charts.link_clicks?.length ?? 0;
	if (views === 0 && clicks === 0) {
		context.output.info("No dashboard chart data in the current window");
	}
	context.output.json(charts);
}

export async function handleDashboardCountsCommand({
	...args
}: HandlerArgs<Record<string, never>>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDashboardCounts({ client, output: getOutput() });
	} catch (error) {
		throw createDashboardCommandError("Failed to read dashboard counts", error);
	}
}

export async function handleDashboardChartsCommand({
	...args
}: HandlerArgs<Record<string, never>>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDashboardCharts({ client, output: getOutput() });
	} catch (error) {
		throw createDashboardCommandError("Failed to read dashboard charts", error);
	}
}

export default defineGroup({
	name: "dashboard",
	description: "Read Listmonk dashboard aggregates",
	commands: [
		defineCommand({
			name: "counts",
			operationId: "dashboard.counts",
			description:
				"Read aggregate subscriber, list, campaign, and message counters",
			options: {},
			handler: handleDashboardCountsCommand,
		}),
		defineCommand({
			name: "charts",
			operationId: "dashboard.charts",
			description:
				"Read the daily campaign-view and link-click series",
			options: {},
			handler: handleDashboardChartsCommand,
		}),
	],
});
