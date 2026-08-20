import { defineOperationSpec } from "../operation";
import {
	subscriberCreateInputContract,
	subscriberCreateOutputContract,
	subscriberUpdateInputContract,
	subscriberDeleteInputContract,
	subscriberDeleteOutputContract,
	subscriberRecordContract,
	subscriberBulkListsInputContract,
	subscriberBulkBlocklistInputContract,
	subscriberBulkOutputContract,
} from "../contract-schemas";

export const subscribersCreateOperationSpec = defineOperationSpec({
	id: "subscribers.create",
	resource: "subscriber",
	verb: "create",
	title: "Create subscriber",
	description: "Create a subscriber in Listmonk",
	contract: {
		input: subscriberCreateInputContract,
		output: subscriberCreateOutputContract,
	},
	effects: [{ kind: "write", resource: "subscriber", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "subscribers.list",
		idempotent: true,
		reason:
			"Subscriber emails are unique, so a retry after an ambiguous create is rejected as already existing and replays the persisted subscriber when it matches the requested identity, reporting created: false; a conflicting configuration under the same email stays an explicit error.",
	},
	agent: {
		useWhen: ["A new subscriber must be created."],
		avoidWhen: ["An existing subscriber should be updated instead."],
		prerequisites: [],
		verifyWith: ["subscribers.list"],
		related: ["subscribers.update", "subscribers.delete"],
		retryGuidance:
			"Verify the subscriber with subscribers.list before repeating an ambiguous create; an identical retry replays it with created: false.",
	},
	projection: {
		mcpName: "listmonk_create_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersCreateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#createSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeCreateSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#createSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersUpdateOperationSpec = defineOperationSpec({
	id: "subscribers.update",
	resource: "subscriber",
	verb: "update",
	title: "Update subscriber",
	description: "Update a subscriber in Listmonk",
	contract: {
		input: subscriberUpdateInputContract,
		output: subscriberRecordContract,
	},
	effects: [{ kind: "write", resource: "subscriber", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same requested subscriber fields converges on the same representation.",
	},
	agent: {
		useWhen: ["A known subscriber must be updated by numeric ID."],
		avoidWhen: ["The subscriber ID is unknown."],
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.delete"],
		retryGuidance:
			"Retry identical transient failures with bounded backoff, then verify with subscribers.get.",
	},
	projection: {
		mcpName: "listmonk_update_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#updateSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeUpdateSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#updateSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersDeleteOperationSpec = defineOperationSpec({
	id: "subscribers.delete",
	resource: "subscriber",
	verb: "delete",
	title: "Delete subscriber",
	description: "Delete a subscriber from Listmonk",
	contract: {
		input: subscriberDeleteInputContract,
		output: subscriberDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "subscriber", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "subscribers.list",
		idempotent: true,
		reason:
			"Deleting an already-deleted subscriber is a no-op; verify with subscribers.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["A subscriber must be permanently removed."],
		avoidWhen: ["The subscriber should be blocklisted instead."],
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.list"],
		related: ["subscribers.update"],
		retryGuidance:
			"Verify the subscriber is gone with subscribers.list before retrying.",
	},
	projection: {
		mcpName: "listmonk_delete_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#deleteSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeDeleteSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#deleteSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersAddToListsOperationSpec = defineOperationSpec({
	id: "subscribers.add-to-lists",
	resource: "subscriber",
	verb: "add-to-lists",
	title: "Add subscribers to lists",
	description:
		"Add a batch of subscribers to one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
	contract: {
		input: subscriberBulkListsInputContract,
		output: subscriberBulkOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "subscriber",
			reversible: true,
			preview: true,
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same add-to-lists action converges on the same membership state.",
	},
	agent: {
		useWhen: ["Subscribers must be added to one or more lists in bulk."],
		avoidWhen: ["The subscribers or lists are not known."],
		prerequisites: ["subscribers.get", "lists.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.remove-from-lists"],
		retryGuidance: "Retry identical transient failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_add_subscribers_to_lists",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersAddToListsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersAddToListsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#addSubscribersToListsOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeAddSubscribersToListsOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#addSubscribersToLists:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersRemoveFromListsOperationSpec = defineOperationSpec({
	id: "subscribers.remove-from-lists",
	resource: "subscriber",
	verb: "remove-from-lists",
	title: "Remove subscribers from lists",
	description:
		"Remove a batch of subscribers from one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because re-adding subscribers does not guarantee their previous per-list subscription state is reconstructed.",
	contract: {
		input: subscriberBulkListsInputContract,
		output: subscriberBulkOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "subscriber",
			reversible: false,
			preview: true,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same remove-from-lists action converges on the same membership state.",
	},
	agent: {
		useWhen: ["Subscribers must be removed from one or more lists in bulk."],
		avoidWhen: ["The subscribers or lists are not known."],
		prerequisites: ["subscribers.get", "lists.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.add-to-lists"],
		retryGuidance: "Retry identical transient failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_remove_subscribers_from_lists",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersRemoveFromListsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersRemoveFromListsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#removeSubscribersFromListsOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeRemoveSubscribersFromListsOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#removeSubscribersFromLists:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersUnblocklistOperationSpec = defineOperationSpec({
	id: "subscribers.unblocklist",
	resource: "subscriber",
	verb: "unblocklist",
	title: "Unblocklist subscribers",
	description:
		"Remove a batch of subscribers from the blocklist. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
	contract: {
		input: subscriberBulkBlocklistInputContract,
		output: subscriberBulkOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "subscriber",
			reversible: true,
			preview: true,
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same unblocklist action converges on the same state.",
	},
	agent: {
		useWhen: ["Subscribers must be removed from the blocklist in bulk."],
		avoidWhen: ["The subscriber IDs are not known."],
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.blocklist"],
		retryGuidance: "Retry identical transient failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_unblocklist_subscribers",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#subscribersUnblocklistOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/subscriber-specs.ts#bindSubscribersUnblocklistOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#unblocklistSubscribersOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeUnblocklistSubscribersOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#unblocklistSubscribers:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export function bindSubscribersCreateOperationSpec(): typeof subscribersCreateOperationSpec {
	return subscribersCreateOperationSpec;
}

export function bindSubscribersUpdateOperationSpec(): typeof subscribersUpdateOperationSpec {
	return subscribersUpdateOperationSpec;
}

export function bindSubscribersDeleteOperationSpec(): typeof subscribersDeleteOperationSpec {
	return subscribersDeleteOperationSpec;
}

export function bindSubscribersAddToListsOperationSpec(): typeof subscribersAddToListsOperationSpec {
	return subscribersAddToListsOperationSpec;
}

export function bindSubscribersRemoveFromListsOperationSpec(): typeof subscribersRemoveFromListsOperationSpec {
	return subscribersRemoveFromListsOperationSpec;
}

export function bindSubscribersUnblocklistOperationSpec(): typeof subscribersUnblocklistOperationSpec {
	return subscribersUnblocklistOperationSpec;
}
