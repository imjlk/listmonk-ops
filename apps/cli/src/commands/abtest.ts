import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { defineCommand, defineGroup, option } from "@bunli/core";
import {
	type AbTest,
	type CreateAbTestInput,
	createAbTestExecutors,
} from "@listmonk-ops/abtest";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";

import {
	parseCsvNumbers,
	parseJson,
	toErrorMessage,
} from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

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

type AbTestStore = {
	version: 1;
	tests: AbTest[];
};

const DEFAULT_STORE_PATH = join(
	Bun.env.HOME || process.cwd(),
	".listmonk-ops",
	"abtests.json",
);

const ABTEST_STORE_PATH =
	Bun.env.LISTMONK_OPS_ABTEST_STORE?.trim() || DEFAULT_STORE_PATH;

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

function buildCreateInputFromFlags(flags: {
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

async function loadStoredTests(): Promise<AbTest[]> {
	try {
		const raw = await readFile(ABTEST_STORE_PATH, "utf8");
		const parsed = JSON.parse(raw) as Partial<AbTestStore>;
		if (!parsed || !Array.isArray(parsed.tests)) {
			return [];
		}

		return parsed.tests;
	} catch (error) {
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return [];
		}

		throw new Error(`Failed to read A/B test store: ${toErrorMessage(error)}`);
	}
}

async function saveStoredTests(tests: AbTest[]): Promise<void> {
	const store: AbTestStore = {
		version: 1,
		tests,
	};

	await mkdir(dirname(ABTEST_STORE_PATH), { recursive: true });
	await writeFile(
		ABTEST_STORE_PATH,
		`${JSON.stringify(store, null, 2)}\n`,
		"utf8",
	);
}

async function getHydratedExecutors(
	args: Parameters<typeof getListmonkClient>[0],
) {
	const client = await getListmonkClient(args);
	const executors = createAbTestExecutors(client);
	const storedTests = await loadStoredTests();
	executors.abTestService.hydrateTests(storedTests);
	return executors;
}

async function persistExecutors(
	executors: ReturnType<typeof createAbTestExecutors>,
): Promise<void> {
	await saveStoredTests(executors.abTestService.snapshotTests());
}

async function promptInteractiveInput(
	clack: typeof import("@bunli/utils").prompt.clack,
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
			description: "List A/B tests from persisted state",
			handler: async (args) => {
				try {
					const executors = await getHydratedExecutors(args);
					const tests = await executors.listAbTests();
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
						createdAt: test.createdAt.toISOString(),
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
					const executors = await getHydratedExecutors(args);
					const { input, autoLaunch } = await promptInteractiveInput(
						prompt.clack,
					);
					const created = await executors.createAbTest(input);

					if (autoLaunch) {
						await executors.launchAbTest(created.id);
					}

					await persistExecutors(executors);

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
					const executors = await getHydratedExecutors(args);
					const input = buildCreateInputFromFlags(flags);
					const created = await executors.createAbTest(input);

					if (flags["auto-launch"]) {
						await executors.launchAbTest(created.id);
					}

					await persistExecutors(executors);
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
			description: "Analyze A/B test results",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const executors = await getHydratedExecutors(args);
					const analysis = await executors.analyzeAbTestSimple(
						flags["test-id"],
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
			name: "get",
			description: "Get A/B test details",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const executors = await getHydratedExecutors(args);
					const test = await executors.getAbTest(flags["test-id"]);
					OutputUtils.json(test);
				} catch (error) {
					throw new Error(`Failed to get A/B test: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "launch",
			description: "Launch a draft A/B test",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const executors = await getHydratedExecutors(args);
					const launched = await executors.launchAbTest(flags["test-id"]);
					await persistExecutors(executors);
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
			description: "Stop a running A/B test",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const executors = await getHydratedExecutors(args);
					const stopped = await executors.stopAbTest(flags["test-id"]);
					await persistExecutors(executors);
					OutputUtils.success(`A/B test stopped: ${flags["test-id"]}`);
					OutputUtils.json(stopped);
				} catch (error) {
					throw new Error(`Failed to stop A/B test: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "delete",
			description: "Delete an A/B test from persisted store",
			options: {
				"test-id": option(z.string().trim().min(1), {
					description: "Test ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const executors = await getHydratedExecutors(args);
					const deleted = await executors.deleteAbTest(flags["test-id"]);
					if (!deleted) {
						throw new Error(`Test with ID ${flags["test-id"]} not found`);
					}

					await persistExecutors(executors);
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
