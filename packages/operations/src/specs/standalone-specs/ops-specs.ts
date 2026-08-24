import { defineOperationSpec } from "../operation";
import {
	segmentDriftInputContract,
	segmentDriftOutputContract,
	dailyDigestInputContract,
	dailyDigestOutputContract,
	deliverabilityGuardInputContract,
	deliverabilityGuardOutputContract,
	subscriberHygieneInputContract,
	subscriberHygieneOutputContract,
	templateRegistrySyncInputContract,
	templateRegistrySyncOutputContract,
	templateRegistryHistoryOutputContract,
	templateIdInputContract,
	templateRollbackInputContract,
	templateRollbackOutputContract,
	templatePromoteInputContract,
	templatePromoteOutputContract,
} from "../contract-schemas";

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
		kind: "conditional",
		cases: [
			{
				when: "sample_key is provided",
				semantics: {
					kind: "reconcile",
					reconcileWith: "ops.segments.drift",
					idempotent: true,
					reason:
						"A completed keyed sample replays from the store: an exactly identical retry (same scope, list set, and drift settings) returns the originally committed measurement — comparisons and alerts included — for as long as that measurement remains retained, while reusing the key with a different request is an explicit conflict.",
				},
			},
			{
				when: "sample_key is absent",
				semantics: {
					kind: "unsafe",
					reason:
						"An unkeyed snapshot appends a point-in-time count, so an ambiguous retry captures a new sample that double-weights the period.",
				},
			},
		],
		reason:
			"Retry safety depends on whether the caller supplies the sampling period key.",
	},
	agent: {
		useWhen: ["Subscriber list sizes must be monitored for unexpected drift."],
		avoidWhen: ["No subscriber lists exist to monitor."],
		prerequisites: ["lists.list"],
		verifyWith: ["lists.list"],
		related: [],
		retryGuidance:
			"For an unkeyed run, verify the prior snapshot was committed before re-running; an ambiguous retry appends a fresh sample that double-weights the period. For a keyed run, re-run with the same sample_key: the retry replaces that period's snapshot instead of appending a duplicate sample.",
	},
	projection: {
		mcpName: "listmonk_ops_segment_drift",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/ops-specs.ts#opsSegmentDriftOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsSegmentDriftOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/ops-operations.ts#segmentDriftOperation:variable",
			invokerNode:
				"packages/automation/src/ops-operations.ts#invokeSegmentDriftOperation:function",
			executorNode:
				"packages/automation/src/ops-operations.ts#executeSegmentDriftOperation:function",
		},
	},
	stability: "stable",
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
				"packages/operations/src/specs/standalone-specs/ops-specs.ts#opsDailyDigestOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsDailyDigestOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/ops-operations.ts#dailyDigestOperation:variable",
			invokerNode:
				"packages/automation/src/ops-operations.ts#invokeDailyDigestOperation:function",
			executorNode:
				"packages/automation/src/ops-operations.ts#executeDailyDigestOperation:function",
		},
	},
	stability: "stable",
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
		{ kind: "write", resource: "campaign", reversible: false },
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
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
			descriptorNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#opsDeliverabilityGuardOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsDeliverabilityGuardOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#deliverabilityGuardOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeDeliverabilityGuardOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeDeliverabilityGuardOperation:function",
		},
	},
	stability: "stable",
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
		kind: "reconcile",
		reconcileWith: "subscribers.list",
		idempotent: false,
		reason:
			"Destructive runs process exactly the echoed subscriber set — subscribers that left the eligible set are skipped and winback additions are idempotent memberships — but a subscriber that re-enters eligibility (for example unblocked and inactive again) is re-selected by the identical echoed request and receives a new effect; the run stays experimental until durable per-subscriber completion state exists.",
	},
	agent: {
		useWhen: [
			"Inactive subscribers must be identified for winback or sunset workflows.",
		],
		avoidWhen: ["No subscriber inactivity baseline has been established."],
		prerequisites: ["subscribers.list"],
		verifyWith: ["subscribers.list"],
		related: [],
		retryGuidance:
			"Run dry_run first, then echo the reported subscriber_ids; an identical repeat processes nothing new unless a subscriber re-entered eligibility, so inspect subscribers.list before repeating.",
	},
	projection: {
		mcpName: "listmonk_ops_subscriber_hygiene",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#opsSubscriberHygieneOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsSubscriberHygieneOperationSpec:function",
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
			descriptorNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#opsTemplateRegistrySyncOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsTemplateRegistrySyncOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistrySyncOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistrySyncOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistrySyncOperation:function",
		},
	},
	stability: "stable",
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
			descriptorNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#opsTemplateRegistryHistoryOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsTemplateRegistryHistoryOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistryHistoryOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistryHistoryOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistryHistoryOperation:function",
		},
	},
	stability: "stable",
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
			descriptorNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#opsTemplateRegistryPromoteOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsTemplateRegistryPromoteOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistryPromoteOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistryPromoteOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistryPromoteOperation:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

export const opsTemplateRegistryRollbackOperationSpec = defineOperationSpec({
	id: "ops.templates.registry-rollback",
	resource: "template",
	verb: "registry-rollback",
	title: "Rollback template version",
	description: "Rollback a Listmonk template to its previous stored version",
	contract: {
		input: templateRollbackInputContract,
		output: templateRollbackOutputContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "conditional",
		cases: [
			{
				when: "from_version_id, to_version_id, expected_head_revision, and expected_remote_hash are all present",
				semantics: {
					kind: "reconcile",
					reconcileWith: "templates.get",
					idempotent: true,
					reason:
						"Inside the store lock the head-revision pin conflicts on any registry transition — including an A → B → A cycle that restores the version id — the source pin conflicts when the active version moved, and the target pin makes an already-applied rollback a documented no-op, so a fully pinned retry converges on registry state. The remote hash pin stays best-effort: Listmonk offers no conditional update, so an external writer can interleave between the hash check and the write, and the retry re-issues the same last-write-wins update — verify the remote template afterwards.",
				},
			},
			{
				when: "any pin is absent",
				semantics: {
					kind: "unsafe",
					reason:
						"Without the full pin set an ABA transition or out-of-registry drift is indistinguishable, and a repeat may roll a different version than the caller reviewed.",
				},
			},
		],
		reason:
			"Retry safety depends on whether the caller pins the observed registry head, target, and remote hash; even fully pinned retries re-issue a last-write-wins remote update.",
	},
	agent: {
		useWhen: ["A template must be reverted to its previous stored version."],
		avoidWhen: ["No previous version exists in the registry."],
		prerequisites: ["ops.templates.registry-history"],
		verifyWith: ["templates.get"],
		related: ["ops.templates.registry-sync", "ops.templates.registry-promote"],
		retryGuidance:
			"Pin the full set from ops.templates.registry-history — from_version_id (observed active), to_version_id, expected_head_revision, and expected_remote_hash — so an ambiguous retry conflicts on any intervening registry change (an A → B → A cycle included) or is a documented no-op; because Listmonk updates are last-write-wins, verify the remote template with templates.get after a pinned retry, and with any pin missing inspect templates.get and the registry history before retrying.",
	},
	projection: {
		mcpName: "listmonk_ops_template_registry_rollback",
		openWorld: true,
		graph: {
			descriptorNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#opsTemplateRegistryRollbackOperationSpec:variable",
			bindingNode: "packages/operations/src/specs/standalone-specs/ops-specs.ts#bindOpsTemplateRegistryRollbackOperationSpec:function",
			runtimeDefinitionNode: "packages/automation/src/ops-operations.ts#templateRegistryRollbackOperation:variable",
			invokerNode: "packages/automation/src/ops-operations.ts#invokeTemplateRegistryRollbackOperation:function",
			executorNode: "packages/automation/src/ops-operations.ts#executeTemplateRegistryRollbackOperation:function",
		},
	},
	stability: "stable",
	since: "0.9.0",
});

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
