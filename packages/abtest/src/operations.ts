import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	defineOperationCatalog,
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "@listmonk-ops/operations";
import { z } from "zod";
import { createAbTestExecutors, type AbTestExecutors } from "./factory";
import { AbTestNotFoundError } from "./errors";
import { withStoredAbTestExecutors } from "./persistence";
import type { AbTest, TestAnalysis, TestValidationResult } from "./types";

// Keep the lifecycle contracts in the domain package so CLI and MCP share the
// same validation, persistence transaction, and Listmonk integration behavior.

export interface AbTestOperationContext {
	client: ListmonkClient;
	storePath?: string;
}

const ABTEST_STATUSES = [
	"draft",
	"testing",
	"scheduled",
	"running",
	"analyzing",
	"deploying",
	"cancelling",
	"completed",
	"inconclusive",
	"cancelled",
	"failed",
] as const;

const abTestStatusSchema = z.enum(ABTEST_STATUSES);
const positiveIntegerSchema = z.number().int().positive();
const numericIntegerInputSchema = z.union([
	positiveIntegerSchema,
	z.string().regex(/^[1-9][0-9]*$/).transform(Number),
]);
const numericPercentageSchema = z.coerce
	.number()
	.finite()
	.gt(0)
	.lte(100);
const optionalNumberSchema = z.preprocess(
	(value) => (value === null || value === "" ? undefined : value),
	z.coerce.number().finite().optional(),
);
const optionalBooleanSchema = z.preprocess(
	(value) => {
		if (value === null) {
			return undefined;
		}
		if (value === "true") {
			return true;
		}
		if (value === "false") {
			return false;
		}
		return value;
	},
	z.boolean().optional(),
);

const contentOverridesSchema = z.object({
	subject: z.string().optional(),
	body: z.string().optional(),
	sendTime: z.string().datetime().optional(),
	senderName: z.string().optional(),
	senderEmail: z.string().optional(),
});

const variantSchema = z.object({
	id: z.string(),
	name: z.string(),
	percentage: z.number().finite(),
	contentOverrides: contentOverridesSchema,
});

const metricSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(["open_rate", "click_rate", "conversion", "revenue", "custom"]),
	config: z.record(z.string(), z.unknown()).optional(),
});

const abTestSchema = z.object({
	id: z.string(),
	name: z.string(),
	campaignId: z.string(),
	variants: z.array(variantSchema),
	status: abTestStatusSchema,
	metrics: z.array(metricSchema),
	winnerVariantId: z.string().optional(),
	createdAt: z.string().datetime(),
	updatedAt: z.string().datetime(),
	baseConfig: z.object({
		subject: z.string(),
		body: z.string(),
		lists: z.array(positiveIntegerSchema),
		template_id: positiveIntegerSchema.optional(),
	}),
	testingMode: z.enum(["holdout", "full-split"]),
	testGroupPercentage: z.number().finite(),
	testGroupSize: z.number().finite().nonnegative(),
	holdoutGroupSize: z.number().finite().nonnegative(),
	confidenceThreshold: z.number().finite().gt(0).lte(1),
	autoDeployWinner: z.boolean(),
	campaignMappings: z.array(
		z.object({
			variantId: z.string(),
			campaignId: positiveIntegerSchema,
		}),
	),
	testListMappings: z.array(
		z.object({
			variantId: z.string(),
			listId: positiveIntegerSchema,
		}),
	),
	holdoutListId: positiveIntegerSchema.optional(),
	winnerCampaignId: positiveIntegerSchema.optional(),
	// Deterministic provisioning metadata (stage 2). Optional so existing
	// records without these fields still parse.
	assignmentSeed: z.string().optional(),
	audienceSnapshot: z
		.object({
			capturedAt: z.string(),
			sourceListIds: z.array(z.number().int().positive()),
			subscriberCount: z.number().int().nonnegative(),
			subscriberChecksum: z.string(),
			eligibilityPolicyVersion: z.literal(1),
		})
		.optional(),
	assignmentManifest: z
		.object({
			algorithm: z.literal("sha256-order-largest-remainder-v1"),
			seed: z.string(),
			audienceChecksum: z.string(),
			groups: z.array(
				z.object({
					kind: z.enum(["variant", "holdout"]),
					variantId: z.string().optional(),
					expectedCount: z.number().int().nonnegative(),
					subscriberChecksum: z.string(),
				}),
			),
		assignedCount: z.number().int().nonnegative(),
	})
		.optional(),
	// Stage 3 orchestration fields.
		durationHours: z.number().finite().positive().optional(),
		launchAt: z.string().datetime().optional(),
		startedAt: z.string().datetime().optional(),
		endsAt: z.string().datetime().optional(),
		minimumTestSampleSize: z.number().int().positive().optional(),
	});

const testResultsSchema = z.object({
	variantId: z.string(),
	sampleSize: z.number().finite().nonnegative(),
	opens: z.number().finite().nonnegative(),
	clicks: z.number().finite().nonnegative(),
	conversions: z.number().finite().nonnegative(),
	revenue: z.number().finite().optional(),
	openRate: z.number().finite().nonnegative(),
	clickRate: z.number().finite().nonnegative(),
	conversionRate: z.number().finite().nonnegative(),
});

const statisticalAnalysisSchema = z.object({
	zScore: z.number().finite(),
	pValue: z.number().finite(),
	isSignificant: z.boolean(),
	confidenceLevel: z.number().finite(),
	sampleSize: z.number().finite().nonnegative(),
	// Stage 4 fields — optional so existing callers stay valid.
	correctedPValue: z.number().finite().min(0).max(1).optional(),
	holmCorrected: z.boolean().optional(),
	srmPassed: z.boolean().optional(),
	srmPValue: z.number().finite().min(0).max(1).optional(),
	fixedHorizonReasonCodes: z.array(z.string()).optional(),
});

const testAnalysisSchema = z.object({
	testId: z.string(),
	results: z.array(testResultsSchema),
	analysis: statisticalAnalysisSchema,
	winner: variantSchema.nullable(),
	recommendations: z.array(z.string()),
});

const sampleSizeRecommendationSchema = z.object({
	totalSubscribers: z.number().finite().nonnegative(),
	recommendedTestPercentage: z.number().finite(),
	minimumTestPercentage: z.number().finite(),
	currentTestPercentage: z.number().finite(),
	expectedSamplePerVariant: z.number().finite().nonnegative(),
	minimumSamplePerVariant: z.number().finite().nonnegative(),
	statisticalPower: z.number().finite(),
	warnings: z.array(z.string()),
	recommendations: z.array(z.string()),
});

const testValidationSchema = z.object({
	isValid: z.boolean(),
	warnings: z.array(z.string()),
	errors: z.array(z.string()),
	sampleSizeRecommendation: sampleSizeRecommendationSchema.optional(),
});

const listAbTestsInputSchema = z.object({
	status: abTestStatusSchema.optional().describe("Filter by test status"),
});

const testIdInputSchema = z.object({
	test_id: z.string().trim().min(1).describe("A/B test ID"),
});

const createVariantInputSchema = z.object({
	name: z.string().trim().min(1),
	percentage: numericPercentageSchema,
	campaign_config: z.preprocess(
		(value) =>
			value && typeof value === "object" && !Array.isArray(value) ? value : {},
		z.object({
			subject: z.string().optional(),
			body: z.string().optional(),
			template_id: numericIntegerInputSchema.optional(),
		}),
	),
});

const createAbTestInputSchema = z.object({
	name: z.string().trim().min(1).describe("A/B test name"),
	campaign_id: z
		.union([z.string().trim().min(1), positiveIntegerSchema])
		.transform(String)
		.optional()
		.describe("Base campaign ID"),
	description: z.string().optional(),
	lists: z.array(numericIntegerInputSchema).min(1).describe("Target list IDs"),
	variants: z.array(createVariantInputSchema).min(2).max(3),
	testing_mode: z.enum(["holdout", "full-split"]).optional(),
	test_group_percentage: optionalNumberSchema.pipe(
		z.number().gt(0).lte(100).optional(),
	),
	confidence_threshold: optionalNumberSchema.pipe(
		z.number().gt(0).lt(1).optional(),
	),
	minimum_sample_size: optionalNumberSchema.pipe(
		z.number().int().positive().optional(),
	),
	duration_hours: optionalNumberSchema.pipe(z.number().gt(0).optional()),
	launch_at: z.string().datetime().optional(),
	auto_launch: optionalBooleanSchema,
	auto_deploy_winner: optionalBooleanSchema,
	ignore_sample_size_warnings: optionalBooleanSchema,
});

const analyzeAbTestInputSchema = testIdInputSchema.extend({
	include_recommendations: z.boolean().default(true),
});

const runAbTestInputSchema = z.object({
	test_id: z.string().trim().min(1).describe("A/B test ID"),
	confirm: optionalBooleanSchema.describe(
		"Confirm destructive side effects before running",
	),
});

const tickAbTestsInputSchema = z.object({
	confirm: optionalBooleanSchema.describe(
		"Confirm destructive side effects before ticking",
	),
	dry_run: optionalBooleanSchema.describe(
		"Report the actions a tick would take without executing them",
	),
});

const reconcileAbTestInputSchema = z.object({
	test_id: z.string().trim().min(1).optional().describe("A/B test ID"),
	all: optionalBooleanSchema.describe(
		"Reconcile every persisted test regardless of status",
	),
	repair: optionalBooleanSchema.describe(
		"Apply repairs for detected drift (destructive when true)",
	),
	confirm: optionalBooleanSchema.describe(
		"Confirm destructive repairs before applying them",
	),
});

const recommendSampleSizeInputSchema = z.object({
	lists: z.array(numericIntegerInputSchema).min(1).describe("Target list IDs"),
	test_group_percentage: z.coerce
		.number()
		.finite()
		.gt(0)
		.lte(100),
	variant_count: z.coerce.number().int().min(2).max(3).default(2),
});

const exportAssignmentInputSchema = z.object({
	test_id: z
		.string()
		.trim()
		.min(1)
		.describe("A/B test ID whose assignment manifest to export"),
	confirm: optionalBooleanSchema.describe(
		"Confirm export of potentially sensitive assignment data",
	),
});

export type AbTestOperationRecord = z.output<typeof abTestSchema>;
export type TestAnalysisOperationRecord = z.output<typeof testAnalysisSchema>;
export type ListAbTestsOperationOutput = { tests: AbTestOperationRecord[] };
export type GetAbTestOperationOutput = { test: AbTestOperationRecord };
export type CreateAbTestOperationOutput = { test: AbTestOperationRecord };
export type AnalyzeAbTestOperationOutput = {
	analysis: TestAnalysisOperationRecord;
};
export type LaunchAbTestOperationOutput = { test: AbTestOperationRecord };
export type StopAbTestOperationOutput = { test: AbTestOperationRecord };
export type DeleteAbTestOperationOutput = { deleted: boolean };
export type RecommendAbTestSampleSizeOperationOutput = {
	recommendation: TestValidationResult;
};
export type DeployAbTestWinnerOperationOutput = { deployed: boolean };
export type RunAbTestOperationOutput = { test: AbTestOperationRecord };
export type TickAbTestsOperationOutput = {
	processed: number;
	results: Array<{
		test_id: string;
		status: AbTestOperationRecord["status"];
		action: string;
	}>;
};
export type ReconcileAbTestOperationOutput = {
	reconciled: number;
	results: Array<{
		test_id: string;
		status: AbTestOperationRecord["status"];
		drift: string;
	}>;
};
export type ExportAbTestAssignmentOperationOutput = {
	manifest: unknown;
};

function jsonValue(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function toIsoString(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

function serializeVariant(variant: AbTest["variants"][number]): z.output<
	typeof variantSchema
> {
	return {
		...variant,
		contentOverrides: {
			...variant.contentOverrides,
			sendTime: variant.contentOverrides.sendTime
				? toIsoString(variant.contentOverrides.sendTime)
				: undefined,
		},
	};
}

function serializeAbTest(test: AbTest): AbTestOperationRecord {
	return {
		...test,
		createdAt: toIsoString(test.createdAt),
		updatedAt: toIsoString(test.updatedAt),
		variants: test.variants.map(serializeVariant),
	};
}

function serializeTestAnalysis(analysis: TestAnalysis): TestAnalysisOperationRecord {
	return {
		...analysis,
		winner: analysis.winner ? serializeVariant(analysis.winner) : null,
	};
}

async function withStoredOperation<Result>(
	context: AbTestOperationContext,
	mode: "read" | "write",
	action: (executors: AbTestExecutors) => Promise<Result> | Result,
): Promise<Result> {
	return withStoredAbTestExecutors(
		context.client,
		{ mode, storePath: context.storePath },
		action,
	);
}

export async function executeListAbTestsOperation(
	context: AbTestOperationContext,
	input: z.output<typeof listAbTestsInputSchema>,
): Promise<ListAbTestsOperationOutput> {
	const tests = await withStoredOperation<AbTest[]>(
		context,
		"read",
		(executors) => executors.listAbTests(input),
	);
	return {
		tests: (input.status
			? tests.filter((test) => test.status === input.status)
			: tests
		).map(serializeAbTest),
	};
}

export async function executeGetAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof testIdInputSchema>,
): Promise<GetAbTestOperationOutput> {
	return {
		test: serializeAbTest(
			await withStoredOperation<AbTest>(
			context,
			"read",
			(executors) => executors.getAbTest(input.test_id),
			),
		),
	};
}

export async function executeCreateAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof createAbTestInputSchema>,
): Promise<CreateAbTestOperationOutput> {
	const created = await withStoredOperation<AbTest>(
		context,
		"write",
		async (executors) => {
			const nextTest = await executors.createAbTest(input);
			// `createAbTest` owns the service-level `auto_launch` behavior. Keep
			// creation atomic and avoid attempting a second launch after the service
			// has already transitioned the test out of draft status.
			return nextTest;
		},
	);
	return { test: serializeAbTest(created) };
}

export async function executeAnalyzeAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof analyzeAbTestInputSchema>,
): Promise<AnalyzeAbTestOperationOutput> {
	return {
		analysis: serializeTestAnalysis(
			await withStoredOperation<TestAnalysis>(
			context,
			"read",
			(executors) => executors.analyzeAbTest(input),
			),
		),
	};
}

export async function executeLaunchAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof testIdInputSchema>,
): Promise<LaunchAbTestOperationOutput> {
	return {
		test: serializeAbTest(
			await withStoredOperation<AbTest>(
				context,
				"write",
				async (executors) => {
					const launched = await executors.launchAbTest(input.test_id);
					if (!launched) {
						throw new AbTestNotFoundError(input.test_id);
					}
					return launched;
				},
			),
		),
	};
}

export async function executeStopAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof testIdInputSchema>,
): Promise<StopAbTestOperationOutput> {
	return {
		test: serializeAbTest(
			await withStoredOperation<AbTest>(
				context,
				"write",
				async (executors) => {
					const stopped = await executors.stopAbTest(input.test_id);
					if (!stopped) {
						throw new AbTestNotFoundError(input.test_id);
					}
					return stopped;
				},
			),
		),
	};
}

export async function executeDeleteAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof testIdInputSchema>,
): Promise<DeleteAbTestOperationOutput> {
	await withStoredOperation<boolean>(
		context,
		"write",
		async (executors) => {
			const deleted = await executors.deleteAbTest(input.test_id);
			if (!deleted) {
				throw new AbTestNotFoundError(input.test_id);
			}
			return deleted;
		},
	);
	return { deleted: true };
}

export async function executeRecommendAbTestSampleSizeOperation(
	context: AbTestOperationContext,
	input: z.output<typeof recommendSampleSizeInputSchema>,
): Promise<RecommendAbTestSampleSizeOperationOutput> {
	const executors = createAbTestExecutors(context.client);
	const recommendation = await executors.getSampleSizeRecommendation(
		input.lists,
		input.test_group_percentage,
		input.variant_count,
	);
	return { recommendation };
}

export async function executeDeployAbTestWinnerOperation(
	context: AbTestOperationContext,
	input: z.output<typeof testIdInputSchema>,
): Promise<DeployAbTestWinnerOperationOutput> {
	await withStoredOperation<void>(
		context,
		"write",
		(executors) => executors.deployWinner(input.test_id),
	);
	return { deployed: true };
}

export async function executeRunAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof runAbTestInputSchema>,
): Promise<RunAbTestOperationOutput> {
	return {
		test: serializeAbTest(
			await withStoredOperation<AbTest>(
				context,
				"write",
				async (executors) => {
					const run = await executors.runAbTest(input.test_id);
					if (!run) {
						throw new AbTestNotFoundError(input.test_id);
					}
					return run;
				},
			),
		),
	};
}

export async function executeTickAbTestsOperation(
	context: AbTestOperationContext,
	input: z.output<typeof tickAbTestsInputSchema>,
): Promise<TickAbTestsOperationOutput> {
	const dryRun = input.dry_run === true;
	const tickResults = await withStoredOperation<
		Awaited<ReturnType<AbTestExecutors["tickAbTests"]>>
	>(context, dryRun ? "read" : "write", (executors) =>
		executors.tickAbTests(dryRun),
	);
	return {
		processed: tickResults.length,
		results: tickResults,
	};
}

export async function executeReconcileAbTestOperation(
	context: AbTestOperationContext,
	input: z.output<typeof reconcileAbTestInputSchema>,
): Promise<ReconcileAbTestOperationOutput> {
	// Guard: repair without an explicit scope (test_id or all) would mutate
	// every persisted test silently. Reject so the caller must opt in.
	if (input.repair && !input.test_id && !input.all) {
		throw new Error(
			"reconcile --repair requires an explicit scope: --test-id <id> or --all",
		);
	}
	const reconcileResults = await withStoredOperation<
		Awaited<ReturnType<AbTestExecutors["reconcileAbTest"]>>
	>(context, input.repair ? "write" : "read", (executors) =>
		executors.reconcileAbTest(input.test_id, input.repair === true),
	);
	return {
		reconciled: reconcileResults.length,
		results: reconcileResults,
	};
}

export async function executeExportAbTestAssignmentOperation(
	context: AbTestOperationContext,
	input: z.output<typeof exportAssignmentInputSchema>,
): Promise<ExportAbTestAssignmentOperationOutput> {
	const test = await withStoredOperation<AbTest>(
		context,
		"read",
		(executors) => executors.getAbTest(input.test_id),
	);
	if (!test.assignmentManifest) {
		throw new Error(
			`Test ${input.test_id} has no assignment manifest. Only tests created with deterministic provisioning (stage 2+) have exportable manifests.`,
		);
	}
	return { manifest: test.assignmentManifest };
}

const readSafety = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const createSafety = {
	readOnlyHint: false,
	// `auto_launch` can start the backing campaigns as part of creation, so the
	// static MCP annotation must cover that potentially destructive input path.
	destructiveHint: true,
	idempotentHint: false,
	openWorldHint: true,
} as const;

const mutationSafety = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const destructiveSafety = {
	readOnlyHint: false,
	destructiveHint: true,
	idempotentHint: true,
	openWorldHint: true,
} as const;

const destructiveNonIdempotentSafety = {
	...destructiveSafety,
	idempotentHint: false,
} as const;

export const listAbTestsOperation = defineOperation({
	id: "abtest.list",
	title: "List A/B tests",
	description: "List persisted A/B tests, optionally filtered by status",
	inputSchema: listAbTestsInputSchema,
	outputSchema: z.object({ tests: z.array(abTestSchema) }),
	safety: readSafety,
	mcp: {
		name: "listmonk_abtest_list",
		legacySuccessText: (output) => jsonValue(output["tests"]),
	},
	execute: executeListAbTestsOperation,
});

export const getAbTestOperation = defineOperation({
	id: "abtest.get",
	title: "Get A/B test",
	description: "Get persisted A/B test details",
	inputSchema: testIdInputSchema,
	outputSchema: z.object({ test: abTestSchema }),
	safety: readSafety,
	mcp: {
		name: "listmonk_abtest_get",
		legacySuccessText: (output) => jsonValue(output["test"]),
	},
	execute: executeGetAbTestOperation,
});

export const createAbTestOperation = defineOperation({
	id: "abtest.create",
	title: "Create A/B test",
	description:
		"Create and persist an A/B test; auto-launch can start its campaigns",
	inputSchema: createAbTestInputSchema,
	outputSchema: z.object({ test: abTestSchema }),
	safety: createSafety,
	mcp: {
		name: "listmonk_abtest_create",
		legacySuccessText: (output) => jsonValue(output["test"]),
	},
	execute: executeCreateAbTestOperation,
});

export const analyzeAbTestOperation = defineOperation({
	id: "abtest.analyze",
	title: "Analyze A/B test",
	description: "Analyze persisted A/B test statistical results",
	inputSchema: analyzeAbTestInputSchema,
	outputSchema: z.object({ analysis: testAnalysisSchema }),
	safety: readSafety,
	mcp: {
		name: "listmonk_abtest_analyze",
		legacySuccessText: (output) => jsonValue(output["analysis"]),
	},
	execute: executeAnalyzeAbTestOperation,
});

export const launchAbTestOperation = defineOperation({
	id: "abtest.launch",
	title: "Launch A/B test",
	description: "Launch a draft A/B test",
	inputSchema: testIdInputSchema,
	outputSchema: z.object({ test: abTestSchema }),
	safety: destructiveNonIdempotentSafety,
	mcp: {
		name: "listmonk_abtest_launch",
		legacySuccessText: (output) => jsonValue(output["test"]),
	},
	execute: executeLaunchAbTestOperation,
});

export const stopAbTestOperation = defineOperation({
	id: "abtest.stop",
	title: "Stop A/B test",
	description: "Stop a running A/B test and clean up temporary resources",
	inputSchema: testIdInputSchema,
	outputSchema: z.object({ test: abTestSchema }),
	safety: destructiveNonIdempotentSafety,
	mcp: {
		name: "listmonk_abtest_stop",
		legacySuccessText: (output) => jsonValue(output["test"]),
	},
	execute: executeStopAbTestOperation,
});

export const deleteAbTestOperation = defineOperation({
	id: "abtest.delete",
	title: "Delete A/B test",
	description: "Delete an A/B test from persisted state",
	inputSchema: testIdInputSchema,
	outputSchema: z.object({ deleted: z.boolean() }),
	safety: destructiveSafety,
	mcp: {
		name: "listmonk_abtest_delete",
		legacySuccessText: (output) => jsonValue(output),
	},
	execute: executeDeleteAbTestOperation,
});

export const recommendAbTestSampleSizeOperation = defineOperation({
	id: "abtest.recommend-sample-size",
	title: "Recommend A/B test sample size",
	description: "Get statistical recommendations for test-group sample size",
	inputSchema: recommendSampleSizeInputSchema,
	outputSchema: z.object({ recommendation: testValidationSchema }),
	safety: readSafety,
	mcp: {
		name: "listmonk_abtest_recommend_sample_size",
		legacySuccessText: (output) => jsonValue(output["recommendation"]),
	},
	execute: executeRecommendAbTestSampleSizeOperation,
});

export const deployAbTestWinnerOperation = defineOperation({
	id: "abtest.deploy-winner",
	title: "Deploy A/B test winner",
	description: "Deploy a statistically significant winner to the holdout group",
	inputSchema: testIdInputSchema,
	outputSchema: z.object({ deployed: z.boolean() }),
	safety: destructiveNonIdempotentSafety,
	mcp: {
		name: "listmonk_abtest_deploy_winner",
		legacySuccessText: (output) => jsonValue(output),
	},
	execute: executeDeployAbTestWinnerOperation,
});

const tickResultSchema = z.object({
	test_id: z.string(),
	status: abTestStatusSchema,
	action: z.string(),
});

const reconcileResultSchema = z.object({
	test_id: z.string(),
	status: abTestStatusSchema,
	drift: z.string(),
});

export const runAbTestOperation = defineOperation({
	id: "abtest.run",
	title: "Run A/B test step",
	description:
		"Advance a single A/B test one lifecycle step based on its current status",
	inputSchema: runAbTestInputSchema,
	outputSchema: z.object({ test: abTestSchema }),
	safety: destructiveNonIdempotentSafety,
	mcp: {
		name: "listmonk_abtest_run",
		legacySuccessText: (output) => jsonValue(output["test"]),
	},
	execute: executeRunAbTestOperation,
});

export const tickAbTestsOperation = defineOperation({
	id: "abtest.tick",
	title: "Tick A/B tests",
	description:
		"Advance every non-terminal A/B test one lifecycle step and report the actions taken",
	inputSchema: tickAbTestsInputSchema,
	outputSchema: z.object({
		processed: z.number().int().nonnegative(),
		results: z.array(tickResultSchema),
	}),
	safety: destructiveNonIdempotentSafety,
	mcp: {
		name: "listmonk_abtest_tick",
		legacySuccessText: (output) => jsonValue(output),
	},
	execute: executeTickAbTestsOperation,
});

export const reconcileAbTestOperation = defineOperation({
	id: "abtest.reconcile",
	title: "Reconcile A/B test state",
	description:
		"Reconcile persisted A/B test state against expected lifecycle state; repairs are destructive when enabled",
	inputSchema: reconcileAbTestInputSchema,
	outputSchema: z.object({
		reconciled: z.number().int().nonnegative(),
		results: z.array(reconcileResultSchema),
	}),
	// Reconcile is read-only by default but becomes destructive when `repair`
	// is requested, so the static annotation must cover the destructive path.
	safety: destructiveSafety,
	mcp: {
		name: "listmonk_abtest_reconcile",
		legacySuccessText: (output) => jsonValue(output),
	},
	execute: executeReconcileAbTestOperation,
});

export const exportAbTestAssignmentOperation = defineOperation({
	id: "abtest.export-assignment",
	title: "Export A/B test assignment manifest",
	description:
		"Export the subscriber assignment manifest for a test with deterministic provisioning. Contains subscriber group assignments (no email/PII).",
	inputSchema: exportAssignmentInputSchema,
	outputSchema: z.object({
		manifest: z.unknown(),
	}),
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	} as const,
	mcp: {
		name: "listmonk_abtest_export_assignment",
		legacySuccessText: (output) => jsonValue(output),
	},
	execute: executeExportAbTestAssignmentOperation,
});

export const abTestOperations = [
	listAbTestsOperation,
	getAbTestOperation,
	createAbTestOperation,
	analyzeAbTestOperation,
	launchAbTestOperation,
	stopAbTestOperation,
	deleteAbTestOperation,
	recommendAbTestSampleSizeOperation,
	deployAbTestWinnerOperation,
	runAbTestOperation,
	tickAbTestsOperation,
	reconcileAbTestOperation,
	exportAbTestAssignmentOperation,
] as const;

export const abTestOperationCatalog = defineOperationCatalog({
	id: "abtest",
	title: "A/B tests",
	operations: abTestOperations,
});

export type AbTestOperation = (typeof abTestOperations)[number];

const abTestOperationsByMcpName = new Map(
	abTestOperations.map((operation) => [operation.mcp.name, operation] as const),
);

export function getAbTestOperationByMcpName(
	name: string,
): AbTestOperation | undefined {
	return abTestOperationsByMcpName.get(name);
}

export async function invokeListAbTestsOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<ListAbTestsOperationOutput> {
	const parsedInput = parseOperationInput(
		listAbTestsOperation.inputSchema,
		input,
	);
	return executeListAbTestsOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				listAbTestsOperation.id,
				listAbTestsOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(listAbTestsOperation.id, error);
		});
}

export async function invokeGetAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<GetAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		getAbTestOperation.inputSchema,
		input,
	);
	return executeGetAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				getAbTestOperation.id,
				getAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(getAbTestOperation.id, error);
		});
}

export async function invokeCreateAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<CreateAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		createAbTestOperation.inputSchema,
		input,
	);
	return executeCreateAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				createAbTestOperation.id,
				createAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(createAbTestOperation.id, error);
		});
}

export async function invokeAnalyzeAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<AnalyzeAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		analyzeAbTestOperation.inputSchema,
		input,
	);
	return executeAnalyzeAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				analyzeAbTestOperation.id,
				analyzeAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(analyzeAbTestOperation.id, error);
		});
}

export async function invokeLaunchAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<LaunchAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		launchAbTestOperation.inputSchema,
		input,
	);
	return executeLaunchAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				launchAbTestOperation.id,
				launchAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(launchAbTestOperation.id, error);
		});
}

export async function invokeStopAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<StopAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		stopAbTestOperation.inputSchema,
		input,
	);
	return executeStopAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				stopAbTestOperation.id,
				stopAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(stopAbTestOperation.id, error);
		});
}

export async function invokeDeleteAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<DeleteAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		deleteAbTestOperation.inputSchema,
		input,
	);
	return executeDeleteAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				deleteAbTestOperation.id,
				deleteAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(deleteAbTestOperation.id, error);
		});
}

export async function invokeRecommendAbTestSampleSizeOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<RecommendAbTestSampleSizeOperationOutput> {
	const parsedInput = parseOperationInput(
		recommendAbTestSampleSizeOperation.inputSchema,
		input,
	);
	return executeRecommendAbTestSampleSizeOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				recommendAbTestSampleSizeOperation.id,
				recommendAbTestSampleSizeOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(
				recommendAbTestSampleSizeOperation.id,
				error,
			);
		});
}

export async function invokeDeployAbTestWinnerOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<DeployAbTestWinnerOperationOutput> {
	const parsedInput = parseOperationInput(
		deployAbTestWinnerOperation.inputSchema,
		input,
	);
	return executeDeployAbTestWinnerOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				deployAbTestWinnerOperation.id,
				deployAbTestWinnerOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(
				deployAbTestWinnerOperation.id,
				error,
			);
		});
}

export async function invokeRunAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<RunAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		runAbTestOperation.inputSchema,
		input,
	);
	return executeRunAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				runAbTestOperation.id,
				runAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(runAbTestOperation.id, error);
		});
}

export async function invokeTickAbTestsOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<TickAbTestsOperationOutput> {
	const parsedInput = parseOperationInput(
		tickAbTestsOperation.inputSchema,
		input,
	);
	return executeTickAbTestsOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				tickAbTestsOperation.id,
				tickAbTestsOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(tickAbTestsOperation.id, error);
		});
}

export async function invokeReconcileAbTestOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<ReconcileAbTestOperationOutput> {
	const parsedInput = parseOperationInput(
		reconcileAbTestOperation.inputSchema,
		input,
	);
	return executeReconcileAbTestOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				reconcileAbTestOperation.id,
				reconcileAbTestOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(
				reconcileAbTestOperation.id,
				error,
			);
		});
}

export async function invokeExportAbTestAssignmentOperation(
	context: AbTestOperationContext,
	input: unknown,
): Promise<ExportAbTestAssignmentOperationOutput> {
	const parsedInput = parseOperationInput(
		exportAbTestAssignmentOperation.inputSchema,
		input,
	);
	return executeExportAbTestAssignmentOperation(context, parsedInput)
		.then((output) =>
			parseOperationOutput(
				exportAbTestAssignmentOperation.id,
				exportAbTestAssignmentOperation.outputSchema,
				output,
			),
		)
		.catch((error) => {
			throw normalizeOperationExecutionError(
				exportAbTestAssignmentOperation.id,
				error,
			);
		});
}

export type AbTestOperationInvocation =
	| { operation: typeof listAbTestsOperation; output: ListAbTestsOperationOutput }
	| { operation: typeof getAbTestOperation; output: GetAbTestOperationOutput }
	| {
			operation: typeof createAbTestOperation;
			output: CreateAbTestOperationOutput;
	  }
	| { operation: typeof analyzeAbTestOperation; output: AnalyzeAbTestOperationOutput }
	| { operation: typeof launchAbTestOperation; output: LaunchAbTestOperationOutput }
	| { operation: typeof stopAbTestOperation; output: StopAbTestOperationOutput }
	| { operation: typeof deleteAbTestOperation; output: DeleteAbTestOperationOutput }
	| {
			operation: typeof recommendAbTestSampleSizeOperation;
			output: RecommendAbTestSampleSizeOperationOutput;
	  }
	| {
			operation: typeof deployAbTestWinnerOperation;
			output: DeployAbTestWinnerOperationOutput;
	  }
	| { operation: typeof runAbTestOperation; output: RunAbTestOperationOutput }
	| { operation: typeof tickAbTestsOperation; output: TickAbTestsOperationOutput }
	| {
			operation: typeof reconcileAbTestOperation;
			output: ReconcileAbTestOperationOutput;
	  }
	| {
			operation: typeof exportAbTestAssignmentOperation;
			output: ExportAbTestAssignmentOperationOutput;
	  };

export async function invokeAbTestOperationByMcpName(
	context: AbTestOperationContext,
	name: string,
	input: unknown,
): Promise<AbTestOperationInvocation | undefined> {
	// Keep explicit named invoker edges here so ttsc-graph can verify every
	// MCP operation reaches its corresponding executor and direct-import tests.
	switch (name) {
		case listAbTestsOperation.mcp.name:
			return {
				operation: listAbTestsOperation,
				output: await invokeListAbTestsOperation(context, input),
			};
		case getAbTestOperation.mcp.name:
			return {
				operation: getAbTestOperation,
				output: await invokeGetAbTestOperation(context, input),
			};
		case createAbTestOperation.mcp.name:
			return {
				operation: createAbTestOperation,
				output: await invokeCreateAbTestOperation(context, input),
			};
		case analyzeAbTestOperation.mcp.name:
			return {
				operation: analyzeAbTestOperation,
				output: await invokeAnalyzeAbTestOperation(context, input),
			};
		case launchAbTestOperation.mcp.name:
			return {
				operation: launchAbTestOperation,
				output: await invokeLaunchAbTestOperation(context, input),
			};
		case stopAbTestOperation.mcp.name:
			return {
				operation: stopAbTestOperation,
				output: await invokeStopAbTestOperation(context, input),
			};
		case deleteAbTestOperation.mcp.name:
			return {
				operation: deleteAbTestOperation,
				output: await invokeDeleteAbTestOperation(context, input),
			};
		case recommendAbTestSampleSizeOperation.mcp.name:
			return {
				operation: recommendAbTestSampleSizeOperation,
				output: await invokeRecommendAbTestSampleSizeOperation(context, input),
			};
		case deployAbTestWinnerOperation.mcp.name:
			return {
				operation: deployAbTestWinnerOperation,
				output: await invokeDeployAbTestWinnerOperation(context, input),
			};
		case runAbTestOperation.mcp.name:
			return {
				operation: runAbTestOperation,
				output: await invokeRunAbTestOperation(context, input),
			};
		case tickAbTestsOperation.mcp.name:
			return {
				operation: tickAbTestsOperation,
				output: await invokeTickAbTestsOperation(context, input),
			};
		case reconcileAbTestOperation.mcp.name:
			return {
				operation: reconcileAbTestOperation,
				output: await invokeReconcileAbTestOperation(context, input),
			};
		case exportAbTestAssignmentOperation.mcp.name:
			return {
				operation: exportAbTestAssignmentOperation,
				output: await invokeExportAbTestAssignmentOperation(
					context,
					input,
				),
			};
		default:
			return undefined;
	}
}
