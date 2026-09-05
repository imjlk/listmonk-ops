import {
	emptyInputContract,
	systemAboutOutputContract,
	systemLogsOutputContract,
} from "../contract-schemas";
import { defineOperationSpec } from "../operation";

/**
 * System reads are open-world observations: the normalized envelope is
 * stable, but versions, build details, and log contents reflect the
 * running server rather than guarantees.
 */
export const systemAboutOperationSpec = defineOperationSpec({
	id: "system.about",
	resource: "system",
	verb: "about",
	title: "Read server build identity",
	description:
		"Read the running Listmonk version, build, Go runtime, and host summary without any credentials.",
	contract: {
		input: emptyInputContract,
		output: systemAboutOutputContract,
	},
	effects: [{ kind: "read", resource: "system" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the running build identity.",
	},
	agent: {
		useWhen: [
			"The exact Listmonk version or build must be confirmed before a version-sensitive operation.",
		],
		avoidWhen: ["Only reachability matters — prefer control.status."],
		prerequisites: [],
		verifyWith: [],
		related: ["control.status", "system.logs"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_about",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/system-specs.ts#systemAboutOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/system-specs.ts#bindSystemAboutOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/system.ts#readSystemAboutOperation:variable",
			invokerNode:
				"packages/operations/src/system.ts#invokeReadSystemAboutOperation:function",
			executorNode:
				"packages/operations/src/system.ts#readSystemAbout:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export const systemLogsOperationSpec = defineOperationSpec({
	id: "system.logs",
	resource: "system",
	verb: "logs",
	title: "Read server logs",
	description:
		"Read the recent Listmonk server log lines as recorded by the running instance.",
	contract: {
		input: emptyInputContract,
		output: systemLogsOutputContract,
	},
	effects: [{ kind: "read", resource: "system" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads recorded server log lines.",
	},
	agent: {
		useWhen: [
			"Server-side startup, messenger, or importer behavior must be diagnosed from the instance's own log.",
		],
		avoidWhen: ["Import-session detail is enough — prefer subscribers.import.logs."],
		prerequisites: [],
		verifyWith: [],
		related: ["system.about", "subscribers.import.logs"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_logs",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/system-specs.ts#systemLogsOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/system-specs.ts#bindSystemLogsOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/system.ts#readSystemLogsOperation:variable",
			invokerNode:
				"packages/operations/src/system.ts#invokeReadSystemLogsOperation:function",
			executorNode:
				"packages/operations/src/system.ts#readSystemLogs:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindSystemAboutOperationSpec(): typeof systemAboutOperationSpec {
	return systemAboutOperationSpec;
}

export function bindSystemLogsOperationSpec(): typeof systemLogsOperationSpec {
	return systemLogsOperationSpec;
}
