import {
	emptyInputContract,
	systemReloadOutputContract,
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

/**
 * Listmonk 6.2 applies settings by restarting itself: POST /api/admin/reload
 * acknowledges, then re-executes the process after 500ms (cmd/admin.go
 * ReloadApp, cmd/init.go awaitReload). The restart closes the campaign
 * manager, so running campaigns are interrupted and transactional messages
 * still queued in memory are dropped although /api/tx already accepted
 * them. Unlike the settings save, which skips its automatic restart while a
 * campaign runs, this endpoint restarts unconditionally.
 */
export const systemReloadOperationSpec = defineOperationSpec({
	id: "system.reload",
	resource: "system",
	verb: "reload",
	title: "Restart Listmonk to apply settings",
	description:
		"Restart the Listmonk process so saved settings take effect. Listmonk 6.2 re-executes itself shortly after acknowledging, interrupting running campaigns and dropping transactional messages still queued in memory; each request restarts it again.",
	contract: {
		input: emptyInputContract,
		output: systemReloadOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "system",
			action: "restart",
			destructive: true,
			preview: false,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"Every request restarts the Listmonk process again, interrupting running campaigns and dropping queued transactional messages. The acknowledgement is sent before the restart, so a lost response does not mean the restart failed.",
	},
	agent: {
		useWhen: [
			"Saved settings must take effect, no campaign is running, and transactional sending can pause for the restart.",
		],
		avoidWhen: [
			"A campaign is running — the restart interrupts it, which is why Listmonk's own settings save skips its automatic restart while campaigns run.",
			"Transactional messages were accepted moments ago — messages still queued in memory are dropped by the restart.",
			"No settings changed since the last restart.",
		],
		prerequisites: ["settings.get", "campaigns.list"],
		verifyWith: ["system.about"],
		related: ["settings.get", "system.about", "campaigns.list"],
		retryGuidance:
			"Do not repeat blindly: every request restarts Listmonk again. After a lost response, wait until system.about answers before deciding whether another restart is still needed.",
	},
	projection: {
		mcpName: "listmonk_reload_app",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/system-specs.ts#systemReloadOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/system-specs.ts#bindSystemReloadOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/system.ts#reloadSystemOperation:variable",
			invokerNode:
				"packages/operations/src/system.ts#invokeReloadSystemOperation:function",
			executorNode:
				"packages/operations/src/system.ts#reloadSystem:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindSystemReloadOperationSpec(): typeof systemReloadOperationSpec {
	return systemReloadOperationSpec;
}

export function bindSystemLogsOperationSpec(): typeof systemLogsOperationSpec {
	return systemLogsOperationSpec;
}
