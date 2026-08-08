import { defineOperationSpec } from "../operation";
import {
	listCreateInputContract,
	listUpdateInputContract,
	listDeleteInputContract,
	listDeleteOutputContract,
	subscriberListRecordContract,
} from "../contract-schemas";

export const listsCreateOperationSpec = defineOperationSpec({
	id: "lists.create",
	resource: "list",
	verb: "create",
	title: "Create subscriber list",
	description: "Create a new subscriber list",
	contract: {
		input: listCreateInputContract,
		output: subscriberListRecordContract,
	},
	effects: [{ kind: "write", resource: "list", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A retry may create another list unless the original ID is known.",
	},
	agent: {
		useWhen: ["A new subscriber list must be created."],
		avoidWhen: ["An existing list should be updated instead."],
		prerequisites: [],
		verifyWith: ["lists.list"],
		related: ["lists.update", "lists.delete"],
		retryGuidance: "Inspect lists.list before retrying an ambiguous create.",
	},
	projection: {
		mcpName: "listmonk_create_list",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/list-specs.ts#listsCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/list-specs.ts#bindListsCreateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/lists.ts#createListOperation:variable",
			invokerNode:
				"packages/operations/src/lists.ts#invokeCreateListOperation:function",
			executorNode:
				"packages/operations/src/lists.ts#createSubscriberList:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const listsUpdateOperationSpec = defineOperationSpec({
	id: "lists.update",
	resource: "list",
	verb: "update",
	title: "Update subscriber list",
	description: "Update an existing subscriber list",
	contract: {
		input: listUpdateInputContract,
		output: subscriberListRecordContract,
	},
	effects: [{ kind: "write", resource: "list", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same requested list fields converges on the same representation.",
	},
	agent: {
		useWhen: ["A known subscriber list must be updated by numeric ID."],
		avoidWhen: ["The list ID is unknown."],
		prerequisites: ["lists.get"],
		verifyWith: ["lists.get"],
		related: ["lists.delete"],
		retryGuidance:
			"Retry identical transient failures with bounded backoff, then verify with lists.get.",
	},
	projection: {
		mcpName: "listmonk_update_list",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/list-specs.ts#listsUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/list-specs.ts#bindListsUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/lists.ts#updateListOperation:variable",
			invokerNode:
				"packages/operations/src/lists.ts#invokeUpdateListOperation:function",
			executorNode:
				"packages/operations/src/lists.ts#updateSubscriberList:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const listsDeleteOperationSpec = defineOperationSpec({
	id: "lists.delete",
	resource: "list",
	verb: "delete",
	title: "Delete subscriber list",
	description: "Delete a subscriber list",
	contract: {
		input: listDeleteInputContract,
		output: listDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "list", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "lists.list",
		idempotent: true,
		reason:
			"Deleting an already-deleted list is a no-op; verify with lists.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["A subscriber list must be permanently removed."],
		avoidWhen: ["The list still has active subscribers or campaigns."],
		prerequisites: ["lists.get"],
		verifyWith: ["lists.list"],
		related: ["lists.update"],
		retryGuidance: "Verify the list is gone with lists.list before retrying.",
	},
	projection: {
		mcpName: "listmonk_delete_list",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/list-specs.ts#listsDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/list-specs.ts#bindListsDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/lists.ts#deleteListOperation:variable",
			invokerNode:
				"packages/operations/src/lists.ts#invokeDeleteListOperation:function",
			executorNode:
				"packages/operations/src/lists.ts#deleteSubscriberList:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export function bindListsCreateOperationSpec(): typeof listsCreateOperationSpec {
	return listsCreateOperationSpec;
}

export function bindListsUpdateOperationSpec(): typeof listsUpdateOperationSpec {
	return listsUpdateOperationSpec;
}

export function bindListsDeleteOperationSpec(): typeof listsDeleteOperationSpec {
	return listsDeleteOperationSpec;
}
