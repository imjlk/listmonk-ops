import { defineOperationSpec } from "../operation";
import {
	campaignArchiveInputContract,
	campaignArchiveOutputContract,
	campaignAnalyticsInputContract,
	campaignAnalyticsOutputContract,
	campaignPreviewInputContract,
	campaignPreviewOutputContract,
	campaignTestInputContract,
	campaignTestOutputContract,
	campaignCreateInputContract,
	campaignCreateOutputContract,
	campaignUpdateInputContract,
	campaignDeleteInputContract,
	campaignDeleteOutputContract,
	campaignCloneInputContract,
	campaignCloneOutputContract,
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
		output: campaignCreateOutputContract,
	},
	effects: [{ kind: "write", resource: "campaign", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "conditional",
		cases: [
			{
				when: "idempotency_key is present",
				semantics: {
					kind: "safe",
					reason:
						"The key is atomically claimed in a durable store before the create is issued and then bound to the created campaign id; an identical retry (same key, same request payload, same Listmonk target) replays that campaign with created: false, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different request or target under the same key is rejected. An attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown, and later same-key creates fail fast with reconciliation guidance: the key is intentionally not reused, because no name-based check can prove which same-named campaign a create produced.",
				},
			},
			{
				when: "idempotency_key is absent",
				semantics: {
					kind: "unsafe",
					reason:
						"Listmonk campaign names are not unique, so a retry after an ambiguous create provisions a duplicate campaign.",
				},
			},
		],
		reason:
			"Retry safety depends on whether the caller supplies an idempotency key.",
	},
	agent: {
		useWhen: ["A new campaign must be created."],
		avoidWhen: ["An existing campaign should be cloned or updated instead."],
		prerequisites: [],
		verifyWith: ["campaigns.list"],
		related: ["campaigns.update", "campaigns.clone"],
		retryGuidance:
			"Key the create with idempotency_key so an ambiguous retry replays the bound campaign; without a key, verify with campaigns.list before repeating.",
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
	stability: "stable",
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
		output: campaignCloneOutputContract,
	},
	effects: [{ kind: "write", resource: "campaign", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "conditional",
		cases: [
			{
				when: "idempotency_key is present",
				semantics: {
					kind: "safe",
					reason:
						"The key is atomically claimed in a durable store before the clone create is issued and then bound to the cloned campaign id; an identical retry (same key, same source campaign and clone name, same Listmonk target) replays that campaign with created: false, a concurrent same-key clone waits for the in-flight one instead of issuing a second POST, and a different request or target under the same key is rejected. An attempt that ends ambiguously — or whose accepted response carries neither an id nor an immutable uuid to correlate — marks its claim unknown, and later same-key clones fail fast with reconciliation guidance: the key is intentionally not reused, because no name-based check can prove which same-named campaign a clone produced.",
				},
			},
			{
				when: "idempotency_key is absent",
				semantics: {
					kind: "unsafe",
					reason:
						"Listmonk campaign names are not unique, so a retry after an ambiguous clone provisions a duplicate campaign.",
				},
			},
		],
		reason:
			"Retry safety depends on whether the caller supplies an idempotency key.",
	},
	agent: {
		useWhen: ["A new campaign should reuse an existing campaign's content."],
		avoidWhen: ["A brand-new campaign should be created from scratch."],
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.list"],
		related: ["campaigns.create"],
		retryGuidance:
			"Key the clone with idempotency_key so an ambiguous retry replays the bound campaign; without a key, verify with campaigns.list before repeating.",
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
	stability: "stable",
	since: "0.9.0",
});

export const campaignsArchiveOperationSpec = defineOperationSpec({
	id: "campaigns.archive",
	resource: "campaign",
	verb: "archive",
	title: "Toggle the campaign archive page",
	description:
		"Enable or disable the campaign's public archive page. Repeating the same toggle is a documented no-op.",
	contract: {
		input: campaignArchiveInputContract,
		output: campaignArchiveOutputContract,
	},
	effects: [{ kind: "write", resource: "campaign", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"The toggle is idempotent and reversible: repeating the same archive value converges on the same state, and the observed endpoint acknowledges even unknown campaign ids.",
	},
	agent: {
		useWhen: [
			"A finished campaign's public archive page must be published or withdrawn.",
		],
		avoidWhen: ["The campaign is not finished — archive pages apply to sent campaigns."],
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.get"],
		related: ["campaigns.get", "campaigns.update"],
		retryGuidance:
			"Repeat safely; verify the archive flag through campaigns.get after an ambiguous result.",
	},
	projection: {
		mcpName: "listmonk_archive_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsArchiveOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsArchiveOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#archiveCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeArchiveCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#archiveCampaign:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindCampaignsArchiveOperationSpec(): typeof campaignsArchiveOperationSpec {
	return campaignsArchiveOperationSpec;
}

export const campaignsAnalyticsOperationSpec = defineOperationSpec({
	id: "campaigns.analytics",
	resource: "campaign",
	verb: "analytics",
	title: "Read campaign analytics",
	description:
		"Read view, click, link, or bounce analytics for a bounded set of campaigns over a date range.",
	contract: {
		input: campaignAnalyticsInputContract,
		output: campaignAnalyticsOutputContract,
	},
	effects: [{ kind: "read", resource: "campaign" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads recorded analytics rows.",
	},
	agent: {
		useWhen: [
			"Campaign engagement (views, clicks, link performance, bounces) must be analyzed over a date range.",
		],
		avoidWhen: ["Aggregate send-time statistics are sufficient — prefer campaigns.stats."],
		prerequisites: ["campaigns.list"],
		verifyWith: [],
		related: ["campaigns.stats", "ops.campaign.preflight"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_campaign_analytics",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsAnalyticsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsAnalyticsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#getCampaignAnalyticsOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeGetCampaignAnalyticsOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#readCampaignAnalytics:function",
		},
	},
	stability: "stable",
	since: "0.16.0",
});

export function bindCampaignsAnalyticsOperationSpec(): typeof campaignsAnalyticsOperationSpec {
	return campaignsAnalyticsOperationSpec;
}

export const campaignsPreviewOperationSpec = defineOperationSpec({
	id: "campaigns.preview",
	resource: "campaign",
	verb: "preview",
	title: "Preview campaign",
	description:
		"Render the stored campaign body to HTML exactly as recipients would see it, without sending anything.",
	contract: {
		input: campaignPreviewInputContract,
		output: campaignPreviewOutputContract,
	},
	effects: [{ kind: "read", resource: "campaign" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only renders the stored campaign body.",
	},
	agent: {
		useWhen: [
			"A campaign's rendered output must be inspected before launch.",
		],
		avoidWhen: ["A rendered body must be sent to a real recipient."],
		prerequisites: ["campaigns.get"],
		verifyWith: [],
		related: ["campaigns.get", "ops.campaign.preflight"],
		retryGuidance: "Retry transient render failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_preview_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsPreviewOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsPreviewOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#previewCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokePreviewCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#previewCampaign:function",
		},
	},
	stability: "stable",
	since: "0.16.0",
});

export const campaignsTestOperationSpec = defineOperationSpec({
	id: "campaigns.test",
	resource: "campaign",
	verb: "test",
	title: "Send a campaign test message",
	description:
		"Deliver the campaign to a bounded set of existing-subscriber emails for review. Each confirmed run sends a real message.",
	contract: {
		input: campaignTestInputContract,
		output: campaignTestOutputContract,
	},
	effects: [
		{
			kind: "delivery",
			resource: "campaign",
			audience: "single",
			timing: "immediate",
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"Every run dispatches a fresh message to every listed recipient; Listmonk offers no test-send idempotency key, so a retry re-sends. Single, explicitly chosen recipients keep the transactional-send convention of not requiring a destructive confirmation.",
	},
	agent: {
		useWhen: [
			"A campaign draft must be reviewed in a real inbox before launch.",
		],
		avoidWhen: [
			"A rendered preview is sufficient, or recipients are not expecting mail.",
		],
		prerequisites: ["campaigns.get", "campaigns.preview"],
		verifyWith: [],
		related: ["campaigns.preview", "ops.campaign.preflight"],
		retryGuidance:
			"Do not blindly repeat: each confirmed request re-sends the message. Verify the received mail (or the messenger log) before retrying.",
	},
	projection: {
		mcpName: "listmonk_test_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#campaignsTestOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/campaign-specs.ts#bindCampaignsTestOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#testCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeTestCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#sendTestCampaign:function",
		},
	},
	stability: "stable",
	since: "0.16.0",
});

export function bindCampaignsPreviewOperationSpec(): typeof campaignsPreviewOperationSpec {
	return campaignsPreviewOperationSpec;
}

export function bindCampaignsTestOperationSpec(): typeof campaignsTestOperationSpec {
	return campaignsTestOperationSpec;
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
