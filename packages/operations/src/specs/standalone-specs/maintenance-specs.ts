import {
	maintenanceGcSubscribersInputContract,
	maintenanceGcSubscribersOutputContract,
	maintenanceGcUnconfirmedInputContract,
	maintenanceGcUnconfirmedOutputContract,
	maintenanceGcAnalyticsInputContract,
	maintenanceGcAnalyticsOutputContract,
} from "../contract-schemas";
import { defineOperationSpec } from "../operation";

/**
 * The server offers no preview for either collection: one request
 * deletes the full matching set. The shared operations gate on explicit
 * confirmation and document the no-preview boundary honestly instead of
 * inventing a simulation.
 */
export const maintenanceGcSubscribersOperationSpec = defineOperationSpec({
	id: "maintenance.gc-subscribers",
	resource: "maintenance",
	verb: "gc-subscribers",
	title: "Garbage-collect subscribers",
	description:
		"One-shot deletion of every orphaned (listless) or blocklisted subscriber. The server offers no preview; one confirmed request deletes the full matching set.",
	contract: {
		input: maintenanceGcSubscribersInputContract,
		output: maintenanceGcSubscribersOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "subscriber",
			action: "prune",
			destructive: true,
			preview: false,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "subscribers.list",
		idempotent: true,
		reason:
			"The first successful run empties the matching set, so a repeated identical request reports count 0; subscribers that newly match between runs are a different set, so verify with subscribers.list after an ambiguous result.",
	},
	agent: {
		useWhen: [
			"An operator has explicitly approved deleting every orphaned or blocklisted subscriber in one batch.",
		],
		avoidWhen: [
			"Any subscriber in the set might still be wanted — the server offers no preview, so review subscribers.list first.",
		],
		prerequisites: ["subscribers.list"],
		verifyWith: ["subscribers.list"],
		related: ["subscribers.list", "ops.subscribers.hygiene"],
		retryGuidance:
			"Verify with subscribers.list before repeating; a repeat reports count 0 when the first run completed.",
	},
	projection: {
		mcpName: "listmonk_gc_subscribers",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/maintenance-specs.ts#maintenanceGcSubscribersOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/maintenance-specs.ts#bindMaintenanceGcSubscribersOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/maintenance.ts#gcSubscribersOperation:variable",
			invokerNode:
				"packages/operations/src/maintenance.ts#invokeGcSubscribersOperation:function",
			executorNode:
				"packages/operations/src/maintenance.ts#gcSubscribers:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export const maintenanceGcUnconfirmedOperationSpec = defineOperationSpec({
	id: "maintenance.gc-unconfirmed",
	resource: "maintenance",
	verb: "gc-unconfirmed",
	title: "Garbage-collect unconfirmed subscriptions",
	description:
		"One-shot deletion of every subscription still unconfirmed before an RFC3339 cutoff. The server offers no preview; one confirmed request deletes the full matching set.",
	contract: {
		input: maintenanceGcUnconfirmedInputContract,
		output: maintenanceGcUnconfirmedOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "subscriber",
			action: "prune",
			destructive: true,
			preview: false,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "subscribers.list",
		idempotent: true,
		reason:
			"The first successful run empties the matching set for the echoed cutoff, so a repeated identical request reports count 0; verify with subscribers.list after an ambiguous result.",
	},
	agent: {
		useWhen: [
			"An operator has explicitly approved deleting every subscription unconfirmed before the cutoff.",
		],
		avoidWhen: [
			"Double opt-in campaigns may legitimately have pending confirmations — choose the cutoff with that window in mind.",
		],
		prerequisites: ["subscribers.list"],
		verifyWith: ["subscribers.list"],
		related: ["maintenance.gc-subscribers", "subscribers.list"],
		retryGuidance:
			"Verify with subscribers.list before repeating; a repeat reports count 0 when the first run completed.",
	},
	projection: {
		mcpName: "listmonk_gc_unconfirmed_subscriptions",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/maintenance-specs.ts#maintenanceGcUnconfirmedOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/maintenance-specs.ts#bindMaintenanceGcUnconfirmedOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/maintenance.ts#gcUnconfirmedOperation:variable",
			invokerNode:
				"packages/operations/src/maintenance.ts#invokeGcUnconfirmedOperation:function",
			executorNode:
				"packages/operations/src/maintenance.ts#gcUnconfirmedSubscriptions:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindMaintenanceGcSubscribersOperationSpec(): typeof maintenanceGcSubscribersOperationSpec {
	return maintenanceGcSubscribersOperationSpec;
}

export function bindMaintenanceGcUnconfirmedOperationSpec(): typeof maintenanceGcUnconfirmedOperationSpec {
	return maintenanceGcUnconfirmedOperationSpec;
}

/**
 * Like the other maintenance collections, the analytics GC offers no
 * preview: one confirmed request deletes every view and/or link-click
 * row recorded before the RFC3339 cutoff, across all campaigns, and the
 * server acknowledges with a bare boolean instead of a count.
 */
export const maintenanceGcAnalyticsOperationSpec = defineOperationSpec({
	id: "maintenance.gc-analytics",
	resource: "maintenance",
	verb: "gc-analytics",
	title: "Garbage-collect campaign analytics",
	description:
		"One-shot deletion of campaign analytics (views and/or link clicks) recorded before an RFC3339 cutoff, across every campaign. The server offers no preview and reports no count.",
	contract: {
		input: maintenanceGcAnalyticsInputContract,
		output: maintenanceGcAnalyticsOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "campaign",
			action: "prune",
			destructive: true,
			preview: false,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "campaigns.analytics",
		idempotent: true,
		reason:
			"The first successful run empties the matching set for the echoed cutoff, so a repeated identical request deletes nothing new; verify with campaigns.analytics after an ambiguous result.",
	},
	agent: {
		useWhen: [
			"An operator has explicitly approved deleting analytics older than the cutoff to reclaim database space.",
		],
		avoidWhen: [
			"Analytics reporting for the window is still needed — the deletion is irreversible and crosses every campaign.",
		],
		prerequisites: ["campaigns.analytics"],
		verifyWith: ["campaigns.analytics"],
		related: ["campaigns.analytics", "maintenance.gc-subscribers"],
		retryGuidance:
			"Verify with campaigns.analytics before repeating; the server reports only a boolean acknowledgement.",
	},
	projection: {
		mcpName: "listmonk_gc_analytics",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/maintenance-specs.ts#maintenanceGcAnalyticsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/maintenance-specs.ts#bindMaintenanceGcAnalyticsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/maintenance.ts#gcAnalyticsOperation:variable",
			invokerNode:
				"packages/operations/src/maintenance.ts#invokeGcAnalyticsOperation:function",
			executorNode:
				"packages/operations/src/maintenance.ts#gcAnalytics:function",
		},
	},
	stability: "stable",
	since: "0.18.0",
});

export function bindMaintenanceGcAnalyticsOperationSpec(): typeof maintenanceGcAnalyticsOperationSpec {
	return maintenanceGcAnalyticsOperationSpec;
}
