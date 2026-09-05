import { defineOperationSpec } from "../operation";
import {
	templatePreviewInputContract,
	templatePreviewOutputContract,
	resourceIdInputContract,
	templateSetDefaultOutputContract,
	templateCreateInputContract,
	templateCreateOutputContract,
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
		output: templateCreateOutputContract,
	},
	effects: [{ kind: "write", resource: "template", reversible: true }],
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
						"The key is atomically claimed in a durable store before the create is issued and then bound to the created template id; an identical retry (same key, same request payload, same Listmonk target) replays that template with created: false, a concurrent same-key create waits for the in-flight one instead of issuing a second POST, and a different request or target under the same key is rejected. An attempt that ends ambiguously — or whose accepted response carries no id (template records have no uuid to correlate) — marks its claim unknown, and later same-key creates fail fast with reconciliation guidance: the key is intentionally not reused, because no name-based check can prove which same-named template a create produced.",
				},
			},
			{
				when: "idempotency_key is absent",
				semantics: {
					kind: "unsafe",
					reason:
						"Listmonk template names are not unique, so a retry after an ambiguous create provisions a duplicate template.",
				},
			},
		],
		reason:
			"Retry safety depends on whether the caller supplies an idempotency key.",
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
			"Key the create with idempotency_key so an ambiguous retry replays the bound template; without a key, verify with templates.list before repeating.",
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
	stability: "stable",
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
		idempotent: true,
		reason:
			"Deleting an already-deleted template is a documented no-op that reports deleted: false; the protected default template still fails explicitly. Verify with templates.list after an ambiguous result.",
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
			"Verify the template is gone with templates.list before retrying; an already-deleted template reports deleted: false without error.",
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
	stability: "stable",
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

export const templatesPreviewOperationSpec = defineOperationSpec({
	id: "templates.preview",
	resource: "template",
	verb: "preview",
	title: "Preview template",
	description:
		"Render the stored template to HTML exactly as campaign content would appear inside it, without sending anything.",
	contract: {
		input: templatePreviewInputContract,
		output: templatePreviewOutputContract,
	},
	effects: [{ kind: "read", resource: "template" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only renders the stored template body.",
	},
	agent: {
		useWhen: [
			"A template's rendered output must be inspected, typically before promotion or a campaign send.",
		],
		avoidWhen: ["A campaign's rendered body is what matters — prefer campaigns.preview."],
		prerequisites: ["templates.get"],
		verifyWith: [],
		related: ["templates.get", "campaigns.preview", "ops.campaign.preflight"],
		retryGuidance: "Retry transient render failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_preview_template",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/template-specs.ts#templatesPreviewOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/template-specs.ts#bindTemplatesPreviewOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/templates.ts#previewTemplateOperation:variable",
			invokerNode:
				"packages/operations/src/templates.ts#invokePreviewTemplateOperation:function",
			executorNode:
				"packages/operations/src/templates.ts#previewTemplate:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindTemplatesPreviewOperationSpec(): typeof templatesPreviewOperationSpec {
	return templatesPreviewOperationSpec;
}

export function bindTemplatesSetDefaultOperationSpec(): typeof templatesSetDefaultOperationSpec {
	return templatesSetDefaultOperationSpec;
}

export function bindTemplatesReconcileOperationSpec(): typeof templatesReconcileOperationSpec {
	return templatesReconcileOperationSpec;
}
