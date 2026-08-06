import {
	campaignCollectionOutputContract,
	campaignListInputContract,
	campaignStatsOutputContract,
	mediaCollectionOutputContract,
	mediaRecordContract,
	paginationInputContract,
	resourceIdInputContract,
	subscriberCollectionOutputContract,
	subscriberListCollectionOutputContract,
	subscriberListInputContract,
	subscriberListRecordContract,
	subscriberRecordContract,
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
	stability: "experimental",
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
	stability: "experimental",
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
] as const;

/** @deprecated Use `standaloneOperationSpecs`. */
export const experimentalStandaloneOperationSpecs = standaloneOperationSpecs;

export function bindListsListOperationSpec(): typeof listsListOperationSpec {
	return listsListOperationSpec;
}

export function bindListsGetOperationSpec(): typeof listsGetOperationSpec {
	return listsGetOperationSpec;
}

export function bindSubscribersListOperationSpec(): typeof subscribersListOperationSpec {
	return subscribersListOperationSpec;
}

export function bindSubscribersGetOperationSpec(): typeof subscribersGetOperationSpec {
	return subscribersGetOperationSpec;
}

export function bindCampaignsListOperationSpec(): typeof campaignsListOperationSpec {
	return campaignsListOperationSpec;
}

export function bindCampaignsStatsOperationSpec(): typeof campaignsStatsOperationSpec {
	return campaignsStatsOperationSpec;
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
