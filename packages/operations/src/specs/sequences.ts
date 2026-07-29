import {
	sequenceCreateInputContract,
	sequenceDefinitionOutputContract,
	sequenceDeleteOutputContract,
	sequenceEnrollInputContract,
	sequenceEnrollmentOutputContract,
	sequenceIdInputContract,
	sequenceListInputContract,
	sequenceListOutputContract,
	sequenceReconcileInputContract,
	sequenceReconcileOutputContract,
	sequenceStatusInputContract,
	sequenceStatusOutputContract,
	sequenceTickInputContract,
	sequenceTickOutputContract,
	sequenceUpdateInputContract,
	sequenceValidateInputContract,
	sequenceValidateOutputContract,
} from "./contract-schemas";
import { defineOperationSpec } from "./operation";
import { defineOperationResourceSpec } from "./resource";

export const sequenceResource = defineOperationResourceSpec({
	id: "sequence",
	title: "Headless email sequence",
	states: ["active", "paused", "deleted"],
	transitions: {
		active: ["paused", "deleted"],
		paused: ["active", "deleted"],
		deleted: [],
	},
	terminalStates: ["deleted"],
});

const sequenceRuntimeFile = "packages/automation/src/sequence-operations.ts";
const sequenceSpecFile = "packages/operations/src/specs/sequences.ts";

function graphNodes(name: string) {
	const title = name[0]?.toUpperCase() + name.slice(1);
	return {
		descriptorNode: `${sequenceSpecFile}#sequence${title}OperationSpec:variable`,
		bindingNode: `${sequenceSpecFile}#bindSequence${title}OperationSpec:function`,
		runtimeDefinitionNode: `${sequenceRuntimeFile}#sequence${title}Operation:variable`,
		invokerNode: `${sequenceRuntimeFile}#invokeSequence${title}Operation:function`,
		executorNode: `${sequenceRuntimeFile}#executeSequence${title}Operation:function`,
	};
}

export const sequenceValidateOperationSpec = defineOperationSpec({
	id: "sequences.validate",
	resource: "sequence",
	verb: "validate",
	title: "Validate sequence definition",
	description:
		"Validate typed send, wait, wait-until, condition, and stop steps without persisting a sequence.",
	contract: {
		input: sequenceValidateInputContract,
		output: sequenceValidateOutputContract,
	},
	effects: [{ kind: "read", resource: "sequence" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: { kind: "safe", reason: "Validation is pure and does not write state." },
	agent: {
		useWhen: ["A sequence definition must be checked before it is created or updated."],
		avoidWhen: ["The sequence has already been validated and persistence is required."],
		prerequisites: [],
		verifyWith: [],
		related: ["sequences.create", "sequences.update"],
		retryGuidance: "Retrying validation is safe.",
	},
	projection: {
		mcpName: "listmonk_sequences_validate",
		openWorld: false,
		graph: graphNodes("validate"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceCreateOperationSpec = defineOperationSpec({
	id: "sequences.create",
	resource: "sequence",
	verb: "create",
	title: "Create sequence",
	description:
		"Create an active sequence with an immutable first revision.",
	contract: {
		input: sequenceCreateInputContract,
		output: sequenceDefinitionOutputContract,
	},
	effects: [{ kind: "write", resource: "sequence", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason: "A retry may create another sequence unless the original ID is known.",
	},
	agent: {
		useWhen: ["A validated sequence definition must be persisted."],
		avoidWhen: ["An existing sequence should receive a new revision."],
		prerequisites: ["sequences.validate"],
		verifyWith: ["sequences.get"],
		related: ["sequences.update", "sequences.enroll"],
		retryGuidance: "Inspect sequences.list before retrying an ambiguous create.",
	},
	projection: {
		mcpName: "listmonk_sequences_create",
		openWorld: false,
		graph: graphNodes("create"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceUpdateOperationSpec = defineOperationSpec({
	id: "sequences.update",
	resource: "sequence",
	verb: "update",
	title: "Create sequence revision",
	description:
		"Append an immutable revision while existing enrollments stay pinned to their original revision.",
	contract: {
		input: sequenceUpdateInputContract,
		output: sequenceDefinitionOutputContract,
	},
	effects: [{ kind: "write", resource: "sequence", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason: "Repeating the update appends another revision.",
	},
	agent: {
		useWhen: ["Future enrollments need a revised sequence definition."],
		avoidWhen: ["Running enrollments should be mutated in place."],
		prerequisites: ["sequences.get", "sequences.validate"],
		verifyWith: ["sequences.get"],
		related: ["sequences.pause", "sequences.enroll"],
		retryGuidance: "Read the current revision before retrying an ambiguous update.",
	},
	projection: {
		mcpName: "listmonk_sequences_update",
		openWorld: false,
		graph: graphNodes("update"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceListOperationSpec = defineOperationSpec({
	id: "sequences.list",
	resource: "sequence",
	verb: "list",
	title: "List sequences",
	description: "List sequence definitions and their current revisions.",
	contract: {
		input: sequenceListInputContract,
		output: sequenceListOutputContract,
	},
	effects: [{ kind: "read", resource: "sequence" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: { kind: "safe", reason: "The operation only reads sequence state." },
	agent: {
		useWhen: ["Available sequences or their paused state must be discovered."],
		avoidWhen: ["One known sequence requires full revision detail."],
		prerequisites: [],
		verifyWith: [],
		related: ["sequences.get", "sequences.status"],
		retryGuidance: "Retrying the same read is safe.",
	},
	projection: {
		mcpName: "listmonk_sequences_list",
		openWorld: false,
		graph: graphNodes("list"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceGetOperationSpec = defineOperationSpec({
	id: "sequences.get",
	resource: "sequence",
	verb: "get",
	title: "Get sequence",
	description: "Get one sequence definition including immutable revisions.",
	contract: {
		input: sequenceIdInputContract,
		output: sequenceDefinitionOutputContract,
	},
	effects: [{ kind: "read", resource: "sequence" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: { kind: "safe", reason: "The operation only reads sequence state." },
	agent: {
		useWhen: ["A known sequence and its revision history must be inspected."],
		avoidWhen: ["The sequence ID is unknown."],
		prerequisites: [],
		verifyWith: [],
		related: ["sequences.list", "sequences.update", "sequences.enroll"],
		retryGuidance: "Retrying the same read is safe.",
	},
	projection: {
		mcpName: "listmonk_sequences_get",
		openWorld: false,
		graph: graphNodes("get"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceDeleteOperationSpec = defineOperationSpec({
	id: "sequences.delete",
	resource: "sequence",
	verb: "delete",
	title: "Delete sequence",
	description:
		"Delete a sequence only after all of its enrollments have reached terminal states.",
	contract: {
		input: sequenceIdInputContract,
		output: sequenceDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "sequence", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: { kind: "unsafe", reason: "A successful delete removes the resource." },
	agent: {
		useWhen: ["A retired sequence with no active enrollments must be removed."],
		avoidWhen: ["Any enrollment is pending, running, waiting, or paused."],
		prerequisites: ["sequences.get", "sequences.status"],
		verifyWith: ["sequences.list"],
		related: ["sequences.pause"],
		retryGuidance: "List sequences before retrying a response-lost delete.",
	},
	projection: {
		mcpName: "listmonk_sequences_delete",
		openWorld: false,
		graph: graphNodes("delete"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceEnrollOperationSpec = defineOperationSpec({
	id: "sequences.enroll",
	resource: "sequence",
	verb: "enroll",
	title: "Enroll subscriber in sequence",
	description:
		"Pin one subscriber to the current immutable sequence revision and schedule its first step.",
	contract: {
		input: sequenceEnrollInputContract,
		output: sequenceEnrollmentOutputContract,
	},
	effects: [
		{
			kind: "delivery",
			resource: "sequence",
			audience: "single",
			timing: "scheduled",
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "sequences.status",
		idempotent: false,
		reason: "A retry can create another enrollment after a terminal run.",
	},
	agent: {
		useWhen: ["A known subscriber should enter a reviewed active sequence."],
		avoidWhen: ["The sequence is paused or subscriber consent is uncertain."],
		prerequisites: ["sequences.get"],
		verifyWith: ["sequences.status"],
		related: ["sequences.tick", "sequences.pause"],
		retryGuidance: "Inspect sequence state before retrying enrollment.",
	},
	projection: {
		mcpName: "listmonk_sequences_enroll",
		openWorld: false,
		graph: graphNodes("enroll"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequencePauseOperationSpec = defineOperationSpec({
	id: "sequences.pause",
	resource: "sequence",
	verb: "pause",
	title: "Pause sequence",
	description:
		"Pause new enrollment execution while preserving durable enrollment state.",
	contract: {
		input: sequenceIdInputContract,
		output: sequenceDefinitionOutputContract,
	},
	state: {
		resource: "sequence",
		from: ["active"],
		to: "paused",
		allowNoopFromTarget: true,
	},
	effects: [{ kind: "write", resource: "sequence", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "Pausing an already paused sequence is a no-op." },
	agent: {
		useWhen: ["Sequence execution must stop claiming new due enrollments."],
		avoidWhen: ["An individual ambiguous send needs reconciliation."],
		prerequisites: ["sequences.get"],
		verifyWith: ["sequences.get"],
		related: ["sequences.resume", "sequences.reconcile"],
		retryGuidance: "Retrying the same pause is safe.",
	},
	projection: {
		mcpName: "listmonk_sequences_pause",
		openWorld: false,
		graph: graphNodes("pause"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceResumeOperationSpec = defineOperationSpec({
	id: "sequences.resume",
	resource: "sequence",
	verb: "resume",
	title: "Resume sequence",
	description: "Resume claiming due enrollments for a paused sequence.",
	contract: {
		input: sequenceIdInputContract,
		output: sequenceDefinitionOutputContract,
	},
	state: {
		resource: "sequence",
		from: ["paused"],
		to: "active",
		allowNoopFromTarget: true,
	},
	effects: [{ kind: "write", resource: "sequence", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "Resuming an active sequence is a no-op." },
	agent: {
		useWhen: ["A reviewed paused sequence may continue processing."],
		avoidWhen: ["The cause of the pause remains unresolved."],
		prerequisites: ["sequences.get", "sequences.status"],
		verifyWith: ["sequences.get"],
		related: ["sequences.pause", "sequences.tick"],
		retryGuidance: "Retrying the same resume is safe.",
	},
	projection: {
		mcpName: "listmonk_sequences_resume",
		openWorld: false,
		graph: graphNodes("resume"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceTickOperationSpec = defineOperationSpec({
	id: "sequences.tick",
	resource: "sequence",
	verb: "tick",
	title: "Run sequence worker tick",
	description:
		"Claim a bounded due-enrollment batch and execute one typed step per enrollment.",
	contract: {
		input: sequenceTickInputContract,
		output: sequenceTickOutputContract,
	},
	effects: [
		{
			kind: "delivery",
			resource: "sequence",
			audience: "bulk",
			timing: "immediate",
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "sequences.reconcile",
		idempotent: false,
		reason:
			"Transactional idempotency prevents duplicate sends, but expired leases and ambiguous results must be reconciled first.",
	},
	agent: {
		useWhen: ["Due sequence enrollments should execute in a bounded batch."],
		avoidWhen: ["Runtime health is degraded or ambiguous sends are unresolved."],
		prerequisites: ["sequences.status"],
		verifyWith: ["sequences.status"],
		related: ["sequences.reconcile", "sequences.pause"],
		retryGuidance: "Run reconcile and inspect status before retrying a failed tick.",
	},
	projection: {
		mcpName: "listmonk_sequences_tick",
		openWorld: true,
		graph: graphNodes("tick"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceReconcileOperationSpec = defineOperationSpec({
	id: "sequences.reconcile",
	resource: "sequence",
	verb: "reconcile",
	title: "Reconcile sequence runtime",
	description:
		"Preview or recover expired enrollment leases, or explicitly resolve one ambiguous send.",
	contract: {
		input: sequenceReconcileInputContract,
		output: sequenceReconcileOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "sequence",
			action: "recover",
			destructive: false,
		},
		{
			kind: "maintenance",
			resource: "sequence",
			action: "resolve",
			destructive: true,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "reconcile",
		reconcileWith: "sequences.status",
		idempotent: false,
		reason:
			"Lease recovery is idempotent, but ambiguous-send resolution changes delivery state and must be verified before retrying.",
	},
	agent: {
		useWhen: ["Expired leases or an operator-reviewed ambiguous send need recovery."],
		avoidWhen: ["The delivery outcome of an ambiguous send is still unknown."],
		prerequisites: ["sequences.status"],
		verifyWith: ["sequences.status"],
		related: ["sequences.tick", "sequences.pause"],
		retryGuidance: "Dry-run first; repeated lease recovery is safe.",
	},
	projection: {
		mcpName: "listmonk_sequences_reconcile",
		openWorld: false,
		graph: graphNodes("reconcile"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceStatusOperationSpec = defineOperationSpec({
	id: "sequences.status",
	resource: "sequence",
	verb: "status",
	title: "Inspect sequence runtime health",
	description:
		"Inspect durable schema, definitions, enrollment states, due work, leases, and worker heartbeats.",
	contract: {
		input: sequenceStatusInputContract,
		output: sequenceStatusOutputContract,
	},
	effects: [{ kind: "read", resource: "sequence" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: { kind: "safe", reason: "The operation only reads runtime state." },
	agent: {
		useWhen: ["Sequence worker readiness or stalled work must be inspected."],
		avoidWhen: ["A sequence definition rather than runtime health is needed."],
		prerequisites: [],
		verifyWith: [],
		related: ["sequences.tick", "sequences.reconcile", "sequences.list"],
		retryGuidance: "Retrying the same status read is safe.",
	},
	projection: {
		mcpName: "listmonk_sequences_status",
		openWorld: false,
		graph: graphNodes("status"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export const sequenceOperationSpecs = [
	sequenceValidateOperationSpec,
	sequenceCreateOperationSpec,
	sequenceUpdateOperationSpec,
	sequenceListOperationSpec,
	sequenceGetOperationSpec,
	sequenceDeleteOperationSpec,
	sequenceEnrollOperationSpec,
	sequencePauseOperationSpec,
	sequenceResumeOperationSpec,
	sequenceTickOperationSpec,
	sequenceReconcileOperationSpec,
	sequenceStatusOperationSpec,
] as const;

export function bindSequenceValidateOperationSpec(): typeof sequenceValidateOperationSpec {
	return sequenceValidateOperationSpec;
}
export function bindSequenceCreateOperationSpec(): typeof sequenceCreateOperationSpec {
	return sequenceCreateOperationSpec;
}
export function bindSequenceUpdateOperationSpec(): typeof sequenceUpdateOperationSpec {
	return sequenceUpdateOperationSpec;
}
export function bindSequenceListOperationSpec(): typeof sequenceListOperationSpec {
	return sequenceListOperationSpec;
}
export function bindSequenceGetOperationSpec(): typeof sequenceGetOperationSpec {
	return sequenceGetOperationSpec;
}
export function bindSequenceDeleteOperationSpec(): typeof sequenceDeleteOperationSpec {
	return sequenceDeleteOperationSpec;
}
export function bindSequenceEnrollOperationSpec(): typeof sequenceEnrollOperationSpec {
	return sequenceEnrollOperationSpec;
}
export function bindSequencePauseOperationSpec(): typeof sequencePauseOperationSpec {
	return sequencePauseOperationSpec;
}
export function bindSequenceResumeOperationSpec(): typeof sequenceResumeOperationSpec {
	return sequenceResumeOperationSpec;
}
export function bindSequenceTickOperationSpec(): typeof sequenceTickOperationSpec {
	return sequenceTickOperationSpec;
}
export function bindSequenceReconcileOperationSpec(): typeof sequenceReconcileOperationSpec {
	return sequenceReconcileOperationSpec;
}
export function bindSequenceStatusOperationSpec(): typeof sequenceStatusOperationSpec {
	return sequenceStatusOperationSpec;
}
