import {
	bounceCollectionOutputContract,
	bounceDeleteOutputContract,
	bounceIdInputContract,
	bounceListInputContract,
	bouncePruneInputContract,
	bouncePruneOutputContract,
	bounceRecordContract,
	subscriberBouncesGetInputContract,
	subscriberBouncesCollectionOutputContract,
	subscriberBouncesDeleteInputContract,
	subscriberBouncesDeleteOutputContract,
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
	stability: "stable",
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
	stability: "stable",
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
	stability: "stable",
	since: "0.16.0",
});

export function bindBouncesDeleteOperationSpec(): typeof bouncesDeleteOperationSpec {
	return bouncesDeleteOperationSpec;
}

/**
 * Listmonk's bulk bounce delete rejects any request naming a missing id
 * with `400 Invalid ID(s)` and deletes nothing, so an echoed retry through
 * that endpoint diverges. The prune operation therefore issues the
 * destructive run as per-id deletes — each one a documented no-op
 * acknowledgement for an already-deleted id — bounded at 100 ids per run.
 */
export const bouncesPruneOperationSpec = defineOperationSpec({
	id: "bounces.prune",
	resource: "bounce",
	verb: "prune",
	title: "Prune bounce records",
	description:
		"Preview or delete a bounded selection of bounce records. Destructive runs echo the exact bounce ids a dry run reported, so a retry deletes nothing new.",
	contract: {
		input: bouncePruneInputContract,
		output: bouncePruneOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "bounce",
			action: "prune",
			destructive: true,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"A destructive run deletes exactly the echoed bounce ids through per-id requests whose missing-id acknowledgement is the same success, so repeating the identical echoed request is a documented no-op. Dry runs only preview the selection window.",
	},
	agent: {
		useWhen: [
			"Bounce history must be cleaned up after review, one bounded previewed batch at a time.",
		],
		avoidWhen: [
			"Bounce records are still needed for deliverability forensics or an audit trail.",
		],
		prerequisites: ["bounces.list"],
		verifyWith: ["bounces.list"],
		related: ["bounces.list", "bounces.delete"],
		retryGuidance:
			"Run dry_run first, then echo the reported bounce_ids with dry_run false; repeating that exact request deletes nothing new. Acknowledgements are not existence proofs — verify the surviving set with bounces.list.",
	},
	projection: {
		mcpName: "listmonk_prune_bounces",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bouncesPruneOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bindBouncesPruneOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/bounces.ts#pruneBouncesOperation:variable",
			invokerNode:
				"packages/operations/src/bounces.ts#invokePruneBouncesOperation:function",
			executorNode: "packages/operations/src/bounces.ts#pruneBounces:function",
		},
	},
	stability: "stable",
	since: "0.16.0",
});

export function bindBouncesPruneOperationSpec(): typeof bouncesPruneOperationSpec {
	return bouncesPruneOperationSpec;
}

/**
 * The observed endpoint answers an unknown subscriber with an empty
 * collection rather than an error, so the read reports the observed set
 * and cannot prove subscriber existence.
 */
export const subscribersBouncesGetOperationSpec = defineOperationSpec({
	id: "subscribers.bounces.get",
	resource: "bounce",
	verb: "get",
	title: "Get subscriber bounces",
	description:
		"List the bounce records Listmonk attributes to one subscriber. An unknown subscriber answers with an empty collection, not an error.",
	contract: {
		input: subscriberBouncesGetInputContract,
		output: subscriberBouncesCollectionOutputContract,
	},
	effects: [{ kind: "read", resource: "bounce" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the subscriber's bounce history.",
	},
	agent: {
		useWhen: [
			"A subscriber's full bounce history must be reviewed before cleanup or deliverability triage.",
		],
		avoidWhen: ["Bounce discovery across subscribers is required."],
		prerequisites: [],
		verifyWith: [],
		related: ["subscribers.get", "bounces.list"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_subscriber_bounces",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#subscribersBouncesGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bindSubscribersBouncesGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/bounces.ts#getSubscriberBouncesOperation:variable",
			invokerNode:
				"packages/operations/src/bounces.ts#invokeGetSubscriberBouncesOperation:function",
			executorNode:
				"packages/operations/src/bounces.ts#getSubscriberBounces:function",
		},
	},
	stability: "stable",
	since: "0.18.0",
});

export function bindSubscribersBouncesGetOperationSpec(): typeof subscribersBouncesGetOperationSpec {
	return subscribersBouncesGetOperationSpec;
}

/**
 * Listmonk acknowledges the deletion of a subscriber's entire bounce
 * history with a bare boolean and answers an unknown subscriber the same
 * way, so the acknowledgement proves acceptance, not that any record
 * existed; verify with subscribers.bounces.get.
 */
export const subscribersBouncesDeleteOperationSpec = defineOperationSpec({
	id: "subscribers.bounces.delete",
	resource: "bounce",
	verb: "delete",
	title: "Delete subscriber bounces",
	description:
		"Delete every bounce record attributed to one subscriber in a single confirmed request.",
	contract: {
		input: subscriberBouncesDeleteInputContract,
		output: subscriberBouncesDeleteOutputContract,
	},
	effects: [
		{ kind: "delete", resource: "bounce", reversible: false },
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "subscribers.bounces.get",
		idempotent: true,
		reason:
			"Deleting an already-empty bounce history is a no-op acknowledgement; verify the surviving set with subscribers.bounces.get after an ambiguous result.",
	},
	agent: {
		useWhen: [
			"A subscriber's bounce history must be cleared, typically before a redelivery attempt.",
		],
		avoidWhen: [
			"The bounce history is still needed for deliverability forensics or an audit trail.",
		],
		prerequisites: ["subscribers.bounces.get"],
		verifyWith: ["subscribers.bounces.get"],
		related: ["subscribers.bounces.get", "bounces.delete", "bounces.prune"],
		retryGuidance:
			"Verify the history is empty with subscribers.bounces.get before repeating; the acknowledgement is not an existence proof.",
	},
	projection: {
		mcpName: "listmonk_delete_subscriber_bounces",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#subscribersBouncesDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/bounces-specs.ts#bindSubscribersBouncesDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/bounces.ts#deleteSubscriberBouncesOperation:variable",
			invokerNode:
				"packages/operations/src/bounces.ts#invokeDeleteSubscriberBouncesOperation:function",
			executorNode:
				"packages/operations/src/bounces.ts#deleteSubscriberBounces:function",
		},
	},
	stability: "stable",
	since: "0.18.0",
});

export function bindSubscribersBouncesDeleteOperationSpec(): typeof subscribersBouncesDeleteOperationSpec {
	return subscribersBouncesDeleteOperationSpec;
}
