import {
	bounceCollectionOutputContract,
	bounceDeleteOutputContract,
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

/**
 * Listmonk acknowledges a single-bounce delete with a bare boolean and
 * answers a missing ID with the same success, so a retry after an
 * ambiguous result is a documented no-op rather than a hazard. The
 * acknowledgement proves the request was accepted, not that a record
 * existed; verify the surviving set with bounces.list.
 */
export const bouncesDeleteOperationSpec = defineOperationSpec({
	id: "bounces.delete",
	resource: "bounce",
	verb: "delete",
	title: "Delete bounce",
	description: "Delete a recorded bounce event by its numeric ID",
	contract: {
		input: bounceIdInputContract,
		output: bounceDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "bounce", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "bounces.list",
		idempotent: true,
		reason:
			"Deleting an already-deleted bounce is a no-op acknowledgement; verify the surviving set with bounces.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["A bounce record must be removed from Listmonk's history."],
		avoidWhen: [
			"The record is still needed for deliverability forensics or an audit trail.",
		],
		prerequisites: ["bounces.get"],
		verifyWith: ["bounces.list"],
		related: ["bounces.get", "bounces.list"],
		retryGuidance:
			"Verify the record is gone with bounces.list before repeating; Listmonk acknowledges an already-deleted ID with success.",
	},
	projection: {
		mcpName: "listmonk_delete_bounce",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bouncesDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bindBouncesDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/bounces.ts#deleteBounceOperation:variable",
			invokerNode:
				"packages/operations/src/bounces.ts#invokeDeleteBounceOperation:function",
			executorNode: "packages/operations/src/bounces.ts#deleteBounce:function",
		},
	},
	stability: "experimental",
	since: "0.16.0",
});

export function bindBouncesDeleteOperationSpec(): typeof bouncesDeleteOperationSpec {
	return bouncesDeleteOperationSpec;
}
