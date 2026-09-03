import {
	dashboardChartsOutputContract,
	dashboardCountsOutputContract,
	emptyInputContract,
} from "../contract-schemas";
import { defineOperationSpec } from "../operation";

/**
 * Dashboard aggregates are open-world computed views: the normalized
 * envelope is stable, but the counters reflect Listmonk's current state
 * rather than guarantees.
 */
export const dashboardCountsOperationSpec = defineOperationSpec({
	id: "dashboard.counts",
	resource: "dashboard",
	verb: "counts",
	title: "Read dashboard counts",
	description:
		"Read aggregate subscriber, list, campaign, and message counters from the Listmonk dashboard.",
	contract: {
		input: emptyInputContract,
		output: dashboardCountsOutputContract,
	},
	effects: [{ kind: "read", resource: "dashboard" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads current aggregate counters.",
	},
	agent: {
		useWhen: [
			"An installation-level overview of subscribers, lists, campaigns, or messages is needed.",
		],
		avoidWhen: ["Per-campaign engagement detail is required — prefer campaigns.analytics."],
		prerequisites: [],
		verifyWith: [],
		related: ["dashboard.charts", "ops.digest.daily"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_dashboard_counts",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/dashboard-specs.ts#dashboardCountsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/dashboard-specs.ts#bindDashboardCountsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/dashboard.ts#getDashboardCountsOperation:variable",
			invokerNode:
				"packages/operations/src/dashboard.ts#invokeGetDashboardCountsOperation:function",
			executorNode:
				"packages/operations/src/dashboard.ts#readDashboardCounts:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export const dashboardChartsOperationSpec = defineOperationSpec({
	id: "dashboard.charts",
	resource: "dashboard",
	verb: "charts",
	title: "Read dashboard charts",
	description:
		"Read the daily campaign-view and link-click series shown on the Listmonk dashboard.",
	contract: {
		input: emptyInputContract,
		output: dashboardChartsOutputContract,
	},
	effects: [{ kind: "read", resource: "dashboard" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads recorded daily series.",
	},
	agent: {
		useWhen: [
			"Recent view/click engagement trends must be summarized without per-campaign detail.",
		],
		avoidWhen: ["Per-campaign attribution is required — prefer campaigns.analytics."],
		prerequisites: [],
		verifyWith: [],
		related: ["dashboard.counts", "campaigns.analytics"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_dashboard_charts",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/dashboard-specs.ts#dashboardChartsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/dashboard-specs.ts#bindDashboardChartsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/dashboard.ts#getDashboardChartsOperation:variable",
			invokerNode:
				"packages/operations/src/dashboard.ts#invokeGetDashboardChartsOperation:function",
			executorNode:
				"packages/operations/src/dashboard.ts#readDashboardCharts:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindDashboardCountsOperationSpec(): typeof dashboardCountsOperationSpec {
	return dashboardCountsOperationSpec;
}

export function bindDashboardChartsOperationSpec(): typeof dashboardChartsOperationSpec {
	return dashboardChartsOperationSpec;
}
