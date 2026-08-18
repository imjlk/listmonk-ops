import {
	controlCapabilitiesOutputContract,
	controlPrimeInputContract,
	controlPrimeOutputContract,
	controlStatusInputContract,
	controlStatusOutputContract,
	emptyInputContract,
	playbookGetInputContract,
	playbookGetOutputContract,
	playbookListOutputContract,
	specDescribeInputContract,
	specDescribeOutputContract,
	specSearchInputContract,
	specSearchOutputContract,
} from "./contract-schemas";
import { defineOperationSpec } from "./operation";
import { defineOperationResourceSpec } from "./resource";

export const specResource = defineOperationResourceSpec({
	id: "spec",
	title: "Operation specification",
	states: ["available"],
	transitions: { available: [] },
	terminalStates: [],
});

export const playbookResource = defineOperationResourceSpec({
	id: "playbook",
	title: "Operation playbook",
	states: ["available"],
	transitions: { available: [] },
	terminalStates: [],
});

export const controlResource = defineOperationResourceSpec({
	id: "control",
	title: "Operations control plane",
	states: ["ready"],
	transitions: { ready: [] },
	terminalStates: [],
});

export const specSearchOperationSpec = defineOperationSpec({
	id: "specs.search",
	resource: "spec",
	verb: "search",
	title: "Search operation specs",
	description:
		"Search shared Listmonk operation contracts and agent guidance by intent, family, resource, or verb.",
	contract: {
		input: specSearchInputContract,
		output: specSearchOutputContract,
	},
	effects: [{ kind: "read", resource: "spec" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason:
			"The operation deterministically searches immutable in-process catalog metadata.",
	},
	agent: {
		useWhen: [
			"The agent knows an operational intent but not the exact operation or MCP tool name.",
		],
		avoidWhen: [
			"The exact operation ID is already known and its complete contract is required.",
		],
		prerequisites: [],
		verifyWith: [],
		related: ["specs.describe", "control.prime", "playbooks.list"],
		retryGuidance: "Retrying the same catalog search is safe.",
	},
	projection: {
		mcpName: "listmonk_schema_search",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/discovery.ts#specSearchOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/discovery.ts#bindSpecSearchOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/discovery.ts#specSearchOperation:variable",
			invokerNode:
				"packages/operations/src/discovery.ts#invokeSpecSearchOperation:function",
			executorNode:
				"packages/operations/src/discovery.ts#searchOperationSpecs:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const specDescribeOperationSpec = defineOperationSpec({
	id: "specs.describe",
	resource: "spec",
	verb: "describe",
	title: "Describe operation spec",
	description:
		"Describe one shared operation by operation ID or MCP tool name, including safety, retry, and agent guidance.",
	contract: {
		input: specDescribeInputContract,
		output: specDescribeOutputContract,
	},
	effects: [{ kind: "read", resource: "spec" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason:
			"The operation reads immutable in-process catalog metadata without side effects.",
	},
	agent: {
		useWhen: [
			"The exact operation ID or MCP tool name is known and the full contract must be inspected before execution.",
		],
		avoidWhen: ["The agent is still searching for the correct operation."],
		prerequisites: [],
		verifyWith: [],
		related: ["specs.search", "control.capabilities", "playbooks.get"],
		retryGuidance: "Retrying the same catalog lookup is safe.",
	},
	projection: {
		mcpName: "listmonk_schema_describe",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/discovery.ts#specDescribeOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/discovery.ts#bindSpecDescribeOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/discovery.ts#specDescribeOperation:variable",
			invokerNode:
				"packages/operations/src/discovery.ts#invokeSpecDescribeOperation:function",
			executorNode:
				"packages/operations/src/discovery.ts#describeOperationSpec:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const playbookListOperationSpec = defineOperationSpec({
	id: "playbooks.list",
	resource: "playbook",
	verb: "list",
	title: "List operation playbooks",
	description:
		"List typed operation playbooks that encode safe multi-step Listmonk workflows.",
	contract: {
		input: emptyInputContract,
		output: playbookListOutputContract,
	},
	effects: [{ kind: "read", resource: "playbook" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation reads immutable in-process playbook metadata.",
	},
	agent: {
		useWhen: [
			"The agent needs a predefined safe workflow instead of composing raw operations.",
		],
		avoidWhen: ["A single exact operation is sufficient for the requested task."],
		prerequisites: [],
		verifyWith: [],
		related: ["playbooks.get", "control.prime", "specs.search"],
		retryGuidance: "Retrying the same playbook listing is safe.",
	},
	projection: {
		mcpName: "listmonk_list_playbooks",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/discovery.ts#playbookListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/discovery.ts#bindPlaybookListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/discovery.ts#playbookListOperation:variable",
			invokerNode:
				"packages/operations/src/discovery.ts#invokePlaybookListOperation:function",
			executorNode:
				"packages/operations/src/discovery.ts#listOperationPlaybooks:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const playbookGetOperationSpec = defineOperationSpec({
	id: "playbooks.get",
	resource: "playbook",
	verb: "get",
	title: "Get operation playbook",
	description:
		"Get a typed operation playbook and the operation contracts referenced by its steps.",
	contract: {
		input: playbookGetInputContract,
		output: playbookGetOutputContract,
	},
	effects: [{ kind: "read", resource: "playbook" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation reads immutable in-process playbook metadata.",
	},
	agent: {
		useWhen: [
			"A known playbook must be inspected before executing any of its steps.",
		],
		avoidWhen: ["The agent has not yet selected a playbook."],
		prerequisites: ["playbooks.list"],
		verifyWith: [],
		related: ["specs.describe", "control.prime"],
		retryGuidance: "Retrying the same playbook lookup is safe.",
	},
	projection: {
		mcpName: "listmonk_playbook_get",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/discovery.ts#playbookGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/discovery.ts#bindPlaybookGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/discovery.ts#playbookGetOperation:variable",
			invokerNode:
				"packages/operations/src/discovery.ts#invokePlaybookGetOperation:function",
			executorNode:
				"packages/operations/src/discovery.ts#getOperationPlaybook:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const controlCapabilitiesOperationSpec = defineOperationSpec({
	id: "control.capabilities",
	resource: "control",
	verb: "capabilities",
	title: "Get control-plane capabilities",
	description:
		"Summarize shared operation families, typed specification coverage, resources, and playbooks.",
	contract: {
		input: emptyInputContract,
		output: controlCapabilitiesOutputContract,
	},
	effects: [{ kind: "read", resource: "control" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation deterministically summarizes immutable catalog metadata.",
	},
	agent: {
		useWhen: [
			"The agent must discover the breadth and typed coverage of the current listmonk-ops installation.",
		],
		avoidWhen: ["Live Listmonk connectivity is the only readiness question."],
		prerequisites: [],
		verifyWith: [],
		related: ["control.status", "control.prime", "specs.search"],
		retryGuidance: "Retrying the same capability inspection is safe.",
	},
	projection: {
		mcpName: "listmonk_capabilities",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/discovery.ts#controlCapabilitiesOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/discovery.ts#bindControlCapabilitiesOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/discovery.ts#controlCapabilitiesOperation:variable",
			invokerNode:
				"packages/operations/src/discovery.ts#invokeControlCapabilitiesOperation:function",
			executorNode:
				"packages/operations/src/discovery.ts#getControlCapabilities:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const controlPrimeOperationSpec = defineOperationSpec({
	id: "control.prime",
	resource: "control",
	verb: "prime",
	title: "Prime an operations agent",
	description:
		"Return installation capabilities and goal-oriented operation and playbook recommendations for an AI agent.",
	contract: {
		input: controlPrimeInputContract,
		output: controlPrimeOutputContract,
	},
	effects: [{ kind: "read", resource: "control" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason:
			"The operation deterministically derives recommendations from immutable catalog metadata.",
	},
	agent: {
		useWhen: [
			"An agent is beginning an email operations task and needs a compact, goal-oriented starting context.",
		],
		avoidWhen: ["The exact operation contract is already known."],
		prerequisites: [],
		verifyWith: ["control.status"],
		related: ["specs.search", "playbooks.list", "control.capabilities"],
		retryGuidance: "Retrying the same prime request is safe.",
	},
	projection: {
		mcpName: "listmonk_prime",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/discovery.ts#controlPrimeOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/discovery.ts#bindControlPrimeOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/discovery.ts#controlPrimeOperation:variable",
			invokerNode:
				"packages/operations/src/discovery.ts#invokeControlPrimeOperation:function",
			executorNode:
				"packages/operations/src/discovery.ts#primeOperationsAgent:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const controlStatusOperationSpec = defineOperationSpec({
	id: "control.status",
	resource: "control",
	verb: "status",
	title: "Get control-plane status",
	description:
		"Check catalog integrity, typed specification coverage, runtime identity, and live Listmonk connectivity.",
	contract: {
		input: controlStatusInputContract,
		output: controlStatusOutputContract,
	},
	effects: [{ kind: "read", resource: "control" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason:
			"The operation performs read-only local checks and a Listmonk health probe.",
	},
	agent: {
		useWhen: [
			"The agent must confirm the current surface and Listmonk target are ready before operational work.",
		],
		avoidWhen: ["Only static catalog capabilities are required."],
		prerequisites: [],
		verifyWith: [],
		related: ["control.capabilities", "control.prime"],
		retryGuidance:
			"Retry transient health failures with normal backoff; do not infer authentication from reachability alone.",
	},
	projection: {
		mcpName: "listmonk_status",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/discovery.ts#controlStatusOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/discovery.ts#bindControlStatusOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/discovery.ts#controlStatusOperation:variable",
			invokerNode:
				"packages/operations/src/discovery.ts#invokeControlStatusOperation:function",
			executorNode:
				"packages/operations/src/discovery.ts#getControlStatus:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const catalogReadOperationSpecs = [
	specSearchOperationSpec,
	specDescribeOperationSpec,
	playbookListOperationSpec,
	playbookGetOperationSpec,
	controlCapabilitiesOperationSpec,
	controlPrimeOperationSpec,
] as const;

export const discoveryOperationSpecs = [
	...catalogReadOperationSpecs,
	controlStatusOperationSpec,
] as const;

export function bindSpecSearchOperationSpec(): typeof specSearchOperationSpec {
	return specSearchOperationSpec;
}

export function bindSpecDescribeOperationSpec(): typeof specDescribeOperationSpec {
	return specDescribeOperationSpec;
}

export function bindPlaybookListOperationSpec(): typeof playbookListOperationSpec {
	return playbookListOperationSpec;
}

export function bindPlaybookGetOperationSpec(): typeof playbookGetOperationSpec {
	return playbookGetOperationSpec;
}

export function bindControlCapabilitiesOperationSpec(): typeof controlCapabilitiesOperationSpec {
	return controlCapabilitiesOperationSpec;
}

export function bindControlPrimeOperationSpec(): typeof controlPrimeOperationSpec {
	return controlPrimeOperationSpec;
}

export function bindControlStatusOperationSpec(): typeof controlStatusOperationSpec {
	return controlStatusOperationSpec;
}
