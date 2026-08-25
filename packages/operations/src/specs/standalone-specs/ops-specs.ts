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
		kind: "conditional",
		cases: [
			{
				when: "dry_run is true",
				semantics: {
					kind: "safe",
					reason:
						"The preview only reads and reports candidates — with their per-subscriber updated_at observations — and mutates nothing.",
				},
			},
			{
				when: "dry_run is false and subscriber_guards covers exactly the echoed subscriber_ids",
				semantics: {
					kind: "safe",
					reason:
						"The run processes exactly the echoed set, its mutations are idempotent adds, and the updated_at generation guard provides the per-subscriber completion signal: Listmonk advances updated_at on the list-add and blocklist mutations, so an identical guarded retry skips everyone the first attempt already touched and everyone that changed or re-entered eligibility externally, while untouched members of the echoed set still run.",
				},
			},
			{
				when: "dry_run is false without subscriber_guards",
				semantics: {
					kind: "unsafe",
					reason:
						"Without the per-subscriber generation guard a subscriber that re-enters eligibility — for example unblocked and inactive again — is re-selected by the identical echoed request and receives a new effect.",
				},
			},
		],
		reason:
			"Retry safety depends on the dry run and on echoing the per-subscriber updated_at generation alongside the candidate set.",
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
			"Run dry_run first, then echo both the reported subscriber_ids and the candidate_updated_at observations as subscriber_guards — a guarded destructive retry skips subscribers whose updated_at moved (its own first attempt's mutations advance it, and so does any external change or eligibility re-entry) while untouched members still run; without the guards, inspect subscribers.list before repeating because a re-eligible subscriber receives a new effect.",
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
	stability: "stable",
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
		kind: "conditional",
		cases: [
			{
				when: "expected_remote_hash is present and force is not set",
				semantics: {
					kind: "reconcile",
					reconcileWith: "templates.get",
					idempotent: false,
					reason:
						"The hash pin conflicts on any remote change — another operator promoting a different version between the attempt and the retry included — before the update is re-issued. A retry therefore either lands the same content, is a documented no-op when the target version already matches the remote template (`promoted: false`, no write and no head-revision advance), or conflicts when the promotion changed the remote hash — that conflict is the reconciliation signal. The check stays best-effort because Listmonk offers no conditional update.",
				},
			},
			{
				when: "expected_remote_hash is absent or force is set",
				semantics: {
					kind: "unsafe",
					reason:
						"An unpinned or forced retry re-issues the last-write-wins update unconditionally and can overwrite an intervening promotion of a different version.",
				},
			},
		],
		reason:
			"Retry safety depends on pinning the observed remote template hash; Listmonk updates are last-write-wins.",
	},
	agent: {
		useWhen: [
			"A previously captured template version must be restored to Listmonk.",
		],
		avoidWhen: ["The target version is already the active remote template."],
		prerequisites: ["ops.templates.registry-history"],
		verifyWith: ["templates.get"],
		related: ["ops.templates.registry-sync", "ops.templates.registry-rollback"],
		retryGuidance:
			"Echo the observed remote template hash as expected_remote_hash — ops.templates.registry-sync's per-template hash output carries it for the current remote content, and registry-history exposes the stored snapshot hashes — so an ambiguous retry conflicts on any intervening remote change — another promotion included — instead of overwriting it; an already-current target is a documented `promoted: false` no-op that issues no write, while a promotion that changed the remote hash conflicts on its own echo — on conflict reconcile with templates.get and ops.templates.registry-history before deciding; without the pin (or with force), inspect templates.get first.",
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
					idempotent: false,
					reason:
						"Inside the store lock the head-revision pin conflicts on any registry transition — including an A → B → A cycle that restores the version id — the source pin conflicts when the active version moved, and the target pin makes an already-applied rollback a documented no-op for a freshly observed pin set. A successful rollback advances the head revision and changes the remote hash, so a retry echoing the original pins always conflicts after its own success; that conflict is the reconciliation signal — an already-applied rollback shows up in registry-history with the target active. The remote hash pin stays best-effort: Listmonk offers no conditional update, so an external writer can still interleave between the hash check and the write.",
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
			"Pin the full set — from_version_id (observed active), to_version_id, expected_head_revision, and expected_remote_hash — so an ambiguous retry conflicts on any intervening registry change (an A → B → A cycle included) or is a documented no-op for a freshly observed pin set; a successful rollback advances the head revision, so a retry echoing the original pins conflicts even after its own success — on that conflict reconcile with ops.templates.registry-history and templates.get, where an already-applied rollback shows the target active; with any pin missing, do the same inspection before retrying.",
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
