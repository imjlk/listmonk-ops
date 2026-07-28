import { defineProductOperation, type ProductContractSchema } from "../src";

const objectContract = {
	dialect: "openapi-3.1",
	stage: "normalized",
	schema: { type: "object" },
	components: {},
} as const satisfies ProductContractSchema;

defineProductOperation({
	id: "tests.read",
	resource: "campaign",
	verb: "get",
	title: "Valid read",
	description: "A valid read-only product operation",
	contract: { input: objectContract, output: objectContract },
	effects: [{ kind: "read", resource: "campaign" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: { kind: "safe", reason: "read only" },
	agent: {
		useWhen: ["reading"],
		avoidWhen: ["writing"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "retry",
	},
	projection: {
		mcpName: "listmonk_tests_read",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.invalid-delivery",
	resource: "campaign",
	verb: "schedule",
	title: "Invalid delivery",
	description: "Compile-time rejection fixture",
	contract: { input: objectContract, output: objectContract },
	effects: [
		{
			kind: "delivery",
			resource: "campaign",
			audience: "bulk",
			timing: "scheduled",
		},
	],
	// @ts-expect-error Delivery effects must require confirmation.
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_invalid_delivery",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.invalid-suppression",
	resource: "subscriber",
	verb: "blocklist",
	title: "Invalid suppression",
	description: "Compile-time rejection fixture",
	contract: { input: objectContract, output: objectContract },
	effects: [
		{
			kind: "suppression",
			resource: "subscriber",
			scope: "audience",
			reversible: true,
		},
	],
	// @ts-expect-error Suppression effects must expose dry-run.
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_invalid_suppression",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.write",
	resource: "template",
	verb: "update",
	title: "Valid write",
	description: "A valid audited write operation",
	contract: { input: objectContract, output: objectContract },
	effects: [{ kind: "write", resource: "template", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_write",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.irreversible-write.update",
	resource: "template",
	verb: "update",
	title: "Valid irreversible write",
	description: "An irreversible write requires confirmation",
	contract: { input: objectContract, output: objectContract },
	effects: [{ kind: "write", resource: "template", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_irreversible_write",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.invalid-irreversible-write.update",
	resource: "template",
	verb: "update",
	title: "Invalid irreversible write",
	description: "Compile-time rejection fixture",
	contract: { input: objectContract, output: objectContract },
	effects: [{ kind: "write", resource: "template", reversible: false }],
	// @ts-expect-error Irreversible writes must require confirmation.
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_invalid_irreversible_write",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.invalid-write",
	resource: "template",
	verb: "update",
	title: "Invalid write",
	description: "Compile-time rejection fixture",
	contract: { input: objectContract, output: objectContract },
	effects: [{ kind: "write", resource: "template", reversible: true }],
	// @ts-expect-error Write effects must require audit.
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_invalid_write",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.delete",
	resource: "campaign",
	verb: "delete",
	title: "Valid delete",
	description: "A valid confirmed delete operation",
	contract: { input: objectContract, output: objectContract },
	effects: [{ kind: "delete", resource: "campaign", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_delete",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});

defineProductOperation({
	id: "tests.invalid-delete",
	resource: "campaign",
	verb: "delete",
	title: "Invalid delete",
	description: "Compile-time rejection fixture",
	contract: { input: objectContract, output: objectContract },
	effects: [{ kind: "delete", resource: "campaign", reversible: false }],
	// @ts-expect-error Delete effects must require confirmation.
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: { kind: "safe", reason: "fixture" },
	agent: {
		useWhen: ["fixture"],
		avoidWhen: ["fixture"],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance: "fixture",
	},
	projection: {
		mcpName: "listmonk_tests_invalid_delete",
		openWorld: false,
		graph: {
			descriptorNode: "descriptor",
			bindingNode: "binding",
			runtimeDefinitionNode: "definition",
			invokerNode: "invoker",
			executorNode: "executor",
		},
	},
	stability: "experimental",
	since: "0.1.0",
});
