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
	type TemplateRollbackResult,
	type TemplateRegistrySyncResult,
} from "./template-registry.js";
import {
	defineOperationCatalog,
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "@listmonk-ops/operations";
import {
	bindOpsDailyDigestOperationSpec,
	bindOpsDeliverabilityGuardOperationSpec,
	bindOpsSubscriberHygieneOperationSpec,
	bindOpsTemplateRegistrySyncOperationSpec,
	bindOpsTemplateRegistryHistoryOperationSpec,
	bindOpsTemplateRegistryPromoteOperationSpec,
	bindOpsTemplateRegistryRollbackOperationSpec,
	bindOpsSegmentDriftOperationSpec,
	bindCampaignPreflightOperationSpec,
} from "@listmonk-ops/operations/specs";

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

const booleanInput = z.preprocess((value: unknown) => {
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
}, z.boolean());

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
	minimum_sent: positiveIntegerInput
		.default(100)
		.describe("Minimum sent count before engagement breaches are evaluated"),
	pause_on_breach: booleanInput
		.default(false)
		.describe("Pause a running or scheduled campaign when breached"),
});

// The object root is required by the operation schema system; the
// destructive variant's subscriber_ids requirement is enforced by
// superRefine at the boundary (the standalone contract models a union).
const subscriberHygieneInputSchema = z
	.object({
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
		subscriber_ids: z
			.array(
				positiveIntegerInput.refine(
					(value) => Number.isSafeInteger(value),
					"subscriber ids must be safe integers",
				),
			)
			.min(1)
			.max(10_000)
			.optional()
			.describe(
				"Exact candidate set reported by a dry run; required when dry_run is false so a retry processes nothing new",
			),
		dry_run: booleanInput
			.default(true)
			.describe("Preview candidates without mutating subscribers"),
		max_subscribers: positiveIntegerInput
			.refine(
				(value) => value <= 10_000,
				"max_subscribers must be at most 10000, matching the echoed subscriber_ids limit",
			)
			.default(500)
			.describe("Maximum candidates to process"),
	})
	.superRefine((value, context) => {
		if (!value.dry_run && value.subscriber_ids === undefined) {
			context.addIssue({
				code: "custom",
				path: ["subscriber_ids"],
				message:
					"Destructive hygiene runs require the exact subscriber ids a dry run reported; echo them so a retry processes nothing new",
			});
		}
	});

const templateRollbackInputSchema = z.object({
	template_id: positiveIntegerInput,
	to_version_id: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"Explicit rollback target from registry-history; pins the rollback so a retry after an intervening change fails instead of rolling to a different version",
		),
		from_version_id: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe(
				"Active registry version the caller observed (the registry-history activeVersionId output); a retry conflicts whenever the active version moved elsewhere. A cycle that promotes the original version back restores this pin's match — pair it with expected_head_revision to catch that transition",
			),
		expected_head_revision: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.describe(
				"Registry head revision the caller observed (the registry-history headRevision output, or the headRevision a prior rollback returned); every registry-managed write — a same-version re-promotion included — advances this counter, so a pinned retry conflicts instead of rolling again",
			),
	expected_remote_hash: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"Remote template hash the caller observed (registry-history remote hash); a template mutated outside the registry conflicts instead of being rolled back over",
		),
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
	baseline_mode: z
		.enum(["previous", "lookback-mean", "lookback-median"])
		.default("previous")
		.describe("How to compute the alert baseline"),
	sample_key: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.optional()
		.describe(
			"Sampling period key; re-running with the same key replaces that period's snapshots instead of appending, so retries never double-weight the sample",
		),
});

const templateRegistrySyncInputSchema = z.object({
	template_id: positiveIntegerInput
		.optional()
		.describe("Optional single template ID to sync"),
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
	expected_remote_hash: z
		.string()
		.optional()
		.describe("Expected remote template hash for optimistic concurrency"),
	force: booleanInput
		.default(false)
		.describe("Override hash mismatch check"),
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
	campaignUpdatedAt: z.string().trim().min(1),
	status: z.string(),
	audienceEstimate: z.number().int().nonnegative(),
	checkedAt: z.iso.datetime(),
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
	subscriberIds: z.array(z.number().int().positive()),
	targetListId: z.number().int().positive().optional(),
	blocklist: z.boolean(),
	sample: z.array(
		z.object({
			emailMasked: z.string(),
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
	threshold: z.number().nonnegative(),
	minAbsoluteChange: z.number().nonnegative(),
	replaced: z.number().int().nonnegative(),
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
});

const templateRegistryHistoryOutputSchema = z.object({
	templateId: z.number().int().positive(),
	templateName: z.string(),
	activeVersionId: z.string().optional(),
	headRevision: z.number().int().nonnegative(),
	versions: z.array(templateRegistryVersionSchema),
});

const templatePromoteOutputSchema = z.object({
	templateId: z.number().int().positive(),
	templateName: z.string(),
	versionId: z.string(),
	activeVersionId: z.string(),
	headRevision: z.number().int().nonnegative(),
	promotedAt: z.string(),
	promoted: z.boolean(),
});

const templateRollbackOutputSchema = z.object({
	templateId: z.number().int().positive(),
	templateName: z.string(),
	versionId: z.string(),
	activeVersionId: z.string(),
	headRevision: z.number().int().nonnegative(),
	promotedAt: z.string(),
	rolledBack: z.boolean(),
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
		campaignsEligible: z.number().int().nonnegative(),
		campaignsEvaluated: z.number().int().nonnegative(),
		truncated: z.boolean(),
	}),
	markdown: z.string(),
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

const nonIdempotentLocalWriteSafety = {
	...localWriteSafety,
	idempotentHint: false,
} as const;

const nonIdempotentMutationSafety = {
	...mutationSafety,
	idempotentHint: false,
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
		minimumSent: input.minimum_sent,
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
		subscriberIds: input.subscriber_ids,
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
		baselineMode: input.baseline_mode,
		sampleKey: input.sample_key,
	});
}

export async function executeTemplateRegistrySyncOperation(
	context: OpsOperationContext,
	input: z.output<typeof templateRegistrySyncInputSchema>,
): Promise<TemplateRegistrySyncResult> {
	const client = requireOpsClient(context);
	const result = await syncTemplateRegistry(client, {
		templateIds:
			input.template_id === undefined
				? input.template_ids
				: [...new Set([input.template_id, ...(input.template_ids ?? [])])],
		note: input.note,
	});
	return result;
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
	return promoteTemplateVersion(client, input.template_id, input.version_id, {
		expectedRemoteHash: input.expected_remote_hash?.trim() || undefined,
		force: input.force,
	});
}

export async function executeTemplateRegistryRollbackOperation(
	context: OpsOperationContext,
	input: z.output<typeof templateRollbackInputSchema>,
): Promise<TemplateRollbackResult> {
	const client = requireOpsClient(context);
	return rollbackTemplateVersion(client, input.template_id, {
		toVersionId: input.to_version_id,
		fromVersionId: input.from_version_id?.trim() || undefined,
		expectedHeadRevision: input.expected_head_revision,
		expectedRemoteHash: input.expected_remote_hash?.trim() || undefined,
	});
}

export async function executeDailyDigestOperation(
	context: OpsOperationContext,
	input: z.output<typeof dailyDigestInputSchema>,
): Promise<DailyDigestResult> {
	const client = requireOpsClient(context);
	const result = await generateDailyDigest(client, {
		hours: input.hours,
		bounceThreshold: input.bounce_threshold,
		openRateThreshold: input.open_threshold,
		clickRateThreshold: input.click_threshold,
	});
	return result;
}

export const campaignPreflightOperation = defineOperation({
	id: "ops.campaign.preflight",
	title: "Run campaign preflight",
	description: "Run pre-send checks against a Listmonk campaign",
	inputSchema: campaignPreflightInputSchema,
	outputSchema: campaignPreflightOutputSchema,
	safety: readSafety,
	mcp: { name: "listmonk_ops_preflight" },
	spec: bindCampaignPreflightOperationSpec(),
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
	spec: bindOpsDeliverabilityGuardOperationSpec(),
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
	spec: bindOpsSubscriberHygieneOperationSpec(),
	execute: executeSubscriberHygieneOperation,
});

export const segmentDriftOperation = defineOperation({
	id: "ops.segments.drift",
	title: "Detect segment drift",
	description: "Snapshot list sizes and detect subscriber-count drift",
	inputSchema: segmentDriftInputSchema,
	outputSchema: segmentDriftOutputSchema,
	// Unkeyed retries append a fresh sample, so the honest hint stays
	// non-idempotent; the conditional retry spec records that keyed
	// snapshots converge.
	safety: nonIdempotentLocalWriteSafety,
	mcp: { name: "listmonk_ops_segment_drift" },
	spec: bindOpsSegmentDriftOperationSpec(),
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
	spec: bindOpsTemplateRegistrySyncOperationSpec(),
	execute: executeTemplateRegistrySyncOperation,
});

export const templateRegistryHistoryOperation = defineOperation({
	id: "ops.templates.registry-history",
	title: "Show template version history",
	description: "Show the stored version history for a template",
	inputSchema: templateIdInputSchema,
	outputSchema: templateRegistryHistoryOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_ops_template_registry_history" },
	spec: bindOpsTemplateRegistryHistoryOperationSpec(),
	execute: executeTemplateRegistryHistoryOperation,
});

export const templateRegistryPromoteOperation = defineOperation({
	id: "ops.templates.registry-promote",
	title: "Promote template version",
	description: "Promote a stored template version back to Listmonk",
	inputSchema: templatePromoteInputSchema,
	outputSchema: templatePromoteOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_ops_template_registry_promote" },
	spec: bindOpsTemplateRegistryPromoteOperationSpec(),
	execute: executeTemplateRegistryPromoteOperation,
});

export const templateRegistryRollbackOperation = defineOperation({
	id: "ops.templates.registry-rollback",
	title: "Rollback template version",
	description: "Rollback a Listmonk template to its previous stored version",
	inputSchema: templateRollbackInputSchema,
	outputSchema: templateRollbackOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_ops_template_registry_rollback" },
	spec: bindOpsTemplateRegistryRollbackOperationSpec(),
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
	spec: bindOpsDailyDigestOperationSpec(),
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

export const opsOperationCatalog = defineOperationCatalog({
	id: "ops",
	title: "Operations workflows",
	operations: opsOperations,
	specMigrationExemptions: [],
});

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
): Promise<z.output<typeof templateRollbackOutputSchema>> {
	const parsedInput = parseOperationInput(
		templateRegistryRollbackOperation.inputSchema,
		input,
	);
	let output: TemplateRollbackResult;
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
