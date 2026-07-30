import {
	campaignLifecycleInputContract,
	campaignLifecycleOutputContract,
	campaignPreflightInputContract,
	campaignPreflightOutputContract,
	transactionalSendInputContract,
	transactionalSendOutputContract,
} from "./contract-schemas";
import { defineOperationSpec } from "./operation";
import { defineOperationPlaybook } from "./playbook";
import { campaignGetOperationSpec } from "./pilot";
import { defineOperationResourceSpec } from "./resource";

export const messageResource = defineOperationResourceSpec({
	id: "message",
	title: "Transactional message",
	states: ["ready", "accepted", "failed", "unknown"],
	transitions: {
		ready: ["accepted", "failed", "unknown"],
		unknown: ["accepted", "failed"],
		accepted: [],
		failed: [],
	},
	terminalStates: ["accepted", "failed"],
});

export const campaignStartOperationSpec = defineOperationSpec({
	id: "campaigns.start",
	resource: "campaign",
	verb: "start",
	title: "Start campaign",
	description:
		"Transition a campaign into the running status. Validates the current status allows the transition. Destructive because this begins mass delivery immediately.",
	contract: {
		input: campaignLifecycleInputContract,
		output: campaignLifecycleOutputContract,
	},
	effects: [
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "immediate",
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
			"The executor reads the current state first and treats an already-running campaign as a no-op after an ambiguous status update.",
	},
	state: {
		resource: "campaign",
		from: ["draft", "scheduled", "paused"],
		to: "running",
		allowNoopFromTarget: true,
	},
	agent: {
		useWhen: ["A reviewed campaign must begin bulk delivery immediately."],
		avoidWhen: [
			"Campaign preflight has not passed.",
			"The campaign should begin at a future time instead of immediately.",
		],
		prerequisites: ["campaigns.get", "ops.campaign.preflight"],
		verifyWith: ["campaigns.get", "campaigns.stats"],
		related: ["campaigns.schedule", "campaigns.pause", "campaigns.cancel"],
		retryGuidance:
			"On timeout, inspect campaigns.get before repeating the confirmed start.",
	},
	projection: {
		mcpName: "listmonk_start_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/high-risk.ts#campaignStartOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/high-risk.ts#bindCampaignStartOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#startCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeStartCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#startCampaign:function",
		},
	},
	stability: "stable",
	since: "0.7.0",
});

export const campaignCancelOperationSpec = defineOperationSpec({
	id: "campaigns.cancel",
	resource: "campaign",
	verb: "cancel",
	title: "Cancel campaign",
	description:
		"Transition a campaign into the cancelled status. Validates the current status allows the transition. Destructive because the cancellation is irreversible.",
	contract: {
		input: campaignLifecycleInputContract,
		output: campaignLifecycleOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "campaign",
			reversible: false,
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
			"The executor reads the current state first and treats an already-cancelled campaign as a no-op after an ambiguous status update.",
	},
	state: {
		resource: "campaign",
		from: ["running"],
		to: "cancelled",
		allowNoopFromTarget: true,
	},
	agent: {
		useWhen: ["An actively sending campaign must be stopped permanently."],
		avoidWhen: [
			"A temporary pause is sufficient.",
			"The campaign is scheduled but has not started; Listmonk only cancels active campaigns.",
		],
		prerequisites: ["campaigns.get"],
		verifyWith: ["campaigns.get"],
		related: ["campaigns.pause", "campaigns.delete", "campaigns.stats"],
		retryGuidance:
			"On timeout, inspect campaigns.get before repeating the confirmed cancellation.",
	},
	projection: {
		mcpName: "listmonk_cancel_campaign",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/high-risk.ts#campaignCancelOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/high-risk.ts#bindCampaignCancelOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/campaigns.ts#cancelCampaignOperation:variable",
			invokerNode:
				"packages/operations/src/campaigns.ts#invokeCancelCampaignOperation:function",
			executorNode:
				"packages/operations/src/campaigns.ts#cancelCampaign:function",
		},
	},
	stability: "stable",
	since: "0.7.0",
});

export const transactionalSendOperationSpec = defineOperationSpec({
	id: "transactional.send",
	resource: "message",
	verb: "send",
	title: "Send transactional message",
	description: "Send a transactional email through Listmonk",
	contract: {
		input: transactionalSendInputContract,
		output: transactionalSendOutputContract,
	},
	effects: [
		{
			kind: "delivery",
			resource: "message",
			audience: "single",
			timing: "immediate",
		},
	],
	policy: {
		confirmation: "never",
		audit: "required",
		dryRun: false,
	},
	retry: {
		kind: "conditional",
		cases: [
			{
				when: "idempotency_key is present",
				semantics: {
					kind: "safe",
					reason:
						"Identical requests replay an accepted or failed record and ambiguous records block automatic redelivery.",
				},
			},
			{
				when: "idempotency_key is absent",
				semantics: {
					kind: "unsafe",
					reason:
						"A timeout may occur after Listmonk accepted the message, so a retry can deliver a duplicate.",
				},
			},
		],
		reason:
			"Retry safety depends on whether the caller supplies the optional idempotency key.",
	},
	agent: {
		useWhen: ["One transactional template must be sent to exactly one recipient."],
		avoidWhen: [
			"A campaign or sequence is the correct delivery mechanism.",
			"A retryable workflow cannot provide a stable idempotency_key.",
		],
		prerequisites: [],
		verifyWith: [],
		related: ["templates.get", "subscribers.get"],
		retryGuidance:
			"Always provide a stable idempotency_key for agent retries; reconcile pending or unknown records instead of changing the key.",
	},
	projection: {
		mcpName: "listmonk_send_transactional",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/high-risk.ts#transactionalSendOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/high-risk.ts#bindTransactionalSendOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/transactional.ts#sendTransactionalOperation:variable",
			invokerNode:
				"packages/operations/src/transactional.ts#invokeSendTransactionalOperation:function",
			executorNode:
				"packages/operations/src/transactional.ts#sendTransactionalMessage:function",
		},
	},
	stability: "stable",
	since: "0.7.0",
});

export const campaignPreflightOperationSpec = defineOperationSpec({
	id: "ops.campaign.preflight",
	resource: "campaign",
	verb: "preflight",
	title: "Run campaign preflight",
	description: "Run pre-send checks against a Listmonk campaign",
	contract: {
		input: campaignPreflightInputContract,
		output: campaignPreflightOutputContract,
	},
	effects: [{ kind: "read", resource: "campaign" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason:
			"Preflight reads campaign state and optionally probes policy-approved public links without mutating Listmonk.",
	},
	agent: {
		useWhen: ["A campaign must be checked immediately before scheduling or starting delivery."],
		avoidWhen: [
			"The campaign does not yet have its final audience, content, sender, and delivery profile.",
		],
		prerequisites: ["campaigns.get"],
		verifyWith: [],
		related: [
			"campaigns.schedule",
			"campaigns.start",
			"ops.campaign.deliverability-guard",
		],
		retryGuidance:
			"Retry transient reads or public-link probes; re-evaluate the returned checks because remote state may have changed.",
	},
	projection: {
		mcpName: "listmonk_ops_preflight",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/high-risk.ts#campaignPreflightOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/high-risk.ts#bindCampaignPreflightOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/ops-operations.ts#campaignPreflightOperation:variable",
			invokerNode:
				"packages/automation/src/ops-operations.ts#invokeCampaignPreflightOperation:function",
			executorNode:
				"packages/automation/src/ops-operations.ts#executeCampaignPreflightOperation:function",
		},
	},
	stability: "stable",
	since: "0.7.0",
});

export const highRiskOperationSpecs = [
	campaignStartOperationSpec,
	campaignCancelOperationSpec,
	transactionalSendOperationSpec,
	campaignPreflightOperationSpec,
] as const;

export function bindCampaignStartOperationSpec(): typeof campaignStartOperationSpec {
	return campaignStartOperationSpec;
}

export function bindCampaignCancelOperationSpec(): typeof campaignCancelOperationSpec {
	return campaignCancelOperationSpec;
}

export function bindTransactionalSendOperationSpec(): typeof transactionalSendOperationSpec {
	return transactionalSendOperationSpec;
}

export function bindCampaignPreflightOperationSpec(): typeof campaignPreflightOperationSpec {
	return campaignPreflightOperationSpec;
}

export const campaignSafeStartPlaybook = defineOperationPlaybook({
	id: "campaign.safe-start",
	title: "Safely start a campaign",
	goal:
		"Inspect and preflight a reviewed campaign, obtain human approval, start bulk delivery, and verify the resulting state.",
	inputs: [
		{
			name: "campaign_id",
			type: "number",
			required: true,
			description: "Listmonk campaign ID to start",
		},
	],
	steps: [
		{
			id: "inspect",
			operation: campaignGetOperationSpec.id,
			approval: "none",
			description: "Inspect the current campaign and its lifecycle status.",
			dependsOn: [],
			input: [
				{
					parameter: "id",
					source: { kind: "playbook-input", name: "campaign_id" },
				},
			],
		},
		{
			id: "preflight",
			operation: campaignPreflightOperationSpec.id,
			approval: "none",
			description: "Run pre-send checks against the final campaign.",
			dependsOn: ["inspect"],
			input: [
				{
					parameter: "campaign_id",
					source: { kind: "playbook-input", name: "campaign_id" },
				},
				{
					parameter: "max_audience",
					source: { kind: "literal", value: 200_000 },
				},
				{
					parameter: "check_links",
					source: { kind: "literal", value: true },
				},
				{
					parameter: "link_check_timeout_ms",
					source: { kind: "literal", value: 4_000 },
				},
			],
			resultGuard: {
				path: "summary.fail",
				operator: "equals",
				expected: 0,
				onFailure: "stop",
				message: "Do not start delivery while any preflight check fails.",
			},
		},
		{
			id: "start",
			operation: campaignStartOperationSpec.id,
			approval: "human",
			description: "Begin bulk delivery after explicit human confirmation.",
			dependsOn: ["preflight"],
			input: [
				{
					parameter: "id",
					source: { kind: "playbook-input", name: "campaign_id" },
				},
				{
					parameter: "expected_updated_at",
					source: {
						kind: "step-output",
						stepId: "preflight",
						path: "campaignUpdatedAt",
					},
				},
			],
		},
		{
			id: "verify",
			operation: campaignGetOperationSpec.id,
			approval: "none",
			description: "Verify that the campaign entered the running state.",
			dependsOn: ["start"],
			input: [
				{
					parameter: "id",
					source: { kind: "step-output", stepId: "start", path: "id" },
				},
			],
			resultGuard: {
				path: "status",
				operator: "equals",
				expected: "running",
				onFailure: "stop",
				message:
					"Stop and reconcile the campaign state if running cannot be verified.",
			},
		},
	],
	recoveryOperation: campaignGetOperationSpec.id,
});
