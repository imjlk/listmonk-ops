import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
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
	"running",
	"analyzing",
	"deploying",
	"completed",
	"cancelled",
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
	auto_launch: optionalBooleanSchema,
	auto_deploy_winner: optionalBooleanSchema,
	ignore_sample_size_warnings: optionalBooleanSchema,
});

const analyzeAbTestInputSchema = testIdInputSchema.extend({
	include_recommendations: z.boolean().default(true),
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

const nonIdempotentMutationSafety = {
	...mutationSafety,
	idempotentHint: false,
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
	safety: nonIdempotentMutationSafety,
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
] as const;

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
		default:
			return undefined;
	}
}
