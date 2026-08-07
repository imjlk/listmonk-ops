import {
	campaignCollectionOutputContract,
	campaignCloneInputContract,
	campaignCreateInputContract,
	campaignDeleteInputContract,
	campaignDeleteOutputContract,
	campaignGetOutputContract,
	campaignLifecycleInputContract,
	campaignLifecycleOutputContract,
	campaignListInputContract,
	campaignStatsOutputContract,
	campaignUpdateInputContract,
	dailyDigestInputContract,
	deliverabilityGuardInputContract,
	deliverabilityGuardOutputContract,
	subscriberHygieneInputContract,
	subscriberHygieneOutputContract,
	templateRegistrySyncInputContract,
	templateRegistrySyncOutputContract,
	templateRegistryHistoryOutputContract,
	templateIdInputContract,
	templatePromoteInputContract,
	templatePromoteOutputContract,
	dailyDigestOutputContract,
	segmentDriftInputContract,
	segmentDriftOutputContract,
	listCreateInputContract,
	listDeleteInputContract,
	listDeleteOutputContract,
	listUpdateInputContract,
	mediaCollectionOutputContract,
	mediaDeleteInputContract,
	mediaDeleteOutputContract,
	mediaRecordContract,
	mediaUploadInputContract,
	paginationInputContract,
	resourceIdInputContract,
	subscriberCollectionOutputContract,
	subscriberCreateInputContract,
	subscriberDeleteInputContract,
	subscriberDeleteOutputContract,
	subscriberListCollectionOutputContract,
	subscriberListInputContract,
	subscriberListRecordContract,
	subscriberRecordContract,
	subscriberBulkBlocklistInputContract,
	subscriberBulkListsInputContract,
	subscriberBulkOutputContract,
	subscriberUpdateInputContract,
	templateCollectionOutputContract,
	templateCreateInputContract,
	templateDeleteOutputContract,
	templateListInputContract,
	templateManifestReconcileInputContract,
	templateManifestReconcileOutputContract,
	templateRecordContract,
	templateSetDefaultOutputContract,
	templateUpdateInputContract,
} from "./contract-schemas";
import { defineOperationSpec } from "./operation";

export const listsListOperationSpec = defineOperationSpec({
	id: "lists.list",
	resource: "list",
	verb: "list",
	title: "List subscriber lists",
	description: "Get subscriber lists from Listmonk",
	contract: {
		input: paginationInputContract,
		output: subscriberListCollectionOutputContract,
	},
	effects: [{ kind: "read", resource: "list" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current subscriber-list collection.",
	},
	agent: {
		useWhen: ["Subscriber lists must be discovered or enumerated."],
		avoidWhen: ["A specific subscriber list is already known by ID."],
		prerequisites: [],
		verifyWith: [],
		related: ["lists.get"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_lists",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#listsListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindListsListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/lists.ts#getListsOperation:variable",
			invokerNode:
				"packages/operations/src/lists.ts#invokeGetListsOperation:function",
			executorNode:
				"packages/operations/src/lists.ts#listSubscriberLists:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const listsGetOperationSpec = defineOperationSpec({
	id: "lists.get",
	resource: "list",
	verb: "get",
	title: "Get subscriber list",
	description: "Get a specific subscriber list by ID",
	contract: {
		input: resourceIdInputContract,
		output: subscriberListRecordContract,
	},
	effects: [{ kind: "read", resource: "list" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current subscriber-list representation.",
	},
	agent: {
		useWhen: ["A subscriber list must be inspected by its numeric ID."],
		avoidWhen: ["The subscriber-list ID is not known and discovery is required."],
		prerequisites: [],
		verifyWith: [],
		related: ["lists.list", "lists.update", "lists.delete"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_list",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#listsGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindListsGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/lists.ts#getListOperation:variable",
			invokerNode:
				"packages/operations/src/lists.ts#invokeGetListOperation:function",
			executorNode:
				"packages/operations/src/lists.ts#getSubscriberList:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

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
				"packages/operations/src/specs/core-reads.ts#listsCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindListsCreateOperationSpec:function",
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
				"packages/operations/src/specs/core-reads.ts#listsUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindListsUpdateOperationSpec:function",
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
				"packages/operations/src/specs/core-reads.ts#listsDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindListsDeleteOperationSpec:function",
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

export const subscribersListOperationSpec = defineOperationSpec({
	id: "subscribers.list",
	resource: "subscriber",
	verb: "list",
	title: "List subscribers",
	description: "Get subscribers from Listmonk",
	contract: {
		input: subscriberListInputContract,
		output: subscriberCollectionOutputContract,
	},
	effects: [{ kind: "read", resource: "subscriber" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads a filtered subscriber collection.",
	},
	agent: {
		useWhen: ["Subscribers must be searched, filtered, or enumerated."],
		avoidWhen: ["A specific subscriber is already known by ID."],
		prerequisites: [],
		verifyWith: [],
		related: ["subscribers.get"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_subscribers",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#subscribersListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#getSubscribersOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeGetSubscribersOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#listSubscribers:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersGetOperationSpec = defineOperationSpec({
	id: "subscribers.get",
	resource: "subscriber",
	verb: "get",
	title: "Get subscriber",
	description: "Get a subscriber by ID",
	contract: {
		input: resourceIdInputContract,
		output: subscriberRecordContract,
	},
	effects: [{ kind: "read", resource: "subscriber" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current subscriber representation.",
	},
	agent: {
		useWhen: ["A subscriber must be inspected by its numeric ID."],
		avoidWhen: ["The subscriber ID is not known and discovery is required."],
		prerequisites: [],
		verifyWith: [],
		related: [
			"subscribers.update",
			"subscribers.blocklist",
			"subscribers.unblocklist",
		],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#subscribersGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#getSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeGetSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#getSubscriber:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const subscribersCreateOperationSpec = defineOperationSpec({
	id: "subscribers.create",
	resource: "subscriber",
	verb: "create",
	title: "Create subscriber",
	description: "Create a subscriber in Listmonk",
	contract: {
		input: subscriberCreateInputContract,
		output: subscriberRecordContract,
	},
	effects: [{ kind: "write", resource: "subscriber", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A retry may create another subscriber unless the original email or ID is known.",
	},
	agent: {
		useWhen: ["A new subscriber must be created."],
		avoidWhen: ["An existing subscriber should be updated instead."],
		prerequisites: [],
		verifyWith: ["subscribers.list"],
		related: ["subscribers.update", "subscribers.delete"],
		retryGuidance:
			"Inspect subscribers.list before retrying an ambiguous create.",
	},
	projection: {
		mcpName: "listmonk_create_subscriber",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#subscribersCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersCreateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#createSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeCreateSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#createSubscriber:function",
		},
	},
	stability: "experimental",
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
				"packages/operations/src/specs/core-reads.ts#subscribersUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#updateSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeUpdateSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#updateSubscriber:function",
		},
	},
	stability: "experimental",
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
				"packages/operations/src/specs/core-reads.ts#subscribersDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#deleteSubscriberOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeDeleteSubscriberOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#deleteSubscriber:function",
		},
	},
	stability: "experimental",
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
				"packages/operations/src/specs/core-reads.ts#subscribersAddToListsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersAddToListsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#addSubscribersToListsOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeAddSubscribersToListsOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#addSubscribersToLists:function",
		},
	},
	stability: "experimental",
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
				"packages/operations/src/specs/core-reads.ts#subscribersRemoveFromListsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersRemoveFromListsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#removeSubscribersFromListsOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeRemoveSubscribersFromListsOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#removeSubscribersFromLists:function",
		},
	},
	stability: "experimental",
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
				"packages/operations/src/specs/core-reads.ts#subscribersUnblocklistOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindSubscribersUnblocklistOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#unblocklistSubscribersOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeUnblocklistSubscribersOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#unblocklistSubscribers:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const campaignsListOperationSpec = defineOperationSpec({
	id: "campaigns.list",
	resource: "campaign",
	verb: "list",
	title: "List campaigns",
	description: "Get campaigns from Listmonk",
	contract: {
		input: campaignListInputContract,
		output: campaignCollectionOutputContract,
	},
	effects: [{ kind: "read", resource: "campaign" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads a filtered campaign collection.",
	},
	agent: {
		useWhen: ["Campaigns must be searched, filtered, or enumerated."],
		avoidWhen: ["A specific campaign is already known by ID."],
		prerequisites: [],
		verifyWith: [],
		related: ["campaigns.get", "campaigns.stats"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_campaigns",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#campaignsListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindCampaignsListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#getCampaignsOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeGetCampaignsOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#listCampaigns:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const campaignsStatsOperationSpec = defineOperationSpec({
	id: "campaigns.stats",
	resource: "campaign",
	verb: "stats",
	title: "Get campaign stats",
	description:
		"Read delivery stats (views, clicks, bounces, to_send, sent, started_at) for a campaign from Listmonk.",
	contract: {
		input: resourceIdInputContract,
		output: campaignStatsOutputContract,
	},
	effects: [{ kind: "read", resource: "campaign" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current campaign statistics.",
	},
	agent: {
		useWhen: ["Delivery statistics for a campaign must be inspected."],
		avoidWhen: ["The full campaign representation or collection is required."],
		prerequisites: ["campaigns.get"],
		verifyWith: [],
		related: ["ops.campaign.deliverability-guard"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_campaign_stats",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#campaignsStatsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindCampaignsStatsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#getCampaignStatsOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeGetCampaignStatsOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#getCampaignStats:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const campaignsCreateOperationSpec = defineOperationSpec({
	id: "campaigns.create",
	resource: "campaign",
	verb: "create",
	title: "Create campaign",
	description: "Create a campaign in Listmonk",
	contract: {
		input: campaignCreateInputContract,
		output: campaignGetOutputContract,
	},
	effects: [{ kind: "write", resource: "campaign", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A retry may create another campaign unless the original ID is known.",
	},
	agent: {
		useWhen: ["A new campaign must be created."],
		avoidWhen: ["An existing campaign should be cloned or updated instead."],
		prerequisites: [],
		verifyWith: ["campaigns.list"],
		related: ["campaigns.update", "campaigns.clone"],
		retryGuidance:
			"Inspect campaigns.list before retrying an ambiguous create.",
	},
	projection: {
		mcpName: "listmonk_create_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#campaignsCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindCampaignsCreateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#createCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeCreateCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#createCampaign:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const campaignsUpdateOperationSpec = defineOperationSpec({
	id: "campaigns.update",
	resource: "campaign",
	verb: "update",
	title: "Update campaign",
	description: "Update a campaign in Listmonk",
	contract: {
		input: campaignUpdateInputContract,
		output: campaignGetOutputContract,
	},
	effects: [{ kind: "write", resource: "campaign", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same requested campaign fields converges on the same representation.",
	},
	agent: {
		useWhen: ["A known campaign must be updated by numeric ID."],
		avoidWhen: ["The campaign ID is unknown."],
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.get"],
		related: ["campaigns.delete"],
		retryGuidance:
			"Retry identical transient failures with bounded backoff, then verify with campaigns.get.",
	},
	projection: {
		mcpName: "listmonk_update_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#campaignsUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindCampaignsUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#updateCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeUpdateCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#updateCampaign:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const campaignsDeleteOperationSpec = defineOperationSpec({
	id: "campaigns.delete",
	resource: "campaign",
	verb: "delete",
	title: "Delete campaign",
	description: "Delete a campaign from Listmonk",
	contract: {
		input: campaignDeleteInputContract,
		output: campaignDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "campaign", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "campaigns.list",
		idempotent: true,
		reason:
			"Deleting an already-deleted campaign is a no-op; verify with campaigns.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["A campaign must be permanently removed."],
		avoidWhen: ["The campaign is running or scheduled."],
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.list"],
		related: ["campaigns.update"],
		retryGuidance:
			"Verify the campaign is gone with campaigns.list before retrying.",
	},
	projection: {
		mcpName: "listmonk_delete_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#campaignsDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindCampaignsDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#deleteCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeDeleteCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#deleteCampaign:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const campaignsPauseOperationSpec = defineOperationSpec({
	id: "campaigns.pause",
	resource: "campaign",
	verb: "pause",
	title: "Pause campaign",
	description:
		"Transition a campaign into the paused status. Validates the current status allows the transition.",
	contract: {
		input: campaignLifecycleInputContract,
		output: campaignLifecycleOutputContract,
	},
	effects: [{ kind: "write", resource: "campaign", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same pause transition converges on the same paused state.",
	},
	state: {
		resource: "campaign",
		from: ["running"],
		to: "paused",
		allowNoopFromTarget: true,
	},
	agent: {
		useWhen: ["A running campaign must be paused."],
		avoidWhen: ["The campaign is already paused or in a terminal status."],
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.get"],
		related: ["campaigns.start", "campaigns.cancel"],
		retryGuidance:
			"Retry identical transient failures with bounded backoff, then verify with campaigns.get.",
	},
	projection: {
		mcpName: "listmonk_pause_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#campaignsPauseOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindCampaignsPauseOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#pauseCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokePauseCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#pauseCampaign:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const campaignsCloneOperationSpec = defineOperationSpec({
	id: "campaigns.clone",
	resource: "campaign",
	verb: "clone",
	title: "Clone campaign",
	description:
		"Create a new campaign by copying the body, lists, template, and metadata of an existing campaign under a new name. The clone starts in draft status.",
	contract: {
		input: campaignCloneInputContract,
		output: campaignGetOutputContract,
	},
	effects: [{ kind: "write", resource: "campaign", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A retry may create another cloned campaign unless the original clone ID is known.",
	},
	agent: {
		useWhen: ["A new campaign should reuse an existing campaign's content."],
		avoidWhen: ["A brand-new campaign should be created from scratch."],
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.list"],
		related: ["campaigns.create"],
		retryGuidance: "Inspect campaigns.list before retrying an ambiguous clone.",
	},
	projection: {
		mcpName: "listmonk_clone_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#campaignsCloneOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindCampaignsCloneOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#cloneCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeCloneCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#cloneCampaign:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const templatesListOperationSpec = defineOperationSpec({
	id: "templates.list",
	resource: "template",
	verb: "list",
	title: "List templates",
	description: "Get templates from Listmonk",
	contract: {
		input: templateListInputContract,
		output: templateCollectionOutputContract,
	},
	effects: [{ kind: "read", resource: "template" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current template collection.",
	},
	agent: {
		useWhen: ["Templates must be discovered or enumerated."],
		avoidWhen: ["A specific template is already known by ID."],
		prerequisites: [],
		verifyWith: [],
		related: ["templates.get", "ops.templates.registry-sync"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_templates",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#templatesListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindTemplatesListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#getTemplatesOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeGetTemplatesOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#listTemplates:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const templatesGetOperationSpec = defineOperationSpec({
	id: "templates.get",
	resource: "template",
	verb: "get",
	title: "Get template",
	description: "Get a template by ID",
	contract: {
		input: resourceIdInputContract,
		output: templateRecordContract,
	},
	effects: [{ kind: "read", resource: "template" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current template representation.",
	},
	agent: {
		useWhen: ["A template must be inspected by its numeric ID."],
		avoidWhen: ["The template ID is not known and discovery is required."],
		prerequisites: [],
		verifyWith: [],
		related: [
			"templates.update",
			"templates.set-default",
			"ops.templates.registry-history",
		],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_template",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#templatesGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindTemplatesGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#getTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeGetTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#getTemplate:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const templatesCreateOperationSpec = defineOperationSpec({
	id: "templates.create",
	resource: "template",
	verb: "create",
	title: "Create template",
	description: "Create a template in Listmonk",
	contract: {
		input: templateCreateInputContract,
		output: templateRecordContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: true }],
	policy: {
		confirmation: "never",
		audit: "required",
		dryRun: false,
	},
	retry: {
		kind: "unsafe",
		reason:
			"A transport failure can be ambiguous after Listmonk creates the template; inspect templates.list before retrying.",
	},
	agent: {
		useWhen: ["A new Listmonk template must be created."],
		avoidWhen: [
			"An existing template should be converged by exact name; use templates.reconcile instead.",
		],
		prerequisites: [],
		verifyWith: ["templates.list"],
		related: ["templates.reconcile"],
		retryGuidance:
			"Do not automatically retry an ambiguous failure; inspect templates.list for the intended name first.",
	},
	projection: {
		mcpName: "listmonk_create_template",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#templatesCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindTemplatesCreateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#createTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeCreateTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#createTemplate:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const templatesUpdateOperationSpec = defineOperationSpec({
	id: "templates.update",
	resource: "template",
	verb: "update",
	title: "Update template",
	description: "Update a template in Listmonk",
	contract: {
		input: templateUpdateInputContract,
		output: templateRecordContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: true }],
	policy: {
		confirmation: "never",
		audit: "required",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason:
			"Reapplying the same requested template fields converges on the same representation.",
	},
	agent: {
		useWhen: ["A known template must be updated by numeric ID."],
		avoidWhen: [
			"The template ID is unknown or a versioned exact-name manifest should be reconciled.",
		],
		prerequisites: ["templates.get"],
		verifyWith: ["templates.get"],
		related: ["templates.reconcile", "ops.templates.registry-sync"],
		retryGuidance:
			"Retry identical transient failures with bounded backoff, then verify with templates.get.",
	},
	projection: {
		mcpName: "listmonk_update_template",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#templatesUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindTemplatesUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#updateTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeUpdateTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#updateTemplate:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const templatesDeleteOperationSpec = defineOperationSpec({
	id: "templates.delete",
	resource: "template",
	verb: "delete",
	title: "Delete template",
	description: "Delete a template from Listmonk",
	contract: {
		input: resourceIdInputContract,
		output: templateDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "template", reversible: false }],
	policy: {
		confirmation: "required",
		audit: "required",
		dryRun: false,
	},
	retry: {
		kind: "reconcile",
		reconcileWith: "templates.list",
		idempotent: false,
		reason:
			"After an ambiguous delete, inspect templates.list before repeating the irreversible request.",
	},
	agent: {
		useWhen: ["A verified template must be permanently deleted."],
		avoidWhen: [
			"The template ID or destructive confirmation has not been verified.",
		],
		prerequisites: ["templates.get"],
		verifyWith: ["templates.list"],
		related: [],
		retryGuidance:
			"After an ambiguous failure, verify absence with templates.list before retrying.",
	},
	projection: {
		mcpName: "listmonk_delete_template",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#templatesDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindTemplatesDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#deleteTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeDeleteTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#deleteTemplate:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const templatesSetDefaultOperationSpec = defineOperationSpec({
	id: "templates.set-default",
	resource: "template",
	verb: "set-default",
	title: "Set default template",
	description: "Set a template as the Listmonk default",
	contract: {
		input: resourceIdInputContract,
		output: templateSetDefaultOutputContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: true }],
	policy: {
		confirmation: "never",
		audit: "required",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason:
			"Setting the same template as default repeatedly converges on the same selection.",
	},
	agent: {
		useWhen: ["A verified template should become the Listmonk default."],
		avoidWhen: ["The template ID has not been verified."],
		prerequisites: ["templates.get"],
		verifyWith: ["templates.get"],
		related: ["templates.reconcile"],
		retryGuidance:
			"Retry identical transient failures with bounded backoff, then verify with templates.get.",
	},
	projection: {
		mcpName: "listmonk_set_default_template",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#templatesSetDefaultOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindTemplatesSetDefaultOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#setDefaultTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeSetDefaultTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#setDefaultTemplate:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const templatesReconcileOperationSpec = defineOperationSpec({
	id: "templates.reconcile",
	resource: "template",
	verb: "reconcile",
	title: "Reconcile template manifest",
	description:
		"Plan or apply a versioned template manifest against exact-name Listmonk templates",
	contract: {
		input: templateManifestReconcileInputContract,
		output: templateManifestReconcileOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "template",
			reversible: false,
			preview: true,
		},
	],
	policy: {
		confirmation: "required",
		audit: "required",
		dryRun: true,
	},
	retry: {
		kind: "reconcile",
		reconcileWith: "templates.reconcile",
		idempotent: true,
		reason: "Manifest apply is plan-then-apply; re-running reconcile re-plans the full desired state and converges on the manifest, but a partial remote failure must be inspected before retrying.",
	},
	agent: {
		useWhen: [
			"A versioned template manifest must be planned or applied.",
		],
		avoidWhen: [
			"A single template should be inspected without a full manifest.",
		],
		prerequisites: ["templates.list"],
		verifyWith: ["templates.list"],
		related: ["ops.templates.registry-sync"],
		retryGuidance:
			"Re-run reconcile in dry-run mode after a partial apply to verify the remaining desired state before applying again.",
	},
	projection: {
		mcpName: "listmonk_reconcile_template_manifest",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#templatesReconcileOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindTemplatesReconcileOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#reconcileTemplateManifestOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeReconcileTemplateManifestOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#executeTemplateManifestReconcile:function",
		},
	},
	stability: "stable",
	since: "0.12.0",
});

export const mediaListOperationSpec = defineOperationSpec({
	id: "media.list",
	resource: "media",
	verb: "list",
	title: "List media",
	description: "Get uploaded media files from Listmonk",
	contract: {
		input: paginationInputContract,
		output: mediaCollectionOutputContract,
	},
	effects: [{ kind: "read", resource: "media" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current media collection.",
	},
	agent: {
		useWhen: ["Uploaded media files must be discovered or enumerated."],
		avoidWhen: ["A specific media file is already known by ID."],
		prerequisites: [],
		verifyWith: [],
		related: ["media.get", "media.upload"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_media",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#mediaListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindMediaListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/media.ts#getMediaOperation:variable",
			invokerNode:
				"packages/operations/src/media.ts#invokeGetMediaOperation:function",
			executorNode:
				"packages/operations/src/media.ts#listMedia:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const mediaGetOperationSpec = defineOperationSpec({
	id: "media.get",
	resource: "media",
	verb: "get",
	title: "Get media file",
	description: "Get an uploaded media file by ID",
	contract: {
		input: resourceIdInputContract,
		output: mediaRecordContract,
	},
	effects: [{ kind: "read", resource: "media" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current media-file representation.",
	},
	agent: {
		useWhen: ["An uploaded media file must be inspected by its numeric ID."],
		avoidWhen: ["The media-file ID is not known and discovery is required."],
		prerequisites: [],
		verifyWith: [],
		related: ["media.delete"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_media_file",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#mediaGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindMediaGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/media.ts#getMediaFileOperation:variable",
			invokerNode:
				"packages/operations/src/media.ts#invokeGetMediaFileOperation:function",
			executorNode:
				"packages/operations/src/media.ts#getMediaFile:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const mediaDeleteOperationSpec = defineOperationSpec({
	id: "media.delete",
	resource: "media",
	verb: "delete",
	title: "Delete media file",
	description: "Delete an uploaded media file from Listmonk",
	contract: {
		input: mediaDeleteInputContract,
		output: mediaDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "media", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "media.list",
		idempotent: true,
		reason:
			"Deleting an already-deleted media file is a no-op; verify with media.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["A media file must be permanently removed."],
		avoidWhen: ["The media file is referenced by a campaign or template."],
		prerequisites: ["media.get"],
		verifyWith: ["media.list"],
		related: ["media.get", "media.upload"],
		retryGuidance: "Verify the file is gone with media.list before retrying.",
	},
	projection: {
		mcpName: "listmonk_delete_media",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#mediaDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindMediaDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/media.ts#deleteMediaOperation:variable",
			invokerNode:
				"packages/operations/src/media.ts#invokeDeleteMediaOperation:function",
			executorNode:
				"packages/operations/src/media.ts#deleteMediaFile:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const mediaUploadOperationSpec = defineOperationSpec({
	id: "media.upload",
	resource: "media",
	verb: "upload",
	title: "Upload media file",
	description:
		"Upload a media file to Listmonk from base64-encoded contents. Validates an allowlist of MIME types and a 10 MiB size cap before sending.",
	contract: {
		input: mediaUploadInputContract,
		output: mediaRecordContract,
	},
	effects: [{ kind: "write", resource: "media", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A retry may upload another file unless the original media ID is known.",
	},
	agent: {
		useWhen: ["A new media file must be uploaded."],
		avoidWhen: ["An existing media file should be referenced instead."],
		prerequisites: [],
		verifyWith: ["media.list"],
		related: ["media.delete"],
		retryGuidance: "Inspect media.list before retrying an ambiguous upload.",
	},
	projection: {
		mcpName: "listmonk_upload_media",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#mediaUploadOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindMediaUploadOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/media.ts#uploadMediaOperation:variable",
			invokerNode:
				"packages/operations/src/media.ts#invokeUploadMediaOperation:function",
			executorNode:
				"packages/operations/src/media.ts#uploadMediaFile:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsSegmentDriftOperationSpec = defineOperationSpec({
	id: "ops.segments.drift",
	resource: "audience",
	verb: "drift",
	title: "Detect segment drift",
	description: "Snapshot list sizes and detect subscriber-count drift",
	contract: {
		input: segmentDriftInputContract,
		output: segmentDriftOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "audience",
			action: "recover",
			destructive: false,
			preview: false,
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"Each drift snapshot captures a point-in-time count; an ambiguous retry captures a different snapshot.",
	},
	agent: {
		useWhen: ["Subscriber list sizes must be monitored for unexpected drift."],
		avoidWhen: ["No subscriber lists exist to monitor."],
		prerequisites: ["lists.list"],
		verifyWith: ["lists.list"],
		related: [],
		retryGuidance: "Verify the previous snapshot was committed before retrying; a duplicate sample double-weights the same count.",
	},
	projection: {
		mcpName: "listmonk_ops_segment_drift",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#opsSegmentDriftOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindOpsSegmentDriftOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/ops-operations.ts#segmentDriftOperation:variable",
			invokerNode:
				"packages/automation/src/ops-operations.ts#invokeSegmentDriftOperation:function",
			executorNode:
				"packages/automation/src/ops-operations.ts#executeSegmentDriftOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsDailyDigestOperationSpec = defineOperationSpec({
	id: "ops.digest.daily",
	resource: "control",
	verb: "daily",
	title: "Generate daily operations digest",
	description:
		"Generate a metrics and deliverability summary for an operations window",
	contract: {
		input: dailyDigestInputContract,
		output: dailyDigestOutputContract,
	},
	effects: [{ kind: "read", resource: "control" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"The digest is a read-only summary; re-running produces an equivalent snapshot.",
	},
	agent: {
		useWhen: ["An operations digest must be generated for a time window."],
		avoidWhen: ["The time window has no campaign or subscriber activity."],
		prerequisites: [],
		verifyWith: [],
		related: [
			"ops.campaign.deliverability-guard",
			"ops.segments.drift",
		],
		retryGuidance: "Retry is safe; the digest is read-only.",
	},
	projection: {
		mcpName: "listmonk_ops_daily_digest",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/core-reads.ts#opsDailyDigestOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/core-reads.ts#bindOpsDailyDigestOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/ops-operations.ts#dailyDigestOperation:variable",
			invokerNode:
				"packages/automation/src/ops-operations.ts#invokeDailyDigestOperation:function",
			executorNode:
				"packages/automation/src/ops-operations.ts#executeDailyDigestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsDeliverabilityGuardOperationSpec = defineOperationSpec({
	id: "ops.campaign.deliverability-guard",
	resource: "campaign",
	verb: "deliverability-guard",
	title: "Evaluate deliverability guard",
	description: "Evaluate campaign deliverability metrics and optionally pause a breached campaign",
	contract: {
		input: deliverabilityGuardInputContract,
		output: deliverabilityGuardOutputContract,
	},
	effects: [
		{ kind: "read", resource: "campaign" },
		{ kind: "write", resource: "campaign", reversible: true },
	],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason: "Re-evaluating the same metrics converges on the same result; pause is only applied once.",
	},
	agent: {
		useWhen: [
			"Campaign deliverability metrics must be evaluated against thresholds.",
		],
		avoidWhen: ["The campaign has not started sending yet."],
		prerequisites: [],
		verifyWith: ["campaigns.get"],
		related: ["ops.digest.daily"],
		retryGuidance: "Retry is safe; the guard re-reads current metrics.",
	},
	projection: {
		mcpName: "listmonk_ops_deliverability_guard",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/core-reads.ts#opsDeliverabilityGuardOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/core-reads.ts#bindOpsDeliverabilityGuardOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#deliverabilityGuardOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeDeliverabilityGuardOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeDeliverabilityGuardOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsSubscriberHygieneOperationSpec = defineOperationSpec({
	id: "ops.subscribers.hygiene",
	resource: "subscriber",
	verb: "hygiene",
	title: "Run subscriber hygiene",
	description: "Run the winback or sunset subscriber hygiene workflow",
	contract: {
		input: subscriberHygieneInputContract,
		output: subscriberHygieneOutputContract,
	},
	effects: [
		{ kind: "write", resource: "subscriber", reversible: true, preview: true },
		{
			kind: "suppression",
			resource: "subscriber",
			scope: "audience",
			reversible: false,
			preview: true,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "unsafe",
		reason:
			"A retry re-fetches subscribers from mutable updated_at state and may process a different batch if candidates shifted.",
	},
	agent: {
		useWhen: [
			"Inactive subscribers must be identified for winback or sunset workflows.",
		],
		avoidWhen: ["No subscriber inactivity baseline has been established."],
		prerequisites: ["subscribers.list"],
		verifyWith: ["subscribers.list"],
		related: [],
		retryGuidance: "Retry with bounded backoff; the workflow is idempotent for the same candidate set.",
	},
	projection: {
		mcpName: "listmonk_ops_subscriber_hygiene",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/core-reads.ts#opsSubscriberHygieneOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/core-reads.ts#bindOpsSubscriberHygieneOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#subscriberHygieneOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeSubscriberHygieneOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeSubscriberHygieneOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsTemplateRegistrySyncOperationSpec = defineOperationSpec({
	id: "ops.templates.registry-sync",
	resource: "template",
	verb: "registry-sync",
	title: "Sync template registry",
	description: "Capture Listmonk templates in the local version registry",
	contract: {
		input: templateRegistrySyncInputContract,
		output: templateRegistrySyncOutputContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason: "Re-syncing captures the same templates; no duplicate versions are created for unchanged content.",
	},
	agent: {
		useWhen: [
			"Listmonk templates must be captured into the local version registry.",
		],
		avoidWhen: ["No templates have changed since the last sync."],
		prerequisites: ["templates.list"],
		verifyWith: ["ops.templates.registry-history"],
		related: [
			"ops.templates.registry-promote",
			"ops.templates.registry-rollback",
		],
		retryGuidance: "Retry is safe; unchanged templates are skipped.",
	},
	projection: {
		mcpName: "listmonk_ops_template_registry_sync",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/core-reads.ts#opsTemplateRegistrySyncOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/core-reads.ts#bindOpsTemplateRegistrySyncOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistrySyncOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistrySyncOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistrySyncOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsTemplateRegistryHistoryOperationSpec = defineOperationSpec({
	id: "ops.templates.registry-history",
	resource: "template",
	verb: "registry-history",
	title: "Show template version history",
	description: "Show the stored version history for a template",
	contract: {
		input: templateIdInputContract,
		output: templateRegistryHistoryOutputContract,
	},
	effects: [{ kind: "read", resource: "template" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The operation only reads the local version registry.",
	},
	agent: {
		useWhen: ["A template's stored version history must be inspected."],
		avoidWhen: ["The template has not been synced into the registry."],
		prerequisites: ["ops.templates.registry-sync"],
		verifyWith: [],
		related: [
			"ops.templates.registry-promote",
			"ops.templates.registry-rollback",
		],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_ops_template_registry_history",
		openWorld: false,
		graph: {
			descriptorNode: "packages/operations/src/specs/core-reads.ts#opsTemplateRegistryHistoryOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/core-reads.ts#bindOpsTemplateRegistryHistoryOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistryHistoryOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistryHistoryOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistryHistoryOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsTemplateRegistryPromoteOperationSpec = defineOperationSpec({
	id: "ops.templates.registry-promote",
	resource: "template",
	verb: "registry-promote",
	title: "Promote template version",
	description: "Promote a stored template version back to Listmonk",
	contract: {
		input: templatePromoteInputContract,
		output: templatePromoteOutputContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason: "Reapplying the same promotion converges on the same remote template content.",
	},
	agent: {
		useWhen: [
			"A previously captured template version must be restored to Listmonk.",
		],
		avoidWhen: ["The target version is already the active remote template."],
		prerequisites: ["ops.templates.registry-history"],
		verifyWith: ["templates.get"],
		related: ["ops.templates.registry-sync", "ops.templates.registry-rollback"],
		retryGuidance: "Retry is safe; the promotion is idempotent for the same version content.",
	},
	projection: {
		mcpName: "listmonk_ops_template_registry_promote",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/core-reads.ts#opsTemplateRegistryPromoteOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/core-reads.ts#bindOpsTemplateRegistryPromoteOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistryPromoteOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistryPromoteOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistryPromoteOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const opsTemplateRegistryRollbackOperationSpec = defineOperationSpec({
	id: "ops.templates.registry-rollback",
	resource: "template",
	verb: "registry-rollback",
	title: "Rollback template version",
	description: "Rollback a Listmonk template to its previous stored version",
	contract: {
		input: templateIdInputContract,
		output: templatePromoteOutputContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason: "A retry may roll back to a different version if the registry was updated between calls.",
	},
	agent: {
		useWhen: ["A template must be reverted to its previous stored version."],
		avoidWhen: ["No previous version exists in the registry."],
		prerequisites: ["ops.templates.registry-history"],
		verifyWith: ["templates.get"],
		related: ["ops.templates.registry-sync", "ops.templates.registry-promote"],
		retryGuidance: "Inspect ops.templates.registry-history before retrying an ambiguous rollback.",
	},
	projection: {
		mcpName: "listmonk_ops_template_registry_rollback",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/core-reads.ts#opsTemplateRegistryRollbackOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/core-reads.ts#bindOpsTemplateRegistryRollbackOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistryRollbackOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistryRollbackOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistryRollbackOperation:function",
		},
	},
	stability: "experimental",
	since: "0.9.0",
});

export const coreReadOperationSpecs = [
	listsListOperationSpec,
	listsGetOperationSpec,
	subscribersListOperationSpec,
	subscribersGetOperationSpec,
	campaignsListOperationSpec,
	campaignsStatsOperationSpec,
	templatesListOperationSpec,
	templatesGetOperationSpec,
	mediaListOperationSpec,
	mediaGetOperationSpec,
] as const;

/**
 * Standalone TypeScript-contract specs that live alongside their resource
 * neighbors but are tracked separately so the read-only invariant on
 * `coreReadOperationSpecs` stays intact.
 */
export const standaloneOperationSpecs = [
	templatesReconcileOperationSpec,
	templatesCreateOperationSpec,
	templatesUpdateOperationSpec,
	templatesDeleteOperationSpec,
	templatesSetDefaultOperationSpec,
	listsCreateOperationSpec,
	listsUpdateOperationSpec,
	listsDeleteOperationSpec,
	subscribersCreateOperationSpec,
	subscribersUpdateOperationSpec,
	subscribersDeleteOperationSpec,
	subscribersAddToListsOperationSpec,
	subscribersRemoveFromListsOperationSpec,
	subscribersUnblocklistOperationSpec,
	campaignsCreateOperationSpec,
	campaignsUpdateOperationSpec,
	campaignsDeleteOperationSpec,
	campaignsPauseOperationSpec,
	campaignsCloneOperationSpec,
	mediaDeleteOperationSpec,
	mediaUploadOperationSpec,
	opsSegmentDriftOperationSpec,
	opsDailyDigestOperationSpec,
	opsDeliverabilityGuardOperationSpec,
	opsSubscriberHygieneOperationSpec,
	opsTemplateRegistrySyncOperationSpec,
	opsTemplateRegistryHistoryOperationSpec,
	opsTemplateRegistryPromoteOperationSpec,
	opsTemplateRegistryRollbackOperationSpec,
] as const;

/** @deprecated Use `standaloneOperationSpecs`. */
export const experimentalStandaloneOperationSpecs = standaloneOperationSpecs;

export function bindListsListOperationSpec(): typeof listsListOperationSpec {
	return listsListOperationSpec;
}

export function bindListsGetOperationSpec(): typeof listsGetOperationSpec {
	return listsGetOperationSpec;
}

export function bindListsCreateOperationSpec(): typeof listsCreateOperationSpec {
	return listsCreateOperationSpec;
}

export function bindListsUpdateOperationSpec(): typeof listsUpdateOperationSpec {
	return listsUpdateOperationSpec;
}

export function bindListsDeleteOperationSpec(): typeof listsDeleteOperationSpec {
	return listsDeleteOperationSpec;
}

export function bindSubscribersListOperationSpec(): typeof subscribersListOperationSpec {
	return subscribersListOperationSpec;
}

export function bindSubscribersGetOperationSpec(): typeof subscribersGetOperationSpec {
	return subscribersGetOperationSpec;
}

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

export function bindCampaignsListOperationSpec(): typeof campaignsListOperationSpec {
	return campaignsListOperationSpec;
}

export function bindCampaignsStatsOperationSpec(): typeof campaignsStatsOperationSpec {
	return campaignsStatsOperationSpec;
}

export function bindCampaignsCreateOperationSpec(): typeof campaignsCreateOperationSpec {
	return campaignsCreateOperationSpec;
}

export function bindCampaignsUpdateOperationSpec(): typeof campaignsUpdateOperationSpec {
	return campaignsUpdateOperationSpec;
}

export function bindCampaignsDeleteOperationSpec(): typeof campaignsDeleteOperationSpec {
	return campaignsDeleteOperationSpec;
}

export function bindCampaignsPauseOperationSpec(): typeof campaignsPauseOperationSpec {
	return campaignsPauseOperationSpec;
}

export function bindCampaignsCloneOperationSpec(): typeof campaignsCloneOperationSpec {
	return campaignsCloneOperationSpec;
}

export function bindTemplatesListOperationSpec(): typeof templatesListOperationSpec {
	return templatesListOperationSpec;
}

export function bindTemplatesGetOperationSpec(): typeof templatesGetOperationSpec {
	return templatesGetOperationSpec;
}

export function bindTemplatesCreateOperationSpec(): typeof templatesCreateOperationSpec {
	return templatesCreateOperationSpec;
}

export function bindTemplatesUpdateOperationSpec(): typeof templatesUpdateOperationSpec {
	return templatesUpdateOperationSpec;
}

export function bindTemplatesDeleteOperationSpec(): typeof templatesDeleteOperationSpec {
	return templatesDeleteOperationSpec;
}

export function bindTemplatesSetDefaultOperationSpec(): typeof templatesSetDefaultOperationSpec {
	return templatesSetDefaultOperationSpec;
}

export function bindTemplatesReconcileOperationSpec(): typeof templatesReconcileOperationSpec {
	return templatesReconcileOperationSpec;
}

export function bindMediaListOperationSpec(): typeof mediaListOperationSpec {
	return mediaListOperationSpec;
}

export function bindMediaGetOperationSpec(): typeof mediaGetOperationSpec {
	return mediaGetOperationSpec;
}

export function bindMediaDeleteOperationSpec(): typeof mediaDeleteOperationSpec {
	return mediaDeleteOperationSpec;
}

export function bindMediaUploadOperationSpec(): typeof mediaUploadOperationSpec {
	return mediaUploadOperationSpec;
}

export function bindOpsSegmentDriftOperationSpec(): typeof opsSegmentDriftOperationSpec {
	return opsSegmentDriftOperationSpec;
}

export function bindOpsDailyDigestOperationSpec(): typeof opsDailyDigestOperationSpec {
	return opsDailyDigestOperationSpec;
}

export function bindOpsDeliverabilityGuardOperationSpec(): typeof opsDeliverabilityGuardOperationSpec {
	return opsDeliverabilityGuardOperationSpec;
}

export function bindOpsSubscriberHygieneOperationSpec(): typeof opsSubscriberHygieneOperationSpec {
	return opsSubscriberHygieneOperationSpec;
}

export function bindOpsTemplateRegistrySyncOperationSpec(): typeof opsTemplateRegistrySyncOperationSpec {
	return opsTemplateRegistrySyncOperationSpec;
}

export function bindOpsTemplateRegistryHistoryOperationSpec(): typeof opsTemplateRegistryHistoryOperationSpec {
	return opsTemplateRegistryHistoryOperationSpec;
}

export function bindOpsTemplateRegistryPromoteOperationSpec(): typeof opsTemplateRegistryPromoteOperationSpec {
	return opsTemplateRegistryPromoteOperationSpec;
}

export function bindOpsTemplateRegistryRollbackOperationSpec(): typeof opsTemplateRegistryRollbackOperationSpec {
	return opsTemplateRegistryRollbackOperationSpec;
}
