import type { AbTestConfig } from "@listmonk-ops/abtest";
import { OutputUtils } from "@listmonk-ops/common";
import { defineCommand } from "../lib/definition";
import type { AbTestExecutors, CommandContext } from "./types";

export const createMeta = defineCommand({
	name: "create",
	description: "Create a new A/B/C test (supports 2-3 variants)",
	args: {
		name: {
			type: "string",
			description: "Name of the A/B/C test",
			required: true,
		},
		campaignId: {
			type: "string",
			description: "Base campaign ID for the test",
			required: true,
			toKebab: true,
		},
		variants: {
			type: "string",
			description: "JSON array of 2-3 test variants (A/B/C testing)",
			required: true,
		},
	},
	runner: "executor",
});

export async function createRun(
	executors: AbTestExecutors,
	ctx: CommandContext,
) {
	try {
		const { name, campaignId, variants } = ctx.values;

		let parsedVariants: Array<Record<string, unknown>>;
		try {
			parsedVariants = JSON.parse(variants as string);
		} catch {
			OutputUtils.error("Invalid JSON format for variants");
			process.exit(1);
		}

		// Validate number of variants (2-3 allowed for A/B/C testing)
		if (parsedVariants.length < 2) {
			OutputUtils.error("At least 2 variants are required for A/B testing");
			process.exit(1);
		}
		if (parsedVariants.length > 3) {
			OutputUtils.error("Maximum 3 variants allowed (A/B/C testing)");
			process.exit(1);
		}

		// Validate percentage distribution if provided
		const hasPercentages = parsedVariants.some(
			(v) => typeof v.percentage === "number",
		);
		if (hasPercentages) {
			const totalPercentage = parsedVariants.reduce(
				(sum, v) => sum + (typeof v.percentage === "number" ? v.percentage : 0),
				0,
			);
			if (Math.abs(totalPercentage - 100) > 0.01) {
				OutputUtils.error(
					`Variant percentages must sum to 100%, got ${totalPercentage}%`,
				);
				process.exit(1);
			}
		} else {
			// Auto-assign equal percentages if not provided
			const equalPercentage =
				Math.round((100 / parsedVariants.length) * 10000) / 10000;
			let remainingPercentage = 100;

			for (let i = 0; i < parsedVariants.length - 1; i++) {
				const variant = parsedVariants[i];
				if (variant) {
					variant.percentage = equalPercentage;
					remainingPercentage -= equalPercentage;
				}
			}
			// Assign remaining percentage to last variant to ensure sum is exactly 100
			const lastVariant = parsedVariants[parsedVariants.length - 1];
			if (lastVariant) {
				lastVariant.percentage = remainingPercentage;
			}
		}

		// Create AbTestConfig using core package types
		const testConfig: AbTestConfig = {
			name: name as string,
			campaignId: campaignId as string,
			variants: parsedVariants.map((v) => ({
				name: v.name as string,
				percentage: v.percentage as number,
				contentOverrides: (v.contentOverrides as Record<string, unknown>) || {},
			})),
			metrics: [
				{ name: "Open Rate", type: "open_rate" },
				{ name: "Click Rate", type: "click_rate" },
			],
		};

		const result = await executors.createAbTest(testConfig);

		OutputUtils.success(`A/B test created: ${(result as { id: string }).id}`);
		OutputUtils.json(result);
	} catch (error) {
		OutputUtils.error(
			`Failed to create A/B test: ${error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}

export const analyzeMeta = defineCommand({
	name: "analyze",
	description: "Analyze A/B test results",
	args: {
		testId: {
			type: "string",
			description: "Test ID to analyze",
			required: true,
			toKebab: true,
		},
	},
	runner: "executor",
});

export async function analyzeRun(
	executors: AbTestExecutors,
	ctx: CommandContext,
) {
	try {
		const { testId } = ctx.values;
		OutputUtils.info(`📊 Analyzing A/B test: ${testId}`);

		const analysisResult = await executors.analyzeAbTest(testId as string);
		const analysis = analysisResult as {
			results: Array<{
				sampleSize: number;
				opens: number;
				clicks: number;
				conversions: number;
				openRate: number;
				clickRate: number;
				conversionRate: number;
			}>;
			analysis: { isSignificant: boolean };
			recommendations: string[];
		};

		const testType =
			analysis.results.length === 2
				? "A/B"
				: analysis.results.length === 3
					? "A/B/C"
					: "Multi-variant";
		const variantLabels = ["A", "B", "C"];

		OutputUtils.info(`📊 ${testType} Test Results:`);

		// Convert to display format for table
		const tableData = analysis.results.map((result, index) => ({
			Variant: variantLabels[index] || `V${index + 1}`,
			"Sample Size": result.sampleSize,
			Opens: result.opens,
			Clicks: result.clicks,
			Conversions: result.conversions,
			"Open Rate %": result.openRate.toFixed(1),
			"Click Rate %": result.clickRate.toFixed(1),
			"Conversion Rate %": result.conversionRate.toFixed(1),
		}));

		OutputUtils.table(tableData);

		OutputUtils.info("🔬 Statistical Analysis:");
		OutputUtils.json(analysis.analysis);

		OutputUtils.info("🏆 Winner:");
		if (analysis.analysis.isSignificant && analysis.results.length > 0) {
			const bestVariant = analysis.results.reduce((best, current) =>
				current.conversionRate > best.conversionRate ? current : best,
			);
			const winnerIndex = analysis.results.indexOf(bestVariant);
			const winnerLabel = variantLabels[winnerIndex] || `V${winnerIndex + 1}`;
			OutputUtils.success(
				`Winner: Variant ${winnerLabel} (${bestVariant.conversionRate.toFixed(
					2,
				)}% conversion rate)`,
			);
		} else {
			OutputUtils.warning("No statistically significant winner yet");
		}

		OutputUtils.info("💡 Recommendations:");
		analysis.recommendations.forEach((rec) => OutputUtils.info(`  • ${rec}`));
	} catch (error) {
		OutputUtils.error(
			`Failed to analyze A/B test: ${error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}
