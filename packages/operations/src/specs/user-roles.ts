import {
	userRoleManifestReconcileInputContract,
	userRoleManifestReconcileOutputContract,
} from "./contract-schemas";
import { defineOperationSpec } from "./operation";
import { defineOperationResourceSpec } from "./resource";

export const userRoleResource = defineOperationResourceSpec({
	id: "user-role",
	title: "User role",
	// "protected" models Listmonk Super Admin (id 1), which reconcile refuses
	// to manage. Reconcile only ever moves roles between active and deleted.
	states: ["active", "protected", "deleted"],
	transitions: {
		active: ["deleted"],
		protected: [],
		deleted: [],
	},
	terminalStates: ["protected", "deleted"],
});

const userRoleRuntimeFile = "packages/operations/src/user-roles.ts";
const userRoleSpecFile = "packages/operations/src/specs/user-roles.ts";

function graphNodes(name: string) {
	const title = name[0]?.toUpperCase() + name.slice(1);
	return {
		descriptorNode: `${userRoleSpecFile}#userRole${title}OperationSpec:variable`,
		bindingNode: `${userRoleSpecFile}#bindUserRole${title}OperationSpec:function`,
		runtimeDefinitionNode: `${userRoleRuntimeFile}#reconcileUserRoleManifestOperation:variable`,
		invokerNode: `${userRoleRuntimeFile}#invokeReconcileUserRoleManifestOperation:function`,
		executorNode: `${userRoleRuntimeFile}#executeUserRoleManifestReconcile:function`,
	};
}

export const userRoleReconcileOperationSpec = defineOperationSpec({
	id: "user-roles.reconcile",
	resource: "user-role",
	verb: "reconcile",
	title: "Reconcile user-role manifest",
	description:
		"Plan or apply a versioned least-privilege user-role manifest against exact-name Listmonk user roles",
	contract: {
		input: userRoleManifestReconcileInputContract,
		output: userRoleManifestReconcileOutputContract,
	},
	effects: [
		{
			kind: "write",
			resource: "user-role",
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
		reconcileWith: "user-roles.reconcile",
		idempotent: true,
		reason: "Manifest apply is plan-then-apply; re-running reconcile re-plans the full desired state and converges on the manifest, but a partial remote failure must be inspected before retrying.",
	},
	agent: {
		useWhen: [
			"A versioned least-privilege user-role manifest must be planned or applied.",
		],
		avoidWhen: [
			"A single role should be inspected without a full manifest.",
			"The protected Super Admin role is the intended target.",
		],
		prerequisites: [],
		verifyWith: [],
		related: [],
		retryGuidance:
			"Re-run reconcile in dry-run mode after a partial apply to verify the remaining desired state before applying again.",
	},
	projection: {
		mcpName: "listmonk_reconcile_user_role_manifest",
		openWorld: true,
		graph: graphNodes("Reconcile"),
	},
	stability: "experimental",
	since: "0.9.0",
});

export function bindUserRoleReconcileOperationSpec(): typeof userRoleReconcileOperationSpec {
	return userRoleReconcileOperationSpec;
}

export const userRoleOperationSpecs = [userRoleReconcileOperationSpec] as const;
