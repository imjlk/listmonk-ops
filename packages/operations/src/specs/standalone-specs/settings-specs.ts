import {
	emptyInputContract,
	settingsGetOutputContract,
} from "../contract-schemas";
import { defineOperationSpec } from "../operation";

/**
 * A redacted installation-settings read. The raw document carries SMTP
 * passwords, S3 keys, and OIDC client secrets; the shared read replaces
 * every credential-bearing field with "[redacted]" before it leaves the
 * executor, so no surface can persist or leak them.
 */
export const settingsGetOperationSpec = defineOperationSpec({
	id: "settings.get",
	resource: "settings",
	verb: "get",
	title: "Read installation settings (redacted)",
	description:
		"Read the Listmonk installation settings with every credential-bearing field (passwords, secrets, API keys, tokens) recursively replaced by [redacted].",
	contract: {
		input: emptyInputContract,
		output: settingsGetOutputContract,
	},
	effects: [{ kind: "read", resource: "settings" }],
	policy: {
		confirmation: "never",
		audit: "optional",
		dryRun: false,
	},
	retry: {
		kind: "safe",
		reason: "The operation only reads the current settings document.",
	},
	agent: {
		useWhen: [
			"Delivery, privacy, upload, or security configuration must be inspected; credentials never are — they are redacted before the result leaves the executor.",
		],
		avoidWhen: [
			"The unredacted document is required — no shared surface exposes it.",
		],
		prerequisites: [],
		verifyWith: [],
		related: ["system.about", "providers.status"],
		retryGuidance: "Retry transient read failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_get_settings",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/standalone-specs/settings-specs.ts#settingsGetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/standalone-specs/settings-specs.ts#bindSettingsGetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/operations/src/settings.ts#getSettingsOperation:variable",
			invokerNode:
				"packages/operations/src/settings.ts#invokeGetSettingsOperation:function",
			executorNode:
				"packages/operations/src/settings.ts#readSettings:function",
		},
	},
	stability: "stable",
	since: "0.17.0",
});

export function bindSettingsGetOperationSpec(): typeof settingsGetOperationSpec {
	return settingsGetOperationSpec;
}
