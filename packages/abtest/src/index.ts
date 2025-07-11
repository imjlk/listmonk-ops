// A/B Testing domain models - only domain logic not covered by openapi
export interface AbTest {
	id: string;
	name: string;
	campaignId: string;
	variants: Variant[];
	status: "draft" | "running" | "completed";
	metrics: Metric[];
	winnerVariantId?: string;
	createdAt: Date;
	updatedAt: Date;
}

export interface Variant {
	id: string;
	name: string;
	percentage: number;
	contentOverrides: {
		subject?: string;
		body?: string;
		sendTime?: Date;
		senderName?: string;
		senderEmail?: string;
	};
}

export interface Metric {
	id: string;
	name: string;
	type: "open_rate" | "click_rate" | "conversion" | "revenue" | "custom";
	config?: Record<string, unknown>;
}

export interface TestResults {
	variantId: string;
	sampleSize: number;
	opens: number;
	clicks: number;
	conversions: number;
	revenue?: number;
	openRate: number;
	clickRate: number;
	conversionRate: number;
}

export interface TestAnalysis {
	testId: string;
	results: TestResults[];
	analysis: StatisticalAnalysis;
	winner: Variant | null;
	recommendations: string[];
}

export interface StatisticalAnalysis {
	zScore: number;
	pValue: number;
	isSignificant: boolean;
	confidenceLevel: number;
	sampleSize: number;
}

export interface AbTestConfig {
	name: string;
	campaignId: string;
	variants: Omit<Variant, "id">[];
	metrics: Omit<Metric, "id">[];
}

export interface AbTestInput {
	name: string;
	campaignId: string;
	variants: Omit<Variant, "id">[];
}

// A/B/C Testing Service - supports up to 3 variants (A, B, C)
export class AbTestService {
	private static readonly MAX_VARIANTS = 3;
	private static readonly VARIANT_LABELS = ["A", "B", "C"];

	async createTest(config: AbTestConfig): Promise<AbTest> {
		// Validate number of variants (2-3 variants allowed)
		if (config.variants.length < 2) {
			throw new Error("At least 2 variants are required for A/B testing");
		}
		if (config.variants.length > AbTestService.MAX_VARIANTS) {
			throw new Error(
				`Maximum ${AbTestService.MAX_VARIANTS} variants allowed (A/B/C testing)`,
			);
		}

		// Validate percentage distribution
		const totalPercentage = config.variants.reduce(
			(sum, variant) => sum + variant.percentage,
			0,
		);
		if (Math.abs(totalPercentage - 100) > 0.01) {
			throw new Error(
				`Variant percentages must sum to 100%, got ${totalPercentage}%`,
			);
		}

		// Generate unique ID for the test
		const testId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

		// Add IDs to variants using A/B/C labeling
		const variants: Variant[] = config.variants.map((variant, index) => ({
			...variant,
			id: `variant_${AbTestService.VARIANT_LABELS[index]}_${testId}`,
		}));

		// Add IDs to metrics
		const metrics: Metric[] = config.metrics.map((metric, index) => ({
			...metric,
			id: `metric_${index + 1}_${testId}`,
		}));

		const now = new Date();

		const abTest: AbTest = {
			id: testId,
			name: config.name,
			campaignId: config.campaignId,
			variants,
			metrics,
			status: "draft",
			createdAt: now,
			updatedAt: now,
		};

		// TODO: Store in database or external storage
		// For now, just return the created test
		return abTest;
	}

	async getTest(_testId: string): Promise<AbTest | null> {
		// TODO: Retrieve from database
		// For now, return null
		return null;
	}

	async getTestResults(_testId: string): Promise<TestResults[]> {
		// TODO: Fetch actual results from Listmonk API
		// For now, return mock data for A/B/C testing
		return [
			{
				variantId: "variant_A",
				sampleSize: 1000,
				opens: 250,
				clicks: 50,
				conversions: 10,
				openRate: 25.0,
				clickRate: 5.0,
				conversionRate: 1.0,
			},
			{
				variantId: "variant_B",
				sampleSize: 1000,
				opens: 280,
				clicks: 65,
				conversions: 15,
				openRate: 28.0,
				clickRate: 6.5,
				conversionRate: 1.5,
			},
			{
				variantId: "variant_C",
				sampleSize: 1000,
				opens: 260,
				clicks: 58,
				conversions: 12,
				openRate: 26.0,
				clickRate: 5.8,
				conversionRate: 1.2,
			},
		];
	}

	async analyzeStatisticalSignificance(
		results: TestResults[],
	): Promise<StatisticalAnalysis> {
		if (results.length < 2) {
			throw new Error("At least 2 variants required for statistical analysis");
		}
		if (results.length > AbTestService.MAX_VARIANTS) {
			throw new Error(
				`Maximum ${AbTestService.MAX_VARIANTS} variants supported for analysis`,
			);
		}

		// For A/B/C testing, we compare the best performing variant against the control (first variant)
		const controlGroup = results[0];
		if (!controlGroup) {
			throw new Error("Invalid test results data: missing control group");
		}

		// Find the best performing variant (highest conversion rate)
		const bestVariant = results.reduce((best, current) =>
			current.conversionRate > best.conversionRate ? current : best,
		);

		// If control is the best, compare with second best
		const testGroup =
			bestVariant.variantId === controlGroup.variantId
				? results.find((r) => r.variantId !== controlGroup.variantId) ||
					results[1]
				: bestVariant;

		if (!testGroup) {
			throw new Error("Invalid test results data: missing test group");
		}

		// Simple Z-test implementation for conversion rates
		const p1 = controlGroup.conversionRate / 100;
		const p2 = testGroup.conversionRate / 100;
		const n1 = controlGroup.sampleSize;
		const n2 = testGroup.sampleSize;

		const pooledP =
			(controlGroup.conversions + testGroup.conversions) / (n1 + n2);
		const standardError = Math.sqrt(
			pooledP * (1 - pooledP) * (1 / n1 + 1 / n2),
		);
		const zScore = Math.abs(p1 - p2) / standardError;

		// Calculate p-value (simplified)
		const pValue = 2 * (1 - this.standardNormalCDF(Math.abs(zScore)));

		return {
			zScore,
			pValue,
			isSignificant: pValue < 0.05,
			confidenceLevel: 0.95,
			sampleSize: n1 + n2,
		};
	}

	private standardNormalCDF(z: number): number {
		// Approximation of standard normal CDF
		return 0.5 * (1 + this.erf(z / Math.sqrt(2)));
	}

	private erf(x: number): number {
		// Approximation of error function
		const a1 = 0.254829592;
		const a2 = -0.284496736;
		const a3 = 1.421413741;
		const a4 = -1.453152027;
		const a5 = 1.061405429;
		const p = 0.3275911;

		const sign = x >= 0 ? 1 : -1;
		x = Math.abs(x);

		const t = 1.0 / (1.0 + p * x);
		const y =
			1.0 -
			((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

		return sign * y;
	}

	async analyzeTest(testId: string): Promise<TestAnalysis> {
		const test = await this.getTest(testId);
		if (!test) {
			throw new Error(`Test with ID ${testId} not found`);
		}

		const results = await this.getTestResults(testId);
		const analysis = await this.analyzeStatisticalSignificance(results);

		// Determine winner based on conversion rate and statistical significance
		const winner = analysis.isSignificant
			? test.variants.find((v) =>
					results.find(
						(r) =>
							r.variantId === v.id &&
							r.conversionRate ===
								Math.max(...results.map((res) => res.conversionRate)),
					),
				) || null
			: null;

		// Generate recommendations
		const recommendations = this.generateRecommendations(
			results,
			analysis,
			winner,
		);

		return {
			testId,
			results,
			analysis,
			winner,
			recommendations,
		};
	}

	private generateRecommendations(
		results: TestResults[],
		analysis: StatisticalAnalysis,
		winner: Variant | null,
	): string[] {
		const recommendations: string[] = [];

		if (!analysis.isSignificant) {
			recommendations.push(
				"Results are not statistically significant. Consider running the test longer or increasing sample size.",
			);
		}

		if (winner) {
			const winnerResult = results.find((r) => r.variantId === winner.id);
			if (winnerResult) {
				recommendations.push(
					`Variant ${winner.name} is the winner with ${winnerResult.conversionRate.toFixed(2)}% conversion rate.`,
				);
			}
		}

		const maxSampleSize = Math.max(...results.map((r) => r.sampleSize));
		if (maxSampleSize < 1000) {
			recommendations.push(
				"Consider collecting more data for more reliable results (recommended: 1000+ conversions per variant).",
			);
		}

		// Check for significant differences in sample sizes
		const minSampleSize = Math.min(...results.map((r) => r.sampleSize));
		if ((maxSampleSize - minSampleSize) / maxSampleSize > 0.1) {
			recommendations.push(
				"Sample sizes vary significantly between variants. Ensure equal traffic distribution.",
			);
		}

		return recommendations;
	}
}
