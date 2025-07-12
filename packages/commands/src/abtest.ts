import type {
	AbTest,
	AbTestConfig,
	AbTestService,
	StatisticalAnalysis,
	TestAnalysis,
	TestResults,
} from "@listmonk-ops/abtest";
import { ValidationError } from "@listmonk-ops/common";
import { BaseCommand } from "./base";

// A/B Test Commands
export class CreateAbTestCommand extends BaseCommand<AbTestConfig, AbTest> {
	constructor(private abTestService: AbTestService) {
		super();
	}

	async execute(input: AbTestConfig): Promise<AbTest> {
		this.validate(input);
		return this.abTestService.createTest(input);
	}

	protected override validate(input: AbTestConfig): void {
		if (!input.name || input.name.trim().length === 0) {
			throw new ValidationError("Test name is required");
		}
		if (input.variants.length < 2) {
			throw new ValidationError("At least 2 variants required");
		}
		if (input.variants.length > 3) {
			throw new ValidationError("Maximum 3 variants allowed (A/B/C testing)");
		}

		// Validate percentage distribution
		const totalPercentage = input.variants.reduce(
			(sum, variant) => sum + variant.percentage,
			0,
		);
		if (Math.abs(totalPercentage - 100) > 0.01) {
			throw new ValidationError(
				`Variant percentages must sum to 100%, got ${totalPercentage}%`,
			);
		}
	}
}

export class AnalyzeAbTestCommand extends BaseCommand<string, TestAnalysis> {
	constructor(private abTestService: AbTestService) {
		super();
	}

	async execute(testId: string): Promise<TestAnalysis> {
		this.validate(testId);

		const results = await this.abTestService.getTestResults(testId);
		const analysis =
			await this.abTestService.analyzeStatisticalSignificance(results);

		// Find the best performing variant
		const bestVariant = results.reduce((best, current) =>
			current.conversionRate > best.conversionRate ? current : best,
		);

		return {
			testId,
			results,
			analysis,
			winner: analysis.isSignificant
				? this.findVariantById(bestVariant.variantId)
				: null,
			recommendations: this.generateRecommendations(analysis, bestVariant),
		};
	}

	protected override validate(testId: string): void {
		if (!testId || testId.trim().length === 0) {
			throw new ValidationError("Test ID is required");
		}
	}

	private findVariantById(_variantId: string) {
		// TODO: Implement variant lookup
		// For now, return null since we need to access the original test data
		return null;
	}

	private generateRecommendations(
		analysis: StatisticalAnalysis,
		bestVariant: TestResults,
	): string[] {
		if (analysis.isSignificant) {
			return [
				`Variant with ${bestVariant.conversionRate.toFixed(2)}% conversion rate is the winner!`,
				"Deploy to full audience.",
				`Confidence level: ${(analysis.confidenceLevel * 100).toFixed(1)}%`,
			];
		} else {
			return [
				"Not statistically significant yet.",
				"Continue testing to gather more data.",
				`Current p-value: ${analysis.pValue.toFixed(4)}`,
			];
		}
	}
}

// A/B Test command executors factory
export function createAbTestExecutors(abTestService: AbTestService) {
	return {
		createAbTest: (config: AbTestConfig): Promise<AbTest> =>
			new CreateAbTestCommand(abTestService).execute(config),

		analyzeAbTest: (testId: string): Promise<TestAnalysis> =>
			new AnalyzeAbTestCommand(abTestService).execute(testId),
	};
}
