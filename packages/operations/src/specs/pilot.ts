import {
	campaignGetInputContract,
	campaignGetOutputContract,
	campaignScheduleInputContract,
	campaignScheduleOutputContract,
	subscriberBlocklistInputContract,
	subscriberBulkOutputContract,
} from "./contract-schemas";
import { defineOperationSpec } from "./operation";
import { defineOperationResourceSpec } from "./resource";
import { defineEmailOperationsSpec } from "./schema";

export const campaignResource = defineOperationResourceSpec({
	id: "campaign",
	title: "Campaign",
	states: ["draft", "scheduled", "running", "paused", "finished", "cancelled"],
	transitions: {
		draft: ["scheduled", "running"],
		scheduled: ["running"],
		running: ["paused", "cancelled"],
		paused: ["running"],
		finished: [],
		cancelled: [],
	},
	terminalStates: ["finished", "cancelled"],
});

export const subscriberResource = defineOperationResourceSpec({
	id: "subscriber",
	title: "Subscriber",
	states: ["enabled", "disabled", "blocklisted"],
	transitions: {
		enabled: ["disabled", "blocklisted"],
		disabled: ["enabled", "blocklisted"],
		blocklisted: ["enabled"],
	},
	terminalStates: [],
});

export const campaignGetOperationSpec = defineOperationSpec({
	id: "campaigns.get",
	resource: "campaign",
	verb: "get",
	title: "Get campaign",
	description: "Get a campaign by ID",
	contract: {
		input: campaignGetInputContract,
		output: campaignGetOutputContract,
	},
	effects: [{ kind: "read", resource: "campaign" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current campaign representation.",
	},
	agent: {
		useWhen: ["A campaign must be inspected before a mutation or verification."],
		avoidWhen: ["A campaign collection or aggregate statistics are required."],
		prerequisites: [],
		verifyWith: [],
		related: ["campaigns.schedule", "campaigns.stats"],
		retryGuidance: "Retry transient read failures with normal backoff.",
	},
	projection: {
		mcpName: "listmonk_get_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/pilot.ts#campaignGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/pilot.ts#bindCampaignGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#getCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeGetCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#getCampaign:function",
		},
	},
	stability: "experimental",
	since: "0.6.0",
});

export const campaignScheduleOperationSpec = defineOperationSpec({
	id: "campaigns.schedule",
	resource: "campaign",
	verb: "schedule",
	title: "Schedule campaign",
	description:
		"Schedule a campaign to send at a specific time. Validates the current status allows the transition. Destructive because a scheduled campaign will begin mass delivery at the configured time.",
	contract: {
		input: campaignScheduleInputContract,
		output: campaignScheduleOutputContract,
	},
	effects: [
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "scheduled",
		},
	],
	policy: {
		confirmation: "required",
		audit: "required",
		dryRun: false,
	},
	retry: {
		kind: "reconcile",
		reconcileWith: "campaigns.get",
		idempotent: true,
		reason:
			"Scheduling writes send_at before the status transition, so a timeout can leave an ambiguous remote state.",
	},
	state: {
		resource: "campaign",
		from: ["draft"],
		to: "scheduled",
		allowNoopFromTarget: true,
	},
	agent: {
		useWhen: ["A reviewed campaign must start bulk delivery at a future time."],
		avoidWhen: [
			"The campaign is already running or terminal.",
			"Campaign preflight has not passed.",
		],
		prerequisites: ["campaigns.get", "ops.campaign.preflight"],
		verifyWith: ["campaigns.get"],
		related: ["campaigns.pause", "campaigns.cancel", "campaigns.stats"],
		retryGuidance:
			"On timeout, inspect campaigns.get before deciding whether to retry.",
	},
	projection: {
		mcpName: "listmonk_schedule_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/pilot.ts#campaignScheduleOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/pilot.ts#bindCampaignScheduleOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#scheduleCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeScheduleCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#scheduleCampaign:function",
		},
	},
	stability: "experimental",
	since: "0.6.0",
});

export const subscriberBlocklistOperationSpec = defineOperationSpec({
	id: "subscribers.blocklist",
	resource: "subscriber",
	verb: "blocklist",
	title: "Blocklist subscribers",
	description:
		"Add a batch of subscribers to the blocklist (action: add). Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because blocklisting suppresses mail delivery for the entire batch.",
	contract: {
		input: subscriberBlocklistInputContract,
		output: subscriberBulkOutputContract,
	},
	effects: [
		{
			kind: "suppression",
			resource: "subscriber",
			scope: "audience",
			reversible: true,
		},
	],
	policy: {
		confirmation: "required",
		audit: "required",
		dryRun: true,
	},
	retry: {
		kind: "safe",
		reason:
			"Re-applying blocklist to the same subscriber IDs is idempotent, including after partial chunk completion.",
	},
	state: {
		resource: "subscriber",
		from: ["enabled", "disabled"],
		to: "blocklisted",
		allowNoopFromTarget: true,
	},
	agent: {
		useWhen: [
			"One or more subscribers must be prevented from receiving future mail.",
		],
		avoidWhen: [
			"The target audience has not been previewed with dry_run.",
			"A per-list unsubscribe is intended instead of global suppression.",
		],
		prerequisites: ["subscribers.get"],
		verifyWith: ["subscribers.get"],
		related: ["subscribers.unblocklist", "subscribers.remove-from-lists"],
		retryGuidance:
			"Prefer dry_run first; an identical confirmed retry is safe after transient failure.",
	},
	projection: {
		mcpName: "listmonk_blocklist_subscribers",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/pilot.ts#subscriberBlocklistOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/pilot.ts#bindSubscriberBlocklistOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/subscribers.ts#blocklistSubscribersOperation:variable",
			invokerNode:
				"packages/operations/src/subscribers.ts#invokeBlocklistSubscribersOperation:function",
			executorNode:
				"packages/operations/src/subscribers.ts#blocklistSubscribers:function",
		},
	},
	stability: "experimental",
	since: "0.6.0",
});

export const pilotOperationSpecs = [
	campaignGetOperationSpec,
	campaignScheduleOperationSpec,
	subscriberBlocklistOperationSpec,
] as const;

export function bindCampaignGetOperationSpec(): typeof campaignGetOperationSpec {
	return campaignGetOperationSpec;
}

export function bindCampaignScheduleOperationSpec(): typeof campaignScheduleOperationSpec {
	return campaignScheduleOperationSpec;
}

export function bindSubscriberBlocklistOperationSpec(): typeof subscriberBlocklistOperationSpec {
	return subscriberBlocklistOperationSpec;
}

export const emailOperationsSpec =
	defineEmailOperationsSpec({
		schemaVersion: "1.0.0",
		title: "listmonk-ops Email Operations Specification",
		description:
			"Typed, policy-aware, and verifiable email operations for humans and AI agents.",
		resources: [campaignResource, subscriberResource],
		operations: pilotOperationSpecs,
		events: [],
		playbooks: [],
	});
