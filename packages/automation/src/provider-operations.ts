import {
	defineOperation,
	defineOperationCatalog,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "@listmonk-ops/operations";
import {
	bindDeliverabilityDnsCheckOperationSpec,
	bindDeliverabilityDoctorOperationSpec,
	bindProviderListOperationSpec,
	bindProviderQuotaOperationSpec,
	bindProviderStatusOperationSpec,
	bindProviderTestOperationSpec,
	bindProviderWebhookStatusOperationSpec,
} from "@listmonk-ops/operations/specs";
import { z } from "zod";
import {
	inspectProviderDns,
	inspectProviderQuota,
	inspectProviderStatus,
	inspectProviderWebhook,
	runProviderDoctor,
	summarizeProviderProfile,
	testProviderApi,
	type ProviderInspectionContext,
} from "./provider-doctor";
import {
	createSesProviderInspector,
	getProviderProfile,
	loadProviderProfiles,
	type ProviderInspector,
	type ProviderProfile,
} from "./provider-profiles";

const readOnlyOpenWorldSafety = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const providerIdInput = z
	.string()
	.trim()
	.min(1)
	.max(80)
	.regex(/^[a-z][a-z0-9._-]*$/);
const providerIdInputSchema = z.object({ provider_id: providerIdInput });
const webhookStatusInputSchema = providerIdInputSchema.extend({
	max_age_hours: z.coerce.number().int().min(1).max(8_760).optional(),
});
const doctorInputSchema = webhookStatusInputSchema;
const emptyInputSchema = z.object({});

const doctorCheckSchema = z.object({
	id: z.string().min(1),
	status: z.enum(["pass", "warn", "fail", "unknown"]),
	message: z.string().min(1),
	details: z.record(z.string(), z.unknown()).optional(),
});
const providerSummarySchema = z.object({
	id: z.string().min(1),
	kind: z.enum(["ses", "smtp"]),
	messenger: z.string().min(1),
	sending_domain: z.string().min(1),
	from_email: z.email().optional(),
	region: z.string().min(1).optional(),
	smtp_hosts: z.array(z.string().min(1)),
	webhook_source: z.string().min(1),
	credential_reference_configured: z.boolean(),
});
const providerListOutputSchema = z.object({
	configured: z.boolean(),
	profiles: z.array(providerSummarySchema),
});
const providerApiProbeSchema = z.object({
	supported: z.boolean(),
	reachable: z.boolean(),
	authenticated: z.boolean(),
	latency_ms: z.number().int().nonnegative().optional(),
	error_code: z.string().min(1).optional(),
	error_message: z.string().min(1).optional(),
});
const providerAccountSchema = z.object({
	production_access_enabled: z.boolean().optional(),
	sending_enabled: z.boolean().optional(),
	enforcement_status: z.string().min(1).optional(),
	max_24_hour_send: z.number().optional(),
	max_send_rate: z.number().optional(),
	sent_last_24_hours: z.number().optional(),
	suppressed_reasons: z.array(z.string()),
});
const providerIdentitySchema = z.object({
	identity_type: z.string().min(1).optional(),
	verified_for_sending: z.boolean().optional(),
	verification_status: z.string().min(1).optional(),
	feedback_forwarding_enabled: z.boolean().optional(),
	dkim_signing_enabled: z.boolean().optional(),
	dkim_status: z.string().min(1).optional(),
	dkim_tokens: z.array(z.string()),
	mail_from_domain: z.string().min(1).optional(),
	mail_from_status: z.string().min(1).optional(),
	mail_from_behavior: z.string().min(1).optional(),
});
const listmonkProviderSchema = z.object({
	from_email: z.string().min(1).optional(),
	from_domain: z.string().min(1).optional(),
	messenger: z.string().min(1),
	smtp_hosts: z.array(z.string()),
	matching_smtp_hosts: z.array(z.string()),
	smtp_configured: z.boolean(),
	smtp_enabled: z.boolean(),
	unsubscribe_header_enabled: z.boolean(),
	bounce_processing_enabled: z.boolean(),
	bounce_webhooks_enabled: z.boolean(),
	provider_bounce_enabled: z.boolean().optional(),
});
const providerStatusOutputSchema = z.object({
	provider: providerSummarySchema,
	health: z.enum(["healthy", "degraded", "unavailable"]),
	checked_at: z.iso.datetime({ offset: true }),
	api: providerApiProbeSchema,
	account: providerAccountSchema.optional(),
	identity: providerIdentitySchema.optional(),
	listmonk: listmonkProviderSchema.optional(),
	checks: z.array(doctorCheckSchema),
});
const providerTestOutputSchema = z.object({
	provider_id: z.string().min(1),
	checked_at: z.iso.datetime({ offset: true }),
	probe: providerApiProbeSchema,
});
const providerQuotaOutputSchema = z.object({
	provider_id: z.string().min(1),
	supported: z.boolean(),
	checked_at: z.iso.datetime({ offset: true }),
	max_24_hour_send: z.number().optional(),
	max_send_rate: z.number().optional(),
	sent_last_24_hours: z.number().optional(),
	remaining_24_hours: z.number().optional(),
	utilization_percent: z.number().min(0).max(100).optional(),
	production_access_enabled: z.boolean().optional(),
	sending_enabled: z.boolean().optional(),
	enforcement_status: z.string().min(1).optional(),
});
const providerWebhookOutputSchema = z.object({
	provider_id: z.string().min(1),
	source: z.string().min(1),
	checked_at: z.iso.datetime({ offset: true }),
	max_age_hours: z.number().int().positive(),
	bounce_processing_enabled: z.boolean(),
	bounce_webhooks_enabled: z.boolean(),
	provider_bounce_enabled: z.boolean().optional(),
	last_event_at: z.iso.datetime({ offset: true }).optional(),
	last_event_type: z.string().min(1).optional(),
	freshness: z.enum(["fresh", "stale", "unknown"]),
	healthy: z.boolean(),
	checks: z.array(doctorCheckSchema),
});
const dnsObservationSchema = z.object({
	name: z.string().min(1),
	type: z.enum(["TXT", "CNAME", "MX"]),
	values: z.array(z.string()),
	error: z.string().min(1).optional(),
});
const providerDnsOutputSchema = z.object({
	provider_id: z.string().min(1),
	sending_domain: z.string().min(1),
	from_domain: z.string().min(1),
	mail_from_domain: z.string().min(1).optional(),
	checked_at: z.iso.datetime({ offset: true }),
	observations: z.array(dnsObservationSchema),
	checks: z.array(doctorCheckSchema),
	healthy: z.boolean(),
});
const doctorSummarySchema = z.object({
	pass: z.number().int().nonnegative(),
	warn: z.number().int().nonnegative(),
	fail: z.number().int().nonnegative(),
	unknown: z.number().int().nonnegative(),
});
const providerDoctorOutputSchema = z.object({
	provider_id: z.string().min(1),
	checked_at: z.iso.datetime({ offset: true }),
	ready: z.boolean(),
	summary: doctorSummarySchema,
	status: providerStatusOutputSchema,
	quota: providerQuotaOutputSchema,
	webhook: providerWebhookOutputSchema,
	dns: providerDnsOutputSchema,
	checks: z.array(doctorCheckSchema),
});

export interface ProviderOperationContext extends Omit<
	ProviderInspectionContext,
	"inspector"
> {
	profiles?:
		| readonly ProviderProfile[]
		| (() => Promise<readonly ProviderProfile[]>)
		| undefined;
	createInspector?:
		| ((profile: ProviderProfile) => ProviderInspector | undefined)
		| undefined;
}

async function operationProfiles(
	context: ProviderOperationContext,
): Promise<readonly ProviderProfile[]> {
	if (Array.isArray(context.profiles)) return context.profiles;
	if (typeof context.profiles === "function") return context.profiles();
	return loadProviderProfiles();
}

function operationInspector(
	context: ProviderOperationContext,
	profile: ProviderProfile,
): ProviderInspector | undefined {
	if (context.createInspector) return context.createInspector(profile);
	return profile.kind === "ses"
		? createSesProviderInspector(profile)
		: undefined;
}

async function withProfile<T>(
	context: ProviderOperationContext,
	providerId: string,
	execute: (
		profile: ProviderProfile,
		inspection: ProviderInspectionContext,
	) => Promise<T>,
): Promise<T> {
	const profile = getProviderProfile(
		await operationProfiles(context),
		providerId,
	);
	const inspector = operationInspector(context, profile);
	try {
		return await execute(profile, {
			client: context.client,
			dns: context.dns,
			now: context.now,
			inspector,
		});
	} finally {
		try {
			inspector?.close();
		} catch {
			// Cleanup must not replace the diagnostic result or primary failure.
		}
	}
}

export async function executeProviderListOperation(
	context: ProviderOperationContext,
	_input: z.output<typeof emptyInputSchema>,
) {
	const profiles = await operationProfiles(context);
	return {
		configured: profiles.length > 0,
		profiles: profiles.map(summarizeProviderProfile),
	};
}

export async function executeProviderStatusOperation(
	context: ProviderOperationContext,
	input: z.output<typeof providerIdInputSchema>,
) {
	return withProfile(context, input.provider_id, inspectProviderStatus);
}

export async function executeProviderTestOperation(
	context: ProviderOperationContext,
	input: z.output<typeof providerIdInputSchema>,
) {
	return withProfile(
		context,
		input.provider_id,
		async (profile, inspection) => ({
			provider_id: profile.id,
			checked_at: (inspection.now?.() ?? new Date()).toISOString(),
			probe: await testProviderApi(profile, inspection),
		}),
	);
}

export async function executeProviderQuotaOperation(
	context: ProviderOperationContext,
	input: z.output<typeof providerIdInputSchema>,
) {
	return withProfile(context, input.provider_id, inspectProviderQuota);
}

export async function executeProviderWebhookStatusOperation(
	context: ProviderOperationContext,
	input: z.output<typeof webhookStatusInputSchema>,
) {
	return withProfile(context, input.provider_id, (profile, inspection) =>
		inspectProviderWebhook(
			profile,
			inspection,
			input.max_age_hours ?? profile.webhook_max_age_hours,
		),
	);
}

export async function executeDeliverabilityDnsCheckOperation(
	context: ProviderOperationContext,
	input: z.output<typeof providerIdInputSchema>,
) {
	return withProfile(context, input.provider_id, async (profile, inspection) => {
		let identity;
		let identityUnavailable = false;
		if (inspection.inspector) {
			try {
				identity = await inspection.inspector.inspectIdentity();
			} catch {
				identityUnavailable = true;
			}
		}
		const result = await inspectProviderDns(profile, inspection, identity);
		if (!identityUnavailable) return result;
		return {
			...result,
			checks: [
				{
					id: "provider.identity",
					status: "unknown" as const,
					message:
						"Provider identity inspection was unavailable; DNS checks used configured selectors.",
				},
				...result.checks,
			],
		};
	});
}

export async function executeDeliverabilityDoctorOperation(
	context: ProviderOperationContext,
	input: z.output<typeof doctorInputSchema>,
) {
	return withProfile(context, input.provider_id, (profile, inspection) =>
		runProviderDoctor(
			profile,
			inspection,
			input.max_age_hours ?? profile.webhook_max_age_hours,
		),
	);
}

export const providerListOperation = defineOperation({
	id: "providers.list",
	title: "List provider profiles",
	description:
		"List configured provider profiles without exposing credential references.",
	inputSchema: emptyInputSchema,
	outputSchema: providerListOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_providers_list" },
	spec: bindProviderListOperationSpec(),
	execute: executeProviderListOperation,
});

export const providerStatusOperation = defineOperation({
	id: "providers.status",
	title: "Inspect provider status",
	description:
		"Inspect provider account, identity, and Listmonk delivery configuration.",
	inputSchema: providerIdInputSchema,
	outputSchema: providerStatusOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_providers_status" },
	spec: bindProviderStatusOperationSpec(),
	execute: executeProviderStatusOperation,
});

export const providerTestOperation = defineOperation({
	id: "providers.test",
	title: "Test provider API access",
	description:
		"Run a bounded read-only provider API authentication and connectivity probe without sending mail.",
	inputSchema: providerIdInputSchema,
	outputSchema: providerTestOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_providers_test" },
	spec: bindProviderTestOperationSpec(),
	execute: executeProviderTestOperation,
});

export const providerQuotaOperation = defineOperation({
	id: "providers.quota",
	title: "Inspect provider sending quota",
	description:
		"Read provider daily quota, rate limit, usage, sandbox, and enforcement status.",
	inputSchema: providerIdInputSchema,
	outputSchema: providerQuotaOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_providers_quota" },
	spec: bindProviderQuotaOperationSpec(),
	execute: executeProviderQuotaOperation,
});

export const providerWebhookStatusOperation = defineOperation({
	id: "providers.webhook-status",
	title: "Inspect provider webhook status",
	description:
		"Inspect Listmonk bounce webhook configuration and the latest provider event freshness.",
	inputSchema: webhookStatusInputSchema,
	outputSchema: providerWebhookOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_providers_webhook_status" },
	spec: bindProviderWebhookStatusOperationSpec(),
	execute: executeProviderWebhookStatusOperation,
});

export const deliverabilityDnsCheckOperation = defineOperation({
	id: "deliverability.dns-check",
	title: "Check provider DNS",
	description:
		"Resolve DMARC, DKIM, custom MAIL FROM SPF/MX, and alignment records for a provider profile.",
	inputSchema: providerIdInputSchema,
	outputSchema: providerDnsOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_deliverability_dns_check" },
	spec: bindDeliverabilityDnsCheckOperationSpec(),
	execute: executeDeliverabilityDnsCheckOperation,
});

export const deliverabilityDoctorOperation = defineOperation({
	id: "deliverability.doctor",
	title: "Run deliverability doctor",
	description:
		"Compose provider, Listmonk, quota, webhook, and DNS diagnostics into one readiness report.",
	inputSchema: doctorInputSchema,
	outputSchema: providerDoctorOutputSchema,
	safety: readOnlyOpenWorldSafety,
	mcp: { name: "listmonk_deliverability_doctor" },
	spec: bindDeliverabilityDoctorOperationSpec(),
	execute: executeDeliverabilityDoctorOperation,
});

export async function invokeProviderListOperation(
	context: ProviderOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(providerListOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			providerListOperation.id,
			providerListOperation.outputSchema,
			await executeProviderListOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(providerListOperation.id, error);
	}
}

export async function invokeProviderStatusOperation(
	context: ProviderOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		providerStatusOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			providerStatusOperation.id,
			providerStatusOperation.outputSchema,
			await executeProviderStatusOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(providerStatusOperation.id, error);
	}
}

export async function invokeProviderTestOperation(
	context: ProviderOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(providerTestOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			providerTestOperation.id,
			providerTestOperation.outputSchema,
			await executeProviderTestOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(providerTestOperation.id, error);
	}
}

export async function invokeProviderQuotaOperation(
	context: ProviderOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(providerQuotaOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			providerQuotaOperation.id,
			providerQuotaOperation.outputSchema,
			await executeProviderQuotaOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(providerQuotaOperation.id, error);
	}
}

export async function invokeProviderWebhookStatusOperation(
	context: ProviderOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		providerWebhookStatusOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			providerWebhookStatusOperation.id,
			providerWebhookStatusOperation.outputSchema,
			await executeProviderWebhookStatusOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			providerWebhookStatusOperation.id,
			error,
		);
	}
}

export async function invokeDeliverabilityDnsCheckOperation(
	context: ProviderOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		deliverabilityDnsCheckOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			deliverabilityDnsCheckOperation.id,
			deliverabilityDnsCheckOperation.outputSchema,
			await executeDeliverabilityDnsCheckOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			deliverabilityDnsCheckOperation.id,
			error,
		);
	}
}

export async function invokeDeliverabilityDoctorOperation(
	context: ProviderOperationContext,
	input: unknown,
) {
	const parsed = parseOperationInput(
		deliverabilityDoctorOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			deliverabilityDoctorOperation.id,
			deliverabilityDoctorOperation.outputSchema,
			await executeDeliverabilityDoctorOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			deliverabilityDoctorOperation.id,
			error,
		);
	}
}

const bindings = [
	{ operation: providerListOperation, invoke: invokeProviderListOperation },
	{ operation: providerStatusOperation, invoke: invokeProviderStatusOperation },
	{ operation: providerTestOperation, invoke: invokeProviderTestOperation },
	{ operation: providerQuotaOperation, invoke: invokeProviderQuotaOperation },
	{
		operation: providerWebhookStatusOperation,
		invoke: invokeProviderWebhookStatusOperation,
	},
	{
		operation: deliverabilityDnsCheckOperation,
		invoke: invokeDeliverabilityDnsCheckOperation,
	},
	{
		operation: deliverabilityDoctorOperation,
		invoke: invokeDeliverabilityDoctorOperation,
	},
] as const;

export const providerOperations = bindings.map(({ operation }) => operation);
export const providerOperationCatalog = defineOperationCatalog({
	id: "providers",
	title: "Provider and deliverability diagnostics",
	operations: providerOperations,
	specMigrationExemptions: [],
});

const byMcpName = new Map(
	bindings.map((binding) => [binding.operation.mcp.name, binding] as const),
);
if (byMcpName.size !== bindings.length) {
	throw new Error("Provider operations contain duplicate MCP tool names");
}

export function getProviderOperationByMcpName(name: string) {
	return byMcpName.get(name)?.operation;
}

export async function invokeProviderOperationByMcpName(
	context: ProviderOperationContext,
	name: string,
	input: unknown,
): Promise<
	| { operation: (typeof providerOperations)[number]; output: unknown }
	| undefined
> {
	const binding = byMcpName.get(name);
	if (!binding) return undefined;
	return {
		operation: binding.operation,
		output: await binding.invoke(context, input),
	};
}
