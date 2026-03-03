import type { ListmonkAbTestIntegration } from "./listmonk-integration";
import { StatisticalUtils } from "./statistical-utils";
import type {
	AbTest,
	AbTestConfig,
	StatisticalAnalysis,
	TestAnalysis,
	TestResults,
	TestValidationResult,
	Variant,
} from "./types";

/**
 * A/B/C Testing Service - supports up to 3 variants (A, B, C)
 */
export class AbTestService {
	private static readonly MAX_VARIANTS = 3;
	private static readonly VARIANT_LABELS = ["A", "B", "C"];
	private tests: Map<string, AbTest> = new Map();

	constructor(private listmonkIntegration?: ListmonkAbTestIntegration) {}

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

		// Validate test configuration and provide statistical recommendations
		if (this.listmonkIntegration) {
			const shouldLogStatSummary =
				process.env.LISTMONK_OPS_ABTEST_SILENT !== "1";
			const totalSubscribers =
				await this.listmonkIntegration.getTotalSubscribers(
					config.baseConfig.lists,
				);

			const testingMode = config.testingMode || "holdout";
			const testGroupPercentage =
				config.testGroupPercentage || (testingMode === "holdout" ? 10 : 100);

			const validationResult = StatisticalUtils.validateTestConfiguration(
				totalSubscribers,
				testGroupPercentage,
				config.variants.length,
				config.ignoreStatisticalWarnings || false,
			);

			if (!validationResult.isValid) {
				throw new Error(
					`Test configuration invalid: ${validationResult.errors.join(", ")}`,
				);
			}

			// Log warnings for user awareness
			if (shouldLogStatSummary && validationResult.warnings.length > 0) {
				console.warn("⚠️ A/B Test Configuration Warnings:");
				validationResult.warnings.forEach((warning) => {
					console.warn(`  - ${warning}`);
				});
			}

			// Log recommendations
			if (
				shouldLogStatSummary &&
				validationResult.sampleSizeRecommendation?.recommendations?.length
			) {
				console.info("💡 A/B Test Recommendations:");
				validationResult.sampleSizeRecommendation.recommendations.forEach(
					(rec) => {
						console.info(`  - ${rec}`);
					},
				);
			}

			// Log statistical summary
			if (shouldLogStatSummary && validationResult.sampleSizeRecommendation) {
				const rec = validationResult.sampleSizeRecommendation;
				console.info("📊 Statistical Summary:");
				console.info(
					`  - Total subscribers: ${rec.totalSubscribers.toLocaleString()}`,
				);
				console.info(
					`  - Test group: ${rec.currentTestPercentage}% (${Math.floor((rec.totalSubscribers * rec.currentTestPercentage) / 100).toLocaleString()} subscribers)`,
				);
				console.info(
					`  - Expected sample per variant: ${rec.expectedSamplePerVariant.toLocaleString()}`,
				);
				console.info(
					`  - Recommended minimum: ${rec.minimumSamplePerVariant.toLocaleString()} per variant`,
				);
				console.info(
					`  - Statistical power: ${(rec.statisticalPower * 100).toFixed(1)}%`,
				);
				if (rec.currentTestPercentage < rec.recommendedTestPercentage) {
					console.info(
						`  - Recommended test group: ${rec.recommendedTestPercentage}%`,
					);
				}
			}
		}

		// Generate unique ID for the test
		const testId = `test_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

		// Add IDs to variants using A/B/C labeling
		const variants: Variant[] = config.variants.map((variant, index) => ({
			...variant,
			id: `variant_${AbTestService.VARIANT_LABELS[index]}_${testId}`,
		}));

		// Add IDs to metrics
		const metrics = config.metrics.map((metric, index) => ({
			...metric,
			id: `metric_${index + 1}_${testId}`,
		}));

		const now = new Date();

		// Determine testing mode and calculate group sizes
		const testingMode = config.testingMode || "holdout";
		const testGroupPercentage = Math.max(
			1,
			Math.min(
				100,
				config.testGroupPercentage || (testingMode === "holdout" ? 10 : 100),
			),
		);
		const confidenceThreshold = config.confidenceThreshold || 0.95;
		const autoDeployWinner = config.autoDeployWinner || false;

		const abTest: AbTest = {
			id: testId,
			name: config.name,
			campaignId: config.campaignId,
			variants,
			metrics,
			status: "draft",
			createdAt: now,
			updatedAt: now,
			baseConfig: config.baseConfig,
			testingMode,
			testGroupPercentage,
			testGroupSize: 0, // Will be calculated during segmentation
			holdoutGroupSize: 0, // Will be calculated during segmentation
			confidenceThreshold,
			autoDeployWinner,
			campaignMappings: [],
			testListMappings: [],
		};

		// Store in memory (in production, use database)
		this.tests.set(testId, abTest);

		// Create Listmonk campaigns if integration is available
		if (this.listmonkIntegration) {
			try {
				const campaignMappings =
					await this.listmonkIntegration.createTestCampaigns(
						abTest,
						config.baseConfig,
					);

				// Use appropriate segmentation method based on testing mode
				let testListMappings: { variantId: string; listId: number }[];
				let holdoutListId: number | undefined;
				let testGroupSize: number;
				let holdoutGroupSize: number;

				if (testingMode === "holdout") {
					// Use holdout methodology
					const segmentationResult =
						await this.listmonkIntegration.segmentSubscribersForHoldout(
							config.baseConfig.lists,
							variants,
							testGroupPercentage,
						);

					testListMappings = segmentationResult.testListMappings;
					holdoutListId = segmentationResult.holdoutListId;
					testGroupSize = segmentationResult.testGroupSize;
					holdoutGroupSize = segmentationResult.holdoutGroupSize;
				} else {
					// Use full-split methodology (legacy)
					testListMappings = await this.listmonkIntegration.segmentSubscribers(
						config.baseConfig.lists,
						variants,
					);

					// Calculate group sizes for full-split
					const totalSubscribers =
						await this.listmonkIntegration.getTotalSubscribers(
							config.baseConfig.lists,
						);
					testGroupSize = totalSubscribers;
					holdoutGroupSize = 0;
				}

				abTest.campaignMappings = campaignMappings;
				abTest.testListMappings = testListMappings;
				abTest.holdoutListId = holdoutListId;
				abTest.testGroupSize = testGroupSize;
				abTest.holdoutGroupSize = holdoutGroupSize;
				abTest.status = config.autoLaunch ? "running" : "draft";

				// Auto-launch if configured
				if (config.autoLaunch) {
					await this.listmonkIntegration.launchTest(
						campaignMappings,
						testListMappings,
					);
				}

				this.tests.set(testId, abTest);
			} catch (error) {
				console.error("Failed to create Listmonk campaigns:", error);
				// Return test in draft state if campaign creation fails
			}
		}

		return abTest;
	}

	async getTest(testId: string): Promise<AbTest | null> {
		return this.tests.get(testId) || null;
	}

	async getAllTests(): Promise<AbTest[]> {
		return Array.from(this.tests.values());
	}

	/**
	 * Hydrate tests from external persistent storage.
	 * This allows CLI processes to restore previous in-memory state.
	 */
	hydrateTests(tests: AbTest[]): void {
		this.tests.clear();

		for (const rawTest of tests) {
			const hydratedTest: AbTest = {
				...rawTest,
				createdAt: new Date(rawTest.createdAt),
				updatedAt: new Date(rawTest.updatedAt),
				variants: rawTest.variants.map((variant) => ({
					...variant,
					contentOverrides: {
						...variant.contentOverrides,
						sendTime: variant.contentOverrides.sendTime
							? new Date(variant.contentOverrides.sendTime)
							: undefined,
					},
				})),
			};

			this.tests.set(hydratedTest.id, hydratedTest);
		}
	}

	/**
	 * Export tests to an external persistence layer.
	 */
	snapshotTests(): AbTest[] {
		return Array.from(this.tests.values());
	}

	async deleteTest(testId: string): Promise<boolean> {
		const test = this.tests.get(testId);
		if (!test) {
			return false;
		}

		// Cleanup Listmonk resources
		if (this.listmonkIntegration && test.status === "running") {
			if (test.testingMode === "holdout" && test.holdoutListId) {
				// Use holdout cleanup
				await this.listmonkIntegration.cleanupHoldoutTest(
					testId,
					test.testListMappings.map((m) => m.listId),
					test.holdoutListId,
					test.campaignMappings.map((m) => m.campaignId),
					false, // Don't keep winner campaign during cleanup
				);
			} else {
				// Use legacy cleanup for full-split
				await this.listmonkIntegration.cleanup(
					testId,
					test.testListMappings.map((m) => m.listId),
					test.campaignMappings.map((m) => m.campaignId),
				);
			}
		}

		this.tests.delete(testId);
		return true;
	}

	async updateTestStatus(
		testId: string,
		status: AbTest["status"],
	): Promise<AbTest | null> {
		const test = this.tests.get(testId);
		if (!test) {
			return null;
		}

		test.status = status;
		test.updatedAt = new Date();
		this.tests.set(testId, test);

		return test;
	}

	async getTestResults(testId: string): Promise<TestResults[]> {
		const test = this.tests.get(testId);
		if (!test) {
			throw new Error(`Test with ID ${testId} not found`);
		}

		// If Listmonk integration is available, get real results
		if (this.listmonkIntegration && test.campaignMappings.length > 0) {
			try {
				return await this.listmonkIntegration.collectTestResults(
					testId,
					test.campaignMappings,
				);
			} catch (error) {
				console.error("Failed to collect test results:", error);
				// Fall back to mock data
			}
		}

		// Return mock data for testing
		return test.variants.map((variant) => {
			const baseRate = 25 + Math.random() * 10;
			const sampleSize = 1000 + Math.floor(Math.random() * 500);
			const opens = Math.floor(sampleSize * (baseRate / 100));
			const clicks = Math.floor(opens * 0.2);
			const conversions = Math.floor(clicks * 0.15);

			return {
				variantId: variant.id,
				sampleSize,
				opens,
				clicks,
				conversions,
				openRate: (opens / sampleSize) * 100,
				clickRate: (clicks / sampleSize) * 100,
				conversionRate: (conversions / sampleSize) * 100,
			};
		});
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
		const totalSampleSize = n1 + n2;

		// Guard against zero-sample comparisons, which otherwise produce NaN.
		if (n1 === 0 || n2 === 0) {
			return {
				zScore: 0,
				pValue: 1,
				isSignificant: false,
				confidenceLevel: 0.95,
				sampleSize: totalSampleSize,
			};
		}

		const pooledP =
			(controlGroup.conversions + testGroup.conversions) / totalSampleSize;
		const standardError = Math.sqrt(
			pooledP * (1 - pooledP) * (1 / n1 + 1 / n2),
		);
		if (!Number.isFinite(standardError) || standardError === 0) {
			return {
				zScore: 0,
				pValue: 1,
				isSignificant: false,
				confidenceLevel: 0.95,
				sampleSize: totalSampleSize,
			};
		}

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

	async getSampleSizeRecommendation(
		lists: number[],
		testPercentage: number,
		variantCount: number = 2,
	): Promise<TestValidationResult> {
		if (!this.listmonkIntegration) {
			throw new Error("Listmonk integration not available");
		}

		const totalSubscribers =
			await this.listmonkIntegration.getTotalSubscribers(lists);

		return StatisticalUtils.validateTestConfiguration(
			totalSubscribers,
			testPercentage,
			variantCount,
			false, // Don't ignore warnings
		);
	}

	async deployWinner(testId: string): Promise<void> {
		const test = await this.getTest(testId);
		if (!test) {
			throw new Error(`Test with ID ${testId} not found`);
		}

		// Only deploy winner for holdout tests
		if (test.testingMode !== "holdout") {
			throw new Error("Winner deployment is only available for holdout tests");
		}

		if (!test.holdoutListId) {
			throw new Error("No holdout group available for winner deployment");
		}

		// Analyze test to determine winner
		const analysis = await this.analyzeTest(testId);
		if (!analysis.winner) {
			throw new Error("No statistically significant winner found");
		}

		// Deploy winner to holdout group
		if (this.listmonkIntegration) {
			try {
				test.status = "deploying";
				this.tests.set(testId, test);

				const winnerCampaignId =
					await this.listmonkIntegration.deployWinnerToHoldout(
						analysis.winner,
						test.holdoutListId,
						test.baseConfig,
						testId,
					);

				// Auto-launch winner campaign if configured
				if (test.autoDeployWinner) {
					await this.listmonkIntegration.autoDeployWinner(winnerCampaignId);
				}

				test.winnerCampaignId = winnerCampaignId;
				test.winnerVariantId = analysis.winner.id;
				test.status = "completed";
				test.updatedAt = new Date();

				this.tests.set(testId, test);
			} catch (error) {
				test.status = "analyzing";
				this.tests.set(testId, test);
				throw error;
			}
		} else {
			throw new Error("Listmonk integration not available");
		}
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

// Types are now imported from ./types.ts
