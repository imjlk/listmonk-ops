import {
	type CreateAbTestInput,
	type AnalyzeAbTestOperationOutput,
	type CreateAbTestOperationOutput,
	type DeleteAbTestOperationOutput,
	type DeployAbTestWinnerOperationOutput,
	type GetAbTestOperationOutput,
	type LaunchAbTestOperationOutput,
	type ListAbTestsOperationOutput,
	type ReconcileAbTestOperationOutput,
	type RecommendAbTestSampleSizeOperationOutput,
	type RunAbTestOperationOutput,
	type StopAbTestOperationOutput,
	type TickAbTestsOperationOutput,
	invokeAnalyzeAbTestOperation,
	invokeCreateAbTestOperation,
	invokeDeleteAbTestOperation,
	invokeDeployAbTestWinnerOperation,
	invokeGetAbTestOperation,
	invokeLaunchAbTestOperation,
	invokeListAbTestsOperation,
	invokeReconcileAbTestOperation,
	invokeRecommendAbTestSampleSizeOperation,
	invokeRunAbTestOperation,
	invokeStopAbTestOperation,
	invokeTickAbTestsOperation,
	validateStoredAbTestStore,
} from "@listmonk-ops/abtest";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";
import { defineCommand, defineGroup, option } from "../lib/command";
import {
	parseCsvNumbers,
	parseJson,
	toErrorMessage,
} from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";
import { executeCliOperation } from "../operation-execution";

type VariantInput = {
	name: string;
	percentage?: number;
	contentOverrides?: {
		subject?: string;
		body?: string;
	};
};

type VariantForCreateInput = {
	name: string;
	percentage: number;
	contentOverrides: {
		subject?: string;
		body?: string;
	};
};

function roundToFour(value: number): number {
	return Math.round(value * 10000) / 10000;
}

function normalizeVariants(
	rawVariants: VariantInput[],
): VariantForCreateInput[] {
	if (rawVariants.length < 2 || rawVariants.length > 3) {
		throw new Error("A/B test requires 2-3 variants");
	}

	const variants = rawVariants.map((variant, index) => ({
		name: variant.name?.trim() || `Variant ${index + 1}`,
		percentage:
			typeof variant.percentage === "number" ? variant.percentage : undefined,
		contentOverrides: variant.contentOverrides ?? {},
	}));

	const provided = variants.filter(
		(variant): variant is typeof variant & { percentage: number } =>
			typeof variant.percentage === "number",
	);

	if (provided.some((variant) => variant.percentage <= 0)) {
		throw new Error("Variant percentages must be greater than 0");
	}

	if (provided.length === 0) {
		const equal = roundToFour(100 / variants.length);
		let remaining = 100;
		for (let index = 0; index < variants.length; index += 1) {
			const variant = variants[index];
			if (!variant) {
				continue;
			}

			if (index === variants.length - 1) {
				variant.percentage = roundToFour(remaining);
				continue;
			}

			variant.percentage = equal;
			remaining -= equal;
		}
	} else if (provided.length < variants.length) {
		const used = provided.reduce((sum, variant) => sum + variant.percentage, 0);
		if (used >= 100) {
			throw new Error("Variant percentages must sum to less than 100");
		}

		const missingIndexes = variants
			.map((variant, index) => ({
				index,
				hasValue: variant.percentage !== undefined,
			}))
			.filter((entry) => !entry.hasValue)
			.map((entry) => entry.index);

		const remaining = 100 - used;
		const each = roundToFour(remaining / missingIndexes.length);
		let remainder = remaining;

		for (let index = 0; index < missingIndexes.length; index += 1) {
			const variantIndex = missingIndexes[index];
			if (variantIndex === undefined) {
				continue;
			}

			const variant = variants[variantIndex];
			if (!variant) {
				continue;
			}

			if (index === missingIndexes.length - 1) {
				variant.percentage = roundToFour(remainder);
				continue;
			}

			variant.percentage = each;
			remainder -= each;
		}
	}

	const total = variants.reduce(
		(sum, variant) => sum + (variant.percentage ?? 0),
		0,
	);
	if (Math.abs(total - 100) > 0.01) {
		throw new Error(`Variant percentages must sum to 100 (got ${total})`);
	}

	return variants.map((variant) => ({
		name: variant.name,
		percentage: roundToFour(variant.percentage ?? 0),
		contentOverrides: variant.contentOverrides,
	}));
}

export function buildCreateInputFromFlags(flags: {
	name: string;
	"campaign-id": number;
	variants: string;
	lists: string;
	subject?: string;
	body?: string;
	"testing-mode"?: "holdout" | "full-split";
	"test-group-percentage"?: number;
	"auto-deploy-winner": boolean;
	"ignore-sample-size-warnings": boolean;
}): CreateAbTestInput {
	const parsedVariants = parseJson<VariantInput[]>(flags.variants, "variants");
	if (!Array.isArray(parsedVariants)) {
		throw new Error("Variants must be a JSON array");
	}

	const normalizedVariants = normalizeVariants(parsedVariants);
	const lists = parseCsvNumbers(flags.lists);
	const testingMode = flags["testing-mode"] ?? "holdout";
	const testGroupPercentage =
		flags["test-group-percentage"] ?? (testingMode === "holdout" ? 10 : 100);
	const baseSubject = flags.subject?.trim() ?? "";
	const baseBody = flags.body?.trim() ?? "";

	return {
		name: flags.name,
		campaign_id: String(flags["campaign-id"]),
		lists,
		variants: normalizedVariants.map((variant) => ({
			name: variant.name,
			percentage: variant.percentage,
			campaign_config: {
				subject: variant.contentOverrides.subject ?? baseSubject,
				body: variant.contentOverrides.body ?? baseBody,
			},
		})),
		testing_mode: testingMode,
		test_group_percentage: testGroupPercentage,
		auto_deploy_winner: flags["auto-deploy-winner"],
		ignore_sample_size_warnings: flags["ignore-sample-size-warnings"],
	};
}

type CliAbTestArgs = Parameters<typeof getListmonkClient>[0];

async function invokeCliListAbTests(
	args: CliAbTestArgs,
	input: unknown,
): Promise<ListAbTestsOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeListAbTestsOperation({ client }, input);
}

async function invokeCliGetAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<GetAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeGetAbTestOperation({ client }, input);
}

async function invokeCliCreateAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<CreateAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeCreateAbTestOperation({ client }, input);
}

async function invokeCliAnalyzeAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<AnalyzeAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeAnalyzeAbTestOperation({ client }, input);
}

async function invokeCliLaunchAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<LaunchAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeLaunchAbTestOperation({ client }, input);
}

async function invokeCliStopAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<StopAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeStopAbTestOperation({ client }, input);
}

async function invokeCliDeleteAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<DeleteAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeDeleteAbTestOperation({ client }, input);
}

async function invokeCliRecommendAbTestSampleSize(
	args: CliAbTestArgs,
	input: unknown,
): Promise<RecommendAbTestSampleSizeOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeRecommendAbTestSampleSizeOperation({ client }, input);
}

async function invokeCliDeployAbTestWinner(
	args: CliAbTestArgs,
	input: unknown,
): Promise<DeployAbTestWinnerOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeDeployAbTestWinnerOperation({ client }, input);
}

async function invokeCliRunAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<RunAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeRunAbTestOperation({ client }, input);
}

async function invokeCliTickAbTests(
	args: CliAbTestArgs,
	input: unknown,
): Promise<TickAbTestsOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeTickAbTestsOperation({ client }, input);
}

async function invokeCliReconcileAbTest(
	args: CliAbTestArgs,
	input: unknown,
): Promise<ReconcileAbTestOperationOutput> {
	const client = await getListmonkClient(args);
	return invokeReconcileAbTestOperation({ client }, input);
}

async function promptInteractiveInput(
	clack: typeof import("@clack/prompts"),
): Promise<{ input: CreateAbTestInput; autoLaunch: boolean }> {
	clack.intro("Interactive A/B test setup");

	const nameResult = await clack.text({
		message: "Test name",
		validate: (value) =>
			value.trim().length > 0 ? undefined : "Test name is required",
	});
	if (clack.isCancel(nameResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const campaignIdResult = await clack.text({
		message: "Base campaign ID",
		validate: (value) => {
			const parsed = Number(value);
			return Number.isInteger(parsed) && parsed > 0
				? undefined
				: "Campaign ID must be a positive integer";
		},
	});
	if (clack.isCancel(campaignIdResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const variantCountResult = await clack.select<number>({
		message: "Variant count",
		options: [
			{ label: "2 variants (A/B)", value: 2 },
			{ label: "3 variants (A/B/C)", value: 3 },
		],
		initialValue: 2,
	});
	if (clack.isCancel(variantCountResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const variants: VariantInput[] = [];
	for (let index = 0; index < variantCountResult; index += 1) {
		const label = String.fromCharCode(65 + index);
		const variantNameResult = await clack.text({
			message: `Variant ${label} name`,
			defaultValue: `Variant ${label}`,
			validate: (value) =>
				value.trim().length > 0 ? undefined : "Variant name is required",
		});
		if (clack.isCancel(variantNameResult)) {
			clack.cancel("Cancelled");
			throw new Error("Prompt cancelled by user");
		}

		const percentageResult = await clack.text({
			message: `Variant ${label} percentage (optional)`,
			placeholder: "Leave empty for auto distribution",
			validate: (value) => {
				if (!value.trim()) {
					return undefined;
				}
				const parsed = Number(value);
				return Number.isFinite(parsed) && parsed > 0
					? undefined
					: "Percentage must be a positive number";
			},
		});
		if (clack.isCancel(percentageResult)) {
			clack.cancel("Cancelled");
			throw new Error("Prompt cancelled by user");
		}

		variants.push({
			name: variantNameResult,
			percentage: percentageResult.trim()
				? Number(percentageResult)
				: undefined,
		});
	}

	const subjectResult = await clack.text({
		message: "Base subject (optional)",
	});
	if (clack.isCancel(subjectResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const bodyResult = await clack.text({
		message: "Base body (optional)",
	});
	if (clack.isCancel(bodyResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const listsResult = await clack.text({
		message: "List IDs (comma separated)",
		placeholder: "1,2,3",
		validate: (value) => {
			try {
				parseCsvNumbers(value);
				return undefined;
			} catch (error) {
				return toErrorMessage(error);
			}
		},
	});
	if (clack.isCancel(listsResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const testingModeResult = await clack.select<"holdout" | "full-split">({
		message: "Testing mode",
		options: [
			{ label: "Holdout", value: "holdout" },
			{ label: "Full split", value: "full-split" },
		],
		initialValue: "holdout",
	});
	if (clack.isCancel(testingModeResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const testGroupDefault = testingModeResult === "holdout" ? "10" : "100";
	const testGroupResult = await clack.text({
		message: "Test group percentage",
		defaultValue: testGroupDefault,
		validate: (value) => {
			const parsed = Number(value);
			return Number.isFinite(parsed) && parsed > 0 && parsed <= 100
				? undefined
				: "Enter a number between 1 and 100";
		},
	});
	if (clack.isCancel(testGroupResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const autoLaunchResult = await clack.confirm({
		message: "Launch test immediately after creation?",
		initialValue: false,
	});
	if (clack.isCancel(autoLaunchResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const autoDeployResult = await clack.confirm({
		message: "Auto-deploy winner when significant?",
		initialValue: false,
	});
	if (clack.isCancel(autoDeployResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const ignoreWarningsResult = await clack.confirm({
		message: "Ignore statistical sample-size warnings?",
		initialValue: false,
	});
	if (clack.isCancel(ignoreWarningsResult)) {
		clack.cancel("Cancelled");
		throw new Error("Prompt cancelled by user");
	}

	const input = buildCreateInputFromFlags({
		name: nameResult,
		"campaign-id": Number(campaignIdResult),
		variants: JSON.stringify(variants),
		lists: listsResult,
		subject: subjectResult,
		body: bodyResult,
		"testing-mode": testingModeResult,
		"test-group-percentage": Number(testGroupResult),
		"auto-deploy-winner": autoDeployResult,
		"ignore-sample-size-warnings": ignoreWarningsResult,
	});

	clack.note(
		JSON.stringify(
			{
				name: input.name,
				campaignId: input.campaign_id,
				lists: input.lists,
				variants: input.variants.map((variant) => ({
					name: variant.name,
					percentage: variant.percentage,
				})),
				testingMode: input.testing_mode,
				testGroupPercentage: input.test_group_percentage,
				autoDeployWinner: input.auto_deploy_winner,
			},
			null,
			2,
		),
		"Review",
	);

	const confirmResult = await clack.confirm({
		message: "Create this test?",
		initialValue: true,
	});
	if (clack.isCancel(confirmResult) || !confirmResult) {
		clack.cancel("Creation cancelled");
		throw new Error("A/B test creation cancelled");
	}

	clack.outro("Creating A/B test");

	return {
		input,
		autoLaunch: autoLaunchResult,
	};
}

export default defineGroup({
	name: "abtest",
	description: "A/B test operations",
	commands: [
		defineCommand({
			name: "list",
			operationId: "abtest.list",
			description: "List A/B tests from persisted state",
			handler: async (args) => {
				try {
					const { tests } = await invokeCliListAbTests(
						args,
						{},
					);
					if (tests.length === 0) {
						OutputUtils.info("No A/B tests found");
						return;
					}

					const rows = tests.map((test) => ({
						id: test.id,
						name: test.name,
						status: test.status,
						variants: test.variants.length,
						mode: test.testingMode,
						testGroupPercentage: test.testGroupPercentage,
						createdAt: new Date(test.createdAt).toISOString(),
					}));
					OutputUtils.table(rows);
				} catch (error) {
					throw new Error(`Failed to list A/B tests: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "interactive",
			description: "Create an A/B test with guided prompts",
			handler: async ({ prompt, ...args }) => {
				try {
					// Fail on an unreadable/corrupt store before starting the prompt. The
					// write transaction re-reads it afterward to avoid a stale snapshot.
					await validateStoredAbTestStore();
					const { input, autoLaunch } = await promptInteractiveInput(
						prompt.clack,
					);
					const { test: created } = await executeCliOperation({
						operationId: "abtest.create",
						input: { ...input, auto_launch: autoLaunch },
						// The interactive flow has already received an explicit create
						// confirmation immediately before this operation boundary.
						confirmed: true,
						invoke: () =>
							invokeCliCreateAbTest(args, {
								...input,
								auto_launch: autoLaunch,
							}),
					});

					OutputUtils.success(`A/B test created: ${created.id}`);
					OutputUtils.json(created);
				} catch (error) {
					throw new Error(
						`Failed to create A/B test: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "create",
			operationId: "abtest.create",
			description: "Create an A/B test from JSON variant config",
			options: {
				name: option(z.string().trim().min(1), {
					description: "Test name",
				}),
				"campaign-id": option(z.coerce.number().int().positive(), {
					description: "Base campaign ID",
				}),
				variants: option(z.string().min(2), {
					description:
						'JSON variants: [{"name":"A","percentage":50},{"name":"B","percentage":50}]',
				}),
				lists: option(z.string().trim().min(1), {
					description: "Comma-separated list IDs",
				}),
				subject: option(z.string().optional(), {
					description: "Base subject",
				}),
				body: option(z.string().optional(), {
					description: "Base body",
				}),
				"testing-mode": option(z.enum(["holdout", "full-split"]).optional(), {
					description: "Testing mode",
				}),
				"test-group-percentage": option(
					z.coerce.number().min(1).max(100).optional(),
					{
						description: "Test-group traffic percentage",
					},
				),
				"auto-launch": option(z.coerce.boolean().default(false), {
					description: "Launch test after creation",
				}),
				"auto-deploy-winner": option(z.coerce.boolean().default(false), {
					description: "Auto-deploy winning variant",
				}),
				"ignore-sample-size-warnings": option(
					z.coerce.boolean().default(false),
					{
						description: "Ignore sample-size warnings",
					},
				),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const input = buildCreateInputFromFlags(flags);
					const { test: created } = await invokeCliCreateAbTest(
						args,
						{ ...input, auto_launch: flags["auto-launch"] },
					);
					OutputUtils.success(`A/B test created: ${created.id}`);
					OutputUtils.json(created);
				} catch (error) {
					throw new Error(
						`Failed to create A/B test: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "analyze",
			operationId: "abtest.analyze",
			description: "Analyze A/B test results",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const { analysis } = await invokeCliAnalyzeAbTest(
						args,
						{ test_id: flags["test-id"], include_recommendations: true },
					);
					const rows = analysis.results.map((result, index) => ({
						variant: String.fromCharCode(65 + index),
						sample: result.sampleSize,
						opens: result.opens,
						clicks: result.clicks,
						conversions: result.conversions,
						open_rate: `${result.openRate.toFixed(2)}%`,
						click_rate: `${result.clickRate.toFixed(2)}%`,
						conversion_rate: `${result.conversionRate.toFixed(2)}%`,
					}));

					OutputUtils.table(rows);
					OutputUtils.json({
						statisticalAnalysis: analysis.analysis,
						winner: analysis.winner,
						recommendations: analysis.recommendations,
					});
				} catch (error) {
					throw new Error(
						`Failed to analyze A/B test: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "recommend-sample-size",
			operationId: "abtest.recommend-sample-size",
			description: "Recommend A/B test sample size",
			options: {
				lists: option(z.string().trim().min(1), {
					description: "Comma-separated list IDs",
				}),
				"test-group-percentage": option(
					z.coerce.number().finite().gt(0).lte(100),
					{
						description: "Planned test-group percentage",
					},
				),
				"variant-count": option(z.coerce.number().int().min(2).max(3).default(2), {
					description: "Variant count (2-3)",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const { recommendation } =
						await invokeCliRecommendAbTestSampleSize(
							args,
							{
								lists: parseCsvNumbers(flags.lists),
								test_group_percentage: flags["test-group-percentage"],
								variant_count: flags["variant-count"],
							},
						);
					OutputUtils.json(recommendation);
				} catch (error) {
					throw new Error(
						`Failed to recommend A/B sample size: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "get",
			operationId: "abtest.get",
			description: "Get A/B test details",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const { test } = await invokeCliGetAbTest(
						args,
						{ test_id: flags["test-id"] },
					);
					OutputUtils.json(test);
				} catch (error) {
					throw new Error(`Failed to get A/B test: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "launch",
			operationId: "abtest.launch",
			description: "Launch a draft A/B test",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const { test: launched } = await invokeCliLaunchAbTest(
						args,
						{ test_id: flags["test-id"] },
					);
					OutputUtils.success(`A/B test launched: ${flags["test-id"]}`);
					OutputUtils.json(launched);
				} catch (error) {
					throw new Error(
						`Failed to launch A/B test: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "stop",
			operationId: "abtest.stop",
			description: "Stop a running A/B test",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const { test: stopped } = await invokeCliStopAbTest(
						args,
						{ test_id: flags["test-id"] },
					);
					OutputUtils.success(`A/B test stopped: ${flags["test-id"]}`);
					OutputUtils.json(stopped);
				} catch (error) {
					throw new Error(`Failed to stop A/B test: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "deploy-winner",
			operationId: "abtest.deploy-winner",
			description: "Deploy the statistically significant winner",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const result =
						await invokeCliDeployAbTestWinner(
							args,
							{ test_id: flags["test-id"] },
						);
					OutputUtils.success(
						`A/B test winner deployed: ${flags["test-id"]}`,
					);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Failed to deploy A/B test winner: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "run",
			operationId: "abtest.run",
			description: "Advance a single A/B test one lifecycle step",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const { test: run } = await invokeCliRunAbTest(
						args,
						{ test_id: flags["test-id"] },
					);
					OutputUtils.success(`A/B test advanced: ${flags["test-id"]}`);
					OutputUtils.json(run);
				} catch (error) {
					throw new Error(
						`Failed to run A/B test: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "tick",
			operationId: "abtest.tick",
			description: "Advance every non-terminal A/B test one lifecycle step",
			options: {
				"dry-run": option(z.coerce.boolean().default(false), {
					description: "Preview what tick would do without mutating state",
				}),
			},
			handler: async (args) => {
				try {
					const dryRun = Boolean(args.flags["dry-run"]);
					const result = await invokeCliTickAbTests(args, {
						dry_run: dryRun,
					});
					OutputUtils.success(
						dryRun
							? `Dry-run: ${result.processed} A/B test(s) would be progressed`
							: `Ticked ${result.processed} A/B test(s)`,
					);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Failed to tick A/B tests: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "reconcile",
			operationId: "abtest.reconcile",
			description: "Reconcile persisted A/B test state against expected lifecycle",
			options: {
				"test-id": option(z.string().trim().min(1).optional(), {
					description: "Test ID (omit to reconcile all tests)",
				}),
				all: option(z.coerce.boolean().default(false), {
					description: "Reconcile every persisted test",
				}),
				repair: option(z.coerce.boolean().default(false), {
					description: "Apply repairs for detected drift (destructive)",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const result = await invokeCliReconcileAbTest(args, {
						test_id: flags["test-id"],
						all: flags.all,
						repair: flags.repair,
					});
					OutputUtils.success(
						`Reconciled ${result.reconciled} A/B test(s)`,
					);
					OutputUtils.json(result);
				} catch (error) {
					throw new Error(
						`Failed to reconcile A/B tests: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "delete",
			operationId: "abtest.delete",
			description: "Delete an A/B test from persisted store",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					await invokeCliDeleteAbTest(
						args,
						{ test_id: flags["test-id"] },
					);
					OutputUtils.success(`A/B test deleted: ${flags["test-id"]}`);
				} catch (error) {
					throw new Error(
						`Failed to delete A/B test: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
	],
});
