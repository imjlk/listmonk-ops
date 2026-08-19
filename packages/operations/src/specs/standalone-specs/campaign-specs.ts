import { defineOperationSpec } from "../operation";
import {
	campaignCreateInputContract,
	campaignUpdateInputContract,
	campaignDeleteInputContract,
	campaignDeleteOutputContract,
	campaignCloneInputContract,
	campaignGetOutputContract,
	campaignLifecycleInputContract,
	campaignLifecycleOutputContract,
} from "../contract-schemas";

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
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsCreateOperationSpec:function",
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
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#updateCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeUpdateCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#updateCampaign:function",
		},
	},
	stability: "stable",
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
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#deleteCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeDeleteCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#deleteCampaign:function",
		},
	},
	stability: "stable",
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
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsPauseOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsPauseOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#pauseCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokePauseCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#pauseCampaign:function",
		},
	},
	stability: "stable",
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
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsCloneOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsCloneOperationSpec:function",
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
