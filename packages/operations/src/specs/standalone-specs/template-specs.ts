import { defineOperationSpec } from "../operation";
import {
	resourceIdInputContract,
	templateSetDefaultOutputContract,
	templateCreateInputContract,
	templateUpdateInputContract,
	templateDeleteOutputContract,
	templateManifestReconcileInputContract,
	templateManifestReconcileOutputContract,
	templateRecordContract,
} from "../contract-schemas";

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
				"packages/operations/src/specs/standalone-specs/template-specs.ts#templatesCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/template-specs.ts#bindTemplatesCreateOperationSpec:function",
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
				"packages/operations/src/specs/standalone-specs/template-specs.ts#templatesUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/template-specs.ts#bindTemplatesUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#updateTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeUpdateTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#updateTemplate:function",
		},
	},
	stability: "stable",
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
				"packages/operations/src/specs/standalone-specs/template-specs.ts#templatesDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/template-specs.ts#bindTemplatesDeleteOperationSpec:function",
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
				"packages/operations/src/specs/standalone-specs/template-specs.ts#templatesSetDefaultOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/template-specs.ts#bindTemplatesSetDefaultOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#setDefaultTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokeSetDefaultTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#setDefaultTemplate:function",
		},
	},
	stability: "stable",
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
				"packages/operations/src/specs/standalone-specs/template-specs.ts#templatesReconcileOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/template-specs.ts#bindTemplatesReconcileOperationSpec:function",
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
