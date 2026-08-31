import {
	bounceCollectionOutputContract,
	bounceIdInputContract,
	bounceListInputContract,
	bounceRecordContract,
} from "../contract-schemas";
import { defineOperationSpec } from "../operation";

/**
 * Bounce reads are open-world observations: the normalized envelope is
 * stable, but bounce availability, sources, and campaign attribution
 * reflect Listmonk's delivery-side state rather than guarantees.
 */
export const bouncesListOperationSpec = defineOperationSpec({
	id: "bounces.list",
	resource: "bounce",
	verb: "list",
	title: "List bounces",
	description:
		"Get recorded bounce events from Listmonk with optional campaign, source, and ordering filters",
	contract: {
		input: bounceListInputContract,
		output: bounceCollectionOutputContract,
	},
	effects: [{ kind: "read", resource: "bounce" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current bounce collection.",
	},
	agent: {
		useWhen: [
			"Bounce records must be discovered, filtered by campaign or source, or audited before cleanup.",
		],
		avoidWhen: ["A specific bounce record is already known by ID."],
		prerequisites: [],
		verifyWith: [],
		related: ["bounces.get"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_bounces",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bouncesListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bindBouncesListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/bounces.ts#listBouncesOperation:variable",
			invokerNode:
				"packages/operations/src/bounces.ts#invokeListBouncesOperation:function",
			executorNode: "packages/operations/src/bounces.ts#listBounces:function",
		},
	},
	stability: "experimental",
	since: "0.16.0",
});

export const bouncesGetOperationSpec = defineOperationSpec({
	id: "bounces.get",
	resource: "bounce",
	verb: "get",
	title: "Get bounce",
	description: "Get a recorded bounce event by its numeric ID",
	contract: {
		input: bounceIdInputContract,
		output: bounceRecordContract,
	},
	effects: [{ kind: "read", resource: "bounce" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current bounce representation.",
	},
	agent: {
		useWhen: [
			"A single bounce record must be inspected by its numeric ID, including its subscriber attribution and diagnostic metadata.",
		],
		avoidWhen: ["The bounce ID is not known and discovery is required."],
		prerequisites: [],
		verifyWith: [],
		related: ["bounces.list"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_bounce",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bouncesGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bindBouncesGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/bounces.ts#getBounceOperation:variable",
			invokerNode:
				"packages/operations/src/bounces.ts#invokeGetBounceOperation:function",
			executorNode: "packages/operations/src/bounces.ts#getBounce:function",
		},
	},
	stability: "experimental",
	since: "0.16.0",
});

export function bindBouncesListOperationSpec(): typeof bouncesListOperationSpec {
	return bouncesListOperationSpec;
}

export function bindBouncesGetOperationSpec(): typeof bouncesGetOperationSpec {
	return bouncesGetOperationSpec;
}
