import type { ListmonkClient } from "@listmonk-ops/openapi";
import { z } from "zod";
import {
	evaluateDeliverabilityGuard,
	type CampaignPreflightResult,
	type DeliverabilityGuardResult,
	runCampaignPreflight,
} from "./campaign.js";
import { generateDailyDigest, type DailyDigestResult } from "./digest.js";
import {
	runSubscriberHygiene,
	type SubscriberHygieneResult,
} from "./hygiene.js";
import {
	runSegmentDriftSnapshot,
	type SegmentDriftResult,
} from "./segment-drift.js";
import {
	getTemplateRegistryHistory,
	promoteTemplateVersion,
	rollbackTemplateVersion,
	syncTemplateRegistry,
	type TemplatePromoteResult,
	type TemplateRegistrySyncResult,
} from "./template-registry.js";
import { getOpsStorePaths } from "./core.js";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "@listmonk-ops/operations";

export interface OpsOperationContext {
	client?: ListmonkClient;
}

function requireOpsClient(context: OpsOperationContext): ListmonkClient {
	if (!context.client) {
		throw new Error("This operation requires a Listmonk client");
	}
	return context.client;
}

const numberInput = () =>
	z.preprocess(
		(value: unknown) =>
			value === null || value === "" || typeof value === "boolean"
				? Number.NaN
				: value,
		z.coerce.number().finite(),
	);
const positiveIntegerInput = numberInput().pipe(z.number().int().positive());
const nonNegativeNumberInput = numberInput().pipe(z.number().min(0));
const nonNegativeIntegerInput = numberInput().pipe(
	z.number().int().nonnegative(),
);
const thresholdInput = numberInput().pipe(z.number().min(0).max(1));

const booleanInput = z.preprocess(
	(value: unknown) => {
		if (typeof value !== "string") {
			return value;
		}
		if (value.toLowerCase() === "true") {
			return true;
		}
		if (value.toLowerCase() === "false") {
			return false;
		}
		return value;
	},
	z.boolean(),
);

const storePathsSchema = z.object({
	segmentStorePath: z.string(),
	templateRegistryPath: z.string(),
});

const campaignPreflightInputSchema = z.object({
	campaign_id: positiveIntegerInput.describe("Campaign ID"),
	max_audience: positiveIntegerInput
		.default(200_000)
		.describe("Warning threshold for audience size"),
	check_links: booleanInput
		.default(false)
		.describe("Check outbound links in campaign body"),
	link_check_timeout_ms: positiveIntegerInput
		.default(4_000)
		.describe("Timeout for each outbound link check in milliseconds"),
});

const deliverabilityGuardInputSchema = z.object({
	campaign_id: positiveIntegerInput.describe("Campaign ID"),
	bounce_threshold: thresholdInput
		.default(0.05)
		.describe("Maximum allowed bounce rate"),
	open_threshold: thresholdInput
		.default(0.08)
		.describe("Minimum required open rate"),
	click_threshold: thresholdInput
		.default(0.01)
		.describe("Minimum required click rate"),
	pause_on_breach: booleanInput
		.default(false)
		.describe("Pause a running or scheduled campaign when breached"),
});

const subscriberHygieneInputSchema = z.object({
	mode: z.enum(["winback", "sunset"]).default("winback"),
	inactivity_days: positiveIntegerInput
		.default(90)
		.describe("Inactive threshold in days"),
	source_list_ids: z
		.array(positiveIntegerInput)
		.optional()
		.describe("Optional source list IDs"),
	target_list_id: positiveIntegerInput
		.optional()
		.describe("Target list ID for subscriber tagging"),
	blocklist: booleanInput
		.default(false)
		.describe("Blocklist sunset candidates"),
	dry_run: booleanInput
		.default(true)
		.describe("Preview candidates without mutating subscribers"),
	max_subscribers: positiveIntegerInput
		.default(500)
		.describe("Maximum candidates to process"),
});

const segmentDriftInputSchema = z.object({
	list_ids: z
		.array(positiveIntegerInput)
		.optional()
		.describe("Optional list IDs to monitor"),
	threshold: nonNegativeNumberInput
		.default(0.2)
		.describe("Relative drift threshold"),
	min_absolute_change: nonNegativeIntegerInput
		.default(50)
		.describe("Minimum absolute subscriber delta for an alert"),
	lookback_days: positiveIntegerInput
		.default(14)
		.describe("Baseline lookback window in days"),
});

const templateRegistrySyncInputSchema = z.object({
	template_ids: z
		.array(positiveIntegerInput)
		.optional()
		.describe("Optional template IDs to sync"),
	note: z.string().trim().optional().describe("Snapshot note"),
});

const templateIdInputSchema = z.object({
	template_id: positiveIntegerInput.describe("Template ID"),
});

const templatePromoteInputSchema = templateIdInputSchema.extend({
	version_id: z.string().trim().min(1).describe("Stored version ID"),
});

const dailyDigestInputSchema = z.object({
	hours: positiveIntegerInput.default(24).describe("Digest window in hours"),
	bounce_threshold: thresholdInput
		.default(0.05)
		.describe("Maximum allowed bounce rate"),
	open_threshold: thresholdInput
		.default(0.08)
		.describe("Minimum required open rate"),
	click_threshold: thresholdInput
		.default(0.01)
		.describe("Minimum required click rate"),
});

const checkSchema = z.object({
	id: z.string(),
	level: z.enum(["pass", "warn", "fail"]),
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});

const campaignPreflightOutputSchema = z.object({
	campaignId: z.number().int().positive(),
	campaignName: z.string(),
	status: z.string(),
	audienceEstimate: z.number().nonnegative(),
	checkedAt: z.string(),
	checks: z.array(checkSchema),
	summary: z.object({
		pass: z.number().int().nonnegative(),
		warn: z.number().int().nonnegative(),
		fail: z.number().int().nonnegative(),
	}),
});

const deliverabilityGuardOutputSchema = z.object({
	campaignId: z.number().int().positive(),
	campaignName: z.string(),
	status: z.string(),
	checkedAt: z.string(),
	metrics: z.object({
		sent: z.number().nonnegative(),
		toSend: z.number().nonnegative(),
		views: z.number().nonnegative(),
		clicks: z.number().nonnegative(),
		bounces: z.number().nonnegative(),
		bounceRate: z.number().nonnegative(),
		openRate: z.number().nonnegative(),
		clickRate: z.number().nonnegative(),
	}),
	thresholds: z.object({
		bounceRate: z.number().nonnegative(),
		openRate: z.number().nonnegative(),
		clickRate: z.number().nonnegative(),
	}),
	breaches: z.array(z.string()),
	paused: z.boolean(),
});

const subscriberHygieneOutputSchema = z.object({
	mode: z.enum(["winback", "sunset"]),
	cutoffAt: z.string(),
	dryRun: z.boolean(),
	totalSubscribersScanned: z.number().int().nonnegative(),
	candidateSubscribers: z.number().int().nonnegative(),
	processedSubscribers: z.number().int().nonnegative(),
	skippedDueToLimit: z.number().int().nonnegative(),
	targetListId: z.number().int().positive().optional(),
	blocklist: z.boolean(),
	sample: z.array(
		z.object({
			id: z.number().int().positive(),
			email: z.string(),
			updated_at: z.string().optional(),
		}),
	),
	errors: z.array(z.string()),
});

const segmentDriftComparisonSchema = z.object({
	listId: z.number().int().positive(),
	listName: z.string(),
	previousCount: z.number().nonnegative().optional(),
	currentCount: z.number().nonnegative(),
	baselineCount: z.number().nonnegative().optional(),
	delta: z.number().optional(),
	deltaRate: z.number().optional(),
	alert: z.boolean(),
});

const segmentDriftOutputSchema = z.object({
	capturedAt: z.string(),
	storePath: z.string(),
	threshold: z.number().nonnegative(),
	minAbsoluteChange: z.number().nonnegative(),
	comparisons: z.array(segmentDriftComparisonSchema),
	alerts: z.array(segmentDriftComparisonSchema),
});

const templateRegistryVersionSchema = z.object({
	versionId: z.string(),
	capturedAt: z.string(),
	hash: z.string(),
	note: z.string().optional(),
	snapshot: z.object({
		id: z.number().int().positive(),
		name: z.string(),
		type: z.string(),
		subject: z.string(),
		body: z.string(),
		bodySource: z.string().optional(),
	}),
});

const templateRegistrySyncOutputSchema = z.object({
	storePath: z.string(),
	capturedAt: z.string(),
	createdVersions: z.number().int().nonnegative(),
	unchangedTemplates: z.number().int().nonnegative(),
	errors: z.array(z.string()),
	templates: z.array(
		z.object({
			templateId: z.number().int().positive(),
			templateName: z.string(),
			versionId: z.string().optional(),
			changed: z.boolean(),
			hash: z.string(),
		}),
	),
	storePaths: storePathsSchema,
});

const templateRegistryHistoryOutputSchema = z.object({
	storePath: z.string(),
	templateId: z.number().int().positive(),
	templateName: z.string(),
	activeVersionId: z.string().optional(),
	versions: z.array(templateRegistryVersionSchema),
});

const templatePromoteOutputSchema = z.object({
	templateId: z.number().int().positive(),
	templateName: z.string(),
	versionId: z.string(),
	activeVersionId: z.string(),
	promotedAt: z.string(),
});

const dailyDigestOutputSchema = z.object({
	generatedAt: z.string(),
	window: z.object({
		hours: z.number().positive(),
		from: z.string(),
		to: z.string(),
	}),
	metrics: z.object({
		lists: z.number().int().nonnegative(),
		subscribers: z.number().int().nonnegative(),
		subscriberStatus: z.record(z.string(), z.number().int().nonnegative()),
		campaigns: z.number().int().nonnegative(),
		runningCampaigns: z.number().int().nonnegative(),
		campaignsCreatedInWindow: z.number().int().nonnegative(),
		sent: z.number().nonnegative(),
		views: z.number().nonnegative(),
		clicks: z.number().nonnegative(),
		bouncesInWindow: z.number().int().nonnegative(),
	}),
	risk: z.object({
		campaignBreaches: z.array(
			z.object({
				campaignId: z.number().int().positive(),
				campaignName: z.string(),
				breaches: z.array(z.string()),
			}),
		),
	}),
	markdown: z.string(),
	storePaths: storePathsSchema,
});

const readSafety = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const localWriteSafety = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const mutationSafety = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
} as const;

export async function executeCampaignPreflightOperation(
	context: OpsOperationContext,
	input: z.output<typeof campaignPreflightInputSchema>,
): Promise<CampaignPreflightResult> {
	const client = requireOpsClient(context);
	return runCampaignPreflight(client, input.campaign_id, {
		maxAudience: input.max_audience,
		checkLinks: input.check_links,
		linkCheckTimeoutMs: input.link_check_timeout_ms,
	});
}

export async function executeDeliverabilityGuardOperation(
	context: OpsOperationContext,
	input: z.output<typeof deliverabilityGuardInputSchema>,
): Promise<DeliverabilityGuardResult> {
	const client = requireOpsClient(context);
	return evaluateDeliverabilityGuard(client, input.campaign_id, {
		bounceThreshold: input.bounce_threshold,
		openRateThreshold: input.open_threshold,
		clickRateThreshold: input.click_threshold,
		pauseOnBreach: input.pause_on_breach,
	});
}

export async function executeSubscriberHygieneOperation(
	context: OpsOperationContext,
	input: z.output<typeof subscriberHygieneInputSchema>,
): Promise<SubscriberHygieneResult> {
	const client = requireOpsClient(context);
	return runSubscriberHygiene(client, {
		mode: input.mode,
		inactivityDays: input.inactivity_days,
		sourceListIds: input.source_list_ids,
		targetListId: input.target_list_id,
		blocklist: input.blocklist,
		dryRun: input.dry_run,
		maxSubscribers: input.max_subscribers,
	});
}

export async function executeSegmentDriftOperation(
	context: OpsOperationContext,
	input: z.output<typeof segmentDriftInputSchema>,
): Promise<SegmentDriftResult> {
	const client = requireOpsClient(context);
	return runSegmentDriftSnapshot(client, {
		listIds: input.list_ids,
		threshold: input.threshold,
		minAbsoluteChange: input.min_absolute_change,
		lookbackDays: input.lookback_days,
	});
}

export async function executeTemplateRegistrySyncOperation(
	context: OpsOperationContext,
	input: z.output<typeof templateRegistrySyncInputSchema>,
): Promise<TemplateRegistrySyncResult & { storePaths: ReturnType<typeof getOpsStorePaths> }> {
	const client = requireOpsClient(context);
	const result = await syncTemplateRegistry(client, {
		templateIds: input.template_ids,
		note: input.note,
	});
	return { ...result, storePaths: getOpsStorePaths() };
}

export async function executeTemplateRegistryHistoryOperation(
	_context: OpsOperationContext,
	input: z.output<typeof templateIdInputSchema>,
) {
	return getTemplateRegistryHistory(input.template_id);
}

export async function executeTemplateRegistryPromoteOperation(
	context: OpsOperationContext,
	input: z.output<typeof templatePromoteInputSchema>,
): Promise<TemplatePromoteResult> {
	const client = requireOpsClient(context);
	return promoteTemplateVersion(client, input.template_id, input.version_id);
}

export async function executeTemplateRegistryRollbackOperation(
	context: OpsOperationContext,
	input: z.output<typeof templateIdInputSchema>,
): Promise<TemplatePromoteResult> {
	const client = requireOpsClient(context);
	return rollbackTemplateVersion(client, input.template_id);
}

export async function executeDailyDigestOperation(
	context: OpsOperationContext,
	input: z.output<typeof dailyDigestInputSchema>,
): Promise<DailyDigestResult & { storePaths: ReturnType<typeof getOpsStorePaths> }> {
	const client = requireOpsClient(context);
	const result = await generateDailyDigest(client, {
		hours: input.hours,
		bounceThreshold: input.bounce_threshold,
		openRateThreshold: input.open_threshold,
		clickRateThreshold: input.click_threshold,
	});
	return { ...result, storePaths: getOpsStorePaths() };
}

export const campaignPreflightOperation = defineOperation({
	id: "ops.campaign.preflight",
	title: "Run campaign preflight",
	description: "Run pre-send checks against a Listmonk campaign",
	inputSchema: campaignPreflightInputSchema,
	outputSchema: campaignPreflightOutputSchema,
	safety: readSafety,
	mcp: { name: "listmonk_ops_preflight" },
	execute: executeCampaignPreflightOperation,
});

export const deliverabilityGuardOperation = defineOperation({
	id: "ops.campaign.deliverability-guard",
	title: "Evaluate deliverability guard",
	description:
		"Evaluate campaign deliverability metrics and optionally pause a breached campaign",
	inputSchema: deliverabilityGuardInputSchema,
	outputSchema: deliverabilityGuardOutputSchema,
	safety: mutationSafety,
	mcp: { name: "listmonk_ops_deliverability_guard" },
	execute: executeDeliverabilityGuardOperation,
});

export const subscriberHygieneOperation = defineOperation({
	id: "ops.subscribers.hygiene",
	title: "Run subscriber hygiene",
	description: "Run the winback or sunset subscriber hygiene workflow",
	inputSchema: subscriberHygieneInputSchema,
	outputSchema: subscriberHygieneOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_ops_subscriber_hygiene" },
	execute: executeSubscriberHygieneOperation,
});

export const segmentDriftOperation = defineOperation({
	id: "ops.segments.drift",
	title: "Detect segment drift",
	description: "Snapshot list sizes and detect subscriber-count drift",
	inputSchema: segmentDriftInputSchema,
	outputSchema: segmentDriftOutputSchema,
	safety: localWriteSafety,
	mcp: { name: "listmonk_ops_segment_drift" },
	execute: executeSegmentDriftOperation,
});

export const templateRegistrySyncOperation = defineOperation({
	id: "ops.templates.registry-sync",
	title: "Sync template registry",
	description: "Capture Listmonk templates in the local version registry",
	inputSchema: templateRegistrySyncInputSchema,
	outputSchema: templateRegistrySyncOutputSchema,
	safety: localWriteSafety,
	mcp: { name: "listmonk_ops_template_registry_sync" },
	execute: executeTemplateRegistrySyncOperation,
});

export const templateRegistryHistoryOperation = defineOperation({
	id: "ops.templates.registry-history",
	title: "Read template registry history",
	description: "Read stored template versions from the local registry",
	inputSchema: templateIdInputSchema,
	outputSchema: templateRegistryHistoryOutputSchema,
	safety: readSafety,
	mcp: { name: "listmonk_ops_template_registry_history" },
	execute: executeTemplateRegistryHistoryOperation,
});

export const templateRegistryPromoteOperation = defineOperation({
	id: "ops.templates.registry-promote",
	title: "Promote template version",
	description: "Promote a stored template version to active Listmonk content",
	inputSchema: templatePromoteInputSchema,
	outputSchema: templatePromoteOutputSchema,
	safety: mutationSafety,
	mcp: { name: "listmonk_ops_template_registry_promote" },
	execute: executeTemplateRegistryPromoteOperation,
});

export const templateRegistryRollbackOperation = defineOperation({
	id: "ops.templates.registry-rollback",
	title: "Rollback template version",
	description: "Rollback a Listmonk template to its previous stored version",
	inputSchema: templateIdInputSchema,
	outputSchema: templatePromoteOutputSchema,
	safety: mutationSafety,
	mcp: { name: "listmonk_ops_template_registry_rollback" },
	execute: executeTemplateRegistryRollbackOperation,
});

export const dailyDigestOperation = defineOperation({
	id: "ops.digest.daily",
	title: "Generate daily operations digest",
	description: "Generate a metrics and deliverability summary for an operations window",
	inputSchema: dailyDigestInputSchema,
	outputSchema: dailyDigestOutputSchema,
	safety: readSafety,
	mcp: { name: "listmonk_ops_daily_digest" },
	execute: executeDailyDigestOperation,
});

export const opsOperations = [
	campaignPreflightOperation,
	deliverabilityGuardOperation,
	subscriberHygieneOperation,
	segmentDriftOperation,
	templateRegistrySyncOperation,
	templateRegistryHistoryOperation,
	templateRegistryPromoteOperation,
	templateRegistryRollbackOperation,
	dailyDigestOperation,
] as const;

export type OpsOperation = (typeof opsOperations)[number];

const opsOperationsByMcpName = new Map<string, OpsOperation>(
	opsOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getOpsOperationByMcpName(
	name: string,
): OpsOperation | undefined {
	return opsOperationsByMcpName.get(name);
}

export async function invokeCampaignPreflightOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof campaignPreflightOutputSchema>> {
	const parsedInput = parseOperationInput(
		campaignPreflightOperation.inputSchema,
		input,
	);
	let output: CampaignPreflightResult;
	try {
		output = await executeCampaignPreflightOperation(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			campaignPreflightOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		campaignPreflightOperation.id,
		campaignPreflightOperation.outputSchema,
		output,
	);
}

export async function invokeDeliverabilityGuardOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof deliverabilityGuardOutputSchema>> {
	const parsedInput = parseOperationInput(
		deliverabilityGuardOperation.inputSchema,
		input,
	);
	let output: DeliverabilityGuardResult;
	try {
		output = await executeDeliverabilityGuardOperation(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			deliverabilityGuardOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		deliverabilityGuardOperation.id,
		deliverabilityGuardOperation.outputSchema,
		output,
	);
}

export async function invokeSubscriberHygieneOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof subscriberHygieneOutputSchema>> {
	const parsedInput = parseOperationInput(
		subscriberHygieneOperation.inputSchema,
		input,
	);
	let output: SubscriberHygieneResult;
	try {
		output = await executeSubscriberHygieneOperation(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			subscriberHygieneOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		subscriberHygieneOperation.id,
		subscriberHygieneOperation.outputSchema,
		output,
	);
}

export async function invokeSegmentDriftOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof segmentDriftOutputSchema>> {
	const parsedInput = parseOperationInput(
		segmentDriftOperation.inputSchema,
		input,
	);
	let output: SegmentDriftResult;
	try {
		output = await executeSegmentDriftOperation(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(segmentDriftOperation.id, error);
	}
	return parseOperationOutput(
		segmentDriftOperation.id,
		segmentDriftOperation.outputSchema,
		output,
	);
}

export async function invokeTemplateRegistrySyncOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof templateRegistrySyncOutputSchema>> {
	const parsedInput = parseOperationInput(
		templateRegistrySyncOperation.inputSchema,
		input,
	);
	let output: Awaited<ReturnType<typeof executeTemplateRegistrySyncOperation>>;
	try {
		output = await executeTemplateRegistrySyncOperation(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			templateRegistrySyncOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		templateRegistrySyncOperation.id,
		templateRegistrySyncOperation.outputSchema,
		output,
	);
}

export async function invokeTemplateRegistryHistoryOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof templateRegistryHistoryOutputSchema>> {
	const parsedInput = parseOperationInput(
		templateRegistryHistoryOperation.inputSchema,
		input,
	);
	let output: Awaited<ReturnType<typeof executeTemplateRegistryHistoryOperation>>;
	try {
		output = await executeTemplateRegistryHistoryOperation(
			context,
			parsedInput,
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			templateRegistryHistoryOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		templateRegistryHistoryOperation.id,
		templateRegistryHistoryOperation.outputSchema,
		output,
	);
}

export async function invokeTemplateRegistryPromoteOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof templatePromoteOutputSchema>> {
	const parsedInput = parseOperationInput(
		templateRegistryPromoteOperation.inputSchema,
		input,
	);
	let output: TemplatePromoteResult;
	try {
		output = await executeTemplateRegistryPromoteOperation(
			context,
			parsedInput,
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			templateRegistryPromoteOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		templateRegistryPromoteOperation.id,
		templateRegistryPromoteOperation.outputSchema,
		output,
	);
}

export async function invokeTemplateRegistryRollbackOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof templatePromoteOutputSchema>> {
	const parsedInput = parseOperationInput(
		templateRegistryRollbackOperation.inputSchema,
		input,
	);
	let output: TemplatePromoteResult;
	try {
		output = await executeTemplateRegistryRollbackOperation(
			context,
			parsedInput,
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			templateRegistryRollbackOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		templateRegistryRollbackOperation.id,
		templateRegistryRollbackOperation.outputSchema,
		output,
	);
}

export async function invokeDailyDigestOperation(
	context: OpsOperationContext,
	input: unknown,
): Promise<z.output<typeof dailyDigestOutputSchema>> {
	const parsedInput = parseOperationInput(
		dailyDigestOperation.inputSchema,
		input,
	);
	let output: Awaited<ReturnType<typeof executeDailyDigestOperation>>;
	try {
		output = await executeDailyDigestOperation(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(dailyDigestOperation.id, error);
	}
	return parseOperationOutput(
		dailyDigestOperation.id,
		dailyDigestOperation.outputSchema,
		output,
	);
}

export interface OpsOperationInvocation {
	operation: OpsOperation;
	output: Record<string, unknown>;
}

export async function invokeOpsOperationByMcpName(
	context: OpsOperationContext,
	name: string,
	input: unknown,
): Promise<OpsOperationInvocation | undefined> {
	switch (name) {
		case campaignPreflightOperation.mcp.name:
			return {
				operation: campaignPreflightOperation,
				output: await invokeCampaignPreflightOperation(context, input),
			};
		case deliverabilityGuardOperation.mcp.name:
			return {
				operation: deliverabilityGuardOperation,
				output: await invokeDeliverabilityGuardOperation(context, input),
			};
		case subscriberHygieneOperation.mcp.name:
			return {
				operation: subscriberHygieneOperation,
				output: await invokeSubscriberHygieneOperation(context, input),
			};
		case segmentDriftOperation.mcp.name:
			return {
				operation: segmentDriftOperation,
				output: await invokeSegmentDriftOperation(context, input),
			};
		case templateRegistrySyncOperation.mcp.name:
			return {
				operation: templateRegistrySyncOperation,
				output: await invokeTemplateRegistrySyncOperation(context, input),
			};
		case templateRegistryHistoryOperation.mcp.name:
			return {
				operation: templateRegistryHistoryOperation,
				output: await invokeTemplateRegistryHistoryOperation(context, input),
			};
		case templateRegistryPromoteOperation.mcp.name:
			return {
				operation: templateRegistryPromoteOperation,
				output: await invokeTemplateRegistryPromoteOperation(context, input),
			};
		case templateRegistryRollbackOperation.mcp.name:
			return {
				operation: templateRegistryRollbackOperation,
				output: await invokeTemplateRegistryRollbackOperation(context, input),
			};
		case dailyDigestOperation.mcp.name:
			return {
				operation: dailyDigestOperation,
				output: await invokeDailyDigestOperation(context, input),
			};
		default:
			return undefined;
	}
}
