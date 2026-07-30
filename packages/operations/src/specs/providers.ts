import {
	deliverabilityDnsCheckOutputContract,
	deliverabilityDoctorOutputContract,
	providerIdInputContract,
	providerListInputContract,
	providerListOutputContract,
	providerQuotaOutputContract,
	providerStatusOutputContract,
	providerTestOutputContract,
	providerWebhookStatusInputContract,
	providerWebhookStatusOutputContract,
} from "./contract-schemas";
import { defineOperationSpec } from "./operation";
import { defineOperationResourceSpec } from "./resource";

export const providerResource = defineOperationResourceSpec({
	id: "provider",
	title: "Email delivery provider",
	states: ["configured", "healthy", "degraded", "unavailable"],
	transitions: {
		configured: ["healthy", "degraded", "unavailable"],
		healthy: ["degraded", "unavailable"],
		degraded: ["healthy", "unavailable"],
		unavailable: ["healthy", "degraded"],
	},
	terminalStates: [],
});

const readPolicy = {
	confirmation: "never",
	audit: "optional",
	dryRun: false,
} as const;

export const providerListOperationSpec = defineOperationSpec({
	id: "providers.list",
	resource: "provider",
	verb: "list",
	title: "List provider profiles",
	description:
		"List configured provider profiles without exposing credential references.",
	contract: {
		input: providerListInputContract,
		output: providerListOutputContract,
	},
	effects: [{ kind: "read", resource: "provider" }],
	policy: readPolicy,
	retry: {
		kind: "safe",
		reason:
			"The operation only reads and validates the local provider configuration.",
	},
	agent: {
		useWhen: [
			"The agent must discover configured delivery provider IDs before running diagnostics.",
		],
		avoidWhen: ["The provider ID is already known."],
		prerequisites: [],
		verifyWith: [],
		related: ["providers.status", "deliverability.doctor"],
		retryGuidance:
			"Retry after the provider configuration file becomes readable or valid.",
	},
	projection: {
		mcpName: "listmonk_providers_list",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/providers.ts#providerListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/providers.ts#bindProviderListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/provider-operations.ts#providerListOperation:variable",
			invokerNode:
				"packages/automation/src/provider-operations.ts#invokeProviderListOperation:function",
			executorNode:
				"packages/automation/src/provider-operations.ts#executeProviderListOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const providerStatusOperationSpec = defineOperationSpec({
	id: "providers.status",
	resource: "provider",
	verb: "status",
	title: "Inspect provider status",
	description:
		"Inspect provider account, identity, and Listmonk delivery configuration.",
	contract: {
		input: providerIdInputContract,
		output: providerStatusOutputContract,
	},
	effects: [{ kind: "read", resource: "provider" }],
	policy: readPolicy,
	retry: {
		kind: "safe",
		reason:
			"Provider and Listmonk API calls are read-only and do not send messages.",
	},
	agent: {
		useWhen: [
			"The agent needs a structured provider and Listmonk readiness snapshot.",
		],
		avoidWhen: [
			"Only raw SES quota values or DNS records are required.",
		],
		prerequisites: ["providers.list"],
		verifyWith: [],
		related: [
			"providers.test",
			"providers.quota",
			"providers.webhook-status",
			"deliverability.doctor",
		],
		retryGuidance:
			"Retry transient Listmonk or provider failures with normal backoff.",
	},
	projection: {
		mcpName: "listmonk_providers_status",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/providers.ts#providerStatusOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/providers.ts#bindProviderStatusOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/provider-operations.ts#providerStatusOperation:variable",
			invokerNode:
				"packages/automation/src/provider-operations.ts#invokeProviderStatusOperation:function",
			executorNode:
				"packages/automation/src/provider-operations.ts#executeProviderStatusOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const providerTestOperationSpec = defineOperationSpec({
	id: "providers.test",
	resource: "provider",
	verb: "test",
	title: "Test provider API access",
	description:
		"Run a bounded read-only provider API authentication and connectivity probe without sending mail.",
	contract: {
		input: providerIdInputContract,
		output: providerTestOutputContract,
	},
	effects: [{ kind: "read", resource: "provider" }],
	policy: readPolicy,
	retry: {
		kind: "safe",
		reason: "The probe uses only the provider account read API.",
	},
	agent: {
		useWhen: [
			"Provider credentials or API reachability must be checked without sending a message.",
		],
		avoidWhen: [
			"An actual mailbox delivery or SMTP transaction test is required.",
		],
		prerequisites: ["providers.list"],
		verifyWith: [],
		related: ["providers.status", "providers.quota"],
		retryGuidance:
			"Retry throttling and transient network failures with bounded backoff.",
	},
	projection: {
		mcpName: "listmonk_providers_test",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/providers.ts#providerTestOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/providers.ts#bindProviderTestOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/provider-operations.ts#providerTestOperation:variable",
			invokerNode:
				"packages/automation/src/provider-operations.ts#invokeProviderTestOperation:function",
			executorNode:
				"packages/automation/src/provider-operations.ts#executeProviderTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const providerQuotaOperationSpec = defineOperationSpec({
	id: "providers.quota",
	resource: "provider",
	verb: "quota",
	title: "Inspect provider sending quota",
	description:
		"Read provider daily quota, rate limit, usage, sandbox, and enforcement status.",
	contract: {
		input: providerIdInputContract,
		output: providerQuotaOutputContract,
	},
	effects: [{ kind: "read", resource: "provider" }],
	policy: readPolicy,
	retry: {
		kind: "safe",
		reason: "The provider quota API is read-only.",
	},
	agent: {
		useWhen: [
			"An audience or sequence send must be compared with current provider capacity.",
		],
		avoidWhen: ["The provider has no supported quota adapter."],
		prerequisites: ["providers.list"],
		verifyWith: [],
		related: ["providers.status", "deliverability.doctor"],
		retryGuidance:
			"Retry transient provider failures; do not assume cached quotas remain current.",
	},
	projection: {
		mcpName: "listmonk_providers_quota",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/providers.ts#providerQuotaOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/providers.ts#bindProviderQuotaOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/provider-operations.ts#providerQuotaOperation:variable",
			invokerNode:
				"packages/automation/src/provider-operations.ts#invokeProviderQuotaOperation:function",
			executorNode:
				"packages/automation/src/provider-operations.ts#executeProviderQuotaOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const providerWebhookStatusOperationSpec = defineOperationSpec({
	id: "providers.webhook-status",
	resource: "provider",
	verb: "webhook-status",
	title: "Inspect provider webhook status",
	description:
		"Inspect Listmonk bounce webhook configuration and the latest provider event freshness.",
	contract: {
		input: providerWebhookStatusInputContract,
		output: providerWebhookStatusOutputContract,
	},
	effects: [{ kind: "read", resource: "provider" }],
	policy: readPolicy,
	retry: {
		kind: "safe",
		reason:
			"The operation reads Listmonk settings and the latest matching bounce event.",
	},
	agent: {
		useWhen: [
			"Bounce or complaint feedback configuration and recent evidence must be checked.",
		],
		avoidWhen: [
			"A missing event is being treated as proof of failure without first running a provider simulator test.",
		],
		prerequisites: ["providers.list"],
		verifyWith: [],
		related: ["providers.status", "deliverability.doctor"],
		retryGuidance:
			"Retry Listmonk read failures; an unknown freshness result requires a simulator test rather than blind retries.",
	},
	projection: {
		mcpName: "listmonk_providers_webhook_status",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/providers.ts#providerWebhookStatusOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/providers.ts#bindProviderWebhookStatusOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/provider-operations.ts#providerWebhookStatusOperation:variable",
			invokerNode:
				"packages/automation/src/provider-operations.ts#invokeProviderWebhookStatusOperation:function",
			executorNode:
				"packages/automation/src/provider-operations.ts#executeProviderWebhookStatusOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const deliverabilityDnsCheckOperationSpec = defineOperationSpec({
	id: "deliverability.dns-check",
	resource: "provider",
	verb: "dns-check",
	title: "Check provider DNS",
	description:
		"Resolve DMARC, DKIM, custom MAIL FROM SPF/MX, and alignment records for a provider profile.",
	contract: {
		input: providerIdInputContract,
		output: deliverabilityDnsCheckOutputContract,
	},
	effects: [{ kind: "read", resource: "provider" }],
	policy: readPolicy,
	retry: {
		kind: "safe",
		reason: "DNS resolution is read-only.",
	},
	agent: {
		useWhen: [
			"The agent must verify public authentication records for a configured sending identity.",
		],
		avoidWhen: [
			"The agent intends to mutate DNS or infer propagation from one failed lookup.",
		],
		prerequisites: ["providers.list"],
		verifyWith: [],
		related: ["providers.status", "deliverability.doctor"],
		retryGuidance:
			"Retry transient resolver failures after normal DNS propagation delay; this operation never changes records.",
	},
	projection: {
		mcpName: "listmonk_deliverability_dns_check",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/providers.ts#deliverabilityDnsCheckOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/providers.ts#bindDeliverabilityDnsCheckOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/provider-operations.ts#deliverabilityDnsCheckOperation:variable",
			invokerNode:
				"packages/automation/src/provider-operations.ts#invokeDeliverabilityDnsCheckOperation:function",
			executorNode:
				"packages/automation/src/provider-operations.ts#executeDeliverabilityDnsCheckOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const deliverabilityDoctorOperationSpec = defineOperationSpec({
	id: "deliverability.doctor",
	resource: "provider",
	verb: "doctor",
	title: "Run deliverability doctor",
	description:
		"Compose provider, Listmonk, quota, webhook, and DNS diagnostics into one readiness report.",
	contract: {
		input: providerWebhookStatusInputContract,
		output: deliverabilityDoctorOutputContract,
	},
	effects: [{ kind: "read", resource: "provider" }],
	policy: readPolicy,
	retry: {
		kind: "safe",
		reason:
			"The doctor composes only read-only provider, Listmonk, and DNS checks.",
	},
	agent: {
		useWhen: [
			"An agent must determine whether a provider profile is ready before scheduling or launching email.",
		],
		avoidWhen: [
			"The caller expects the operation to repair provider, DNS, or Listmonk configuration automatically.",
		],
		prerequisites: ["providers.list"],
		verifyWith: [],
		related: [
			"providers.status",
			"providers.quota",
			"providers.webhook-status",
			"deliverability.dns-check",
			"ops.campaign.preflight",
		],
		retryGuidance:
			"Retry transient reads; fix reported failures explicitly and rerun the doctor before delivery.",
	},
	projection: {
		mcpName: "listmonk_deliverability_doctor",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/providers.ts#deliverabilityDoctorOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/providers.ts#bindDeliverabilityDoctorOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/provider-operations.ts#deliverabilityDoctorOperation:variable",
			invokerNode:
				"packages/automation/src/provider-operations.ts#invokeDeliverabilityDoctorOperation:function",
			executorNode:
				"packages/automation/src/provider-operations.ts#executeDeliverabilityDoctorOperation:function",
		},
	},
	stability: "experimental",
	since: "0.10.0",
});

export const providerOperationSpecs = [
	providerListOperationSpec,
	providerStatusOperationSpec,
	providerTestOperationSpec,
	providerQuotaOperationSpec,
	providerWebhookStatusOperationSpec,
	deliverabilityDnsCheckOperationSpec,
	deliverabilityDoctorOperationSpec,
] as const;

export function bindProviderListOperationSpec(): typeof providerListOperationSpec {
	return providerListOperationSpec;
}

export function bindProviderStatusOperationSpec(): typeof providerStatusOperationSpec {
	return providerStatusOperationSpec;
}

export function bindProviderTestOperationSpec(): typeof providerTestOperationSpec {
	return providerTestOperationSpec;
}

export function bindProviderQuotaOperationSpec(): typeof providerQuotaOperationSpec {
	return providerQuotaOperationSpec;
}

export function bindProviderWebhookStatusOperationSpec(): typeof providerWebhookStatusOperationSpec {
	return providerWebhookStatusOperationSpec;
}

export function bindDeliverabilityDnsCheckOperationSpec(): typeof deliverabilityDnsCheckOperationSpec {
	return deliverabilityDnsCheckOperationSpec;
}

export function bindDeliverabilityDoctorOperationSpec(): typeof deliverabilityDoctorOperationSpec {
	return deliverabilityDoctorOperationSpec;
}
