import type {
	ListmonkAbTestIntegration,
	ProvisionedAbTestResources,
} from "./listmonk-integration";
import type { MetricsCollector } from "./metrics";
import { AbTestMetricsUnavailableError } from "./metrics";
import { StatisticalUtils } from "./statistical-utils";
import {
	applyHolmCorrection,
	checkSRM,
	DEFAULT_STATISTICAL_POLICY,
	fixedHorizonGate,
} from "./statistics";
import type {
	AbTest,
	AbTestConfig,
	StatisticalAnalysis,
	TestAnalysis,
	TestResults,
	TestValidationResult,
	Variant,
} from "./types";
import { ABTEST_SAFETY_LEAD_SECONDS, TERMINAL_STATUSES } from "./types";

/**
 * A/B/C Testing Service - supports up to 3 variants (A, B, C)
 */
export class AbTestService {
	private static readonly MAX_VARIANTS = 3;
	private static readonly VARIANT_LABELS = ["A", "B", "C"];
	private tests: Map<string, AbTest> = new Map();

	constructor(
		private listmonkIntegration?: ListmonkAbTestIntegration,
		private metricsCollector?: MetricsCollector,
	) {}

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

		// Create Listmonk campaigns if integration is available
		if (this.listmonkIntegration) {
			let provisionedResources: ProvisionedAbTestResources = {
				testId,
				campaignIds: [],
				testListIds: [],
			};

			try {
				const campaignMappings =
					await this.listmonkIntegration.createTestCampaigns(
						abTest,
						config.baseConfig,
					);
				provisionedResources = {
					...provisionedResources,
					campaignIds: campaignMappings.map((mapping) => mapping.campaignId),
				};

				// Use appropriate segmentation method based on testing mode
				let testListMappings: { variantId: string; listId: number }[];
				let holdoutListId: number | undefined;
				let testGroupSize: number;
				let holdoutGroupSize: number;

				if (testingMode === "holdout") {
					// Use holdout methodology with deterministic assignment.
					const segmentationResult =
						await this.listmonkIntegration.segmentSubscribersForHoldout(
							config.baseConfig.lists,
							variants,
							testGroupPercentage,
							{ testId: abTest.id },
						);

					testListMappings = segmentationResult.testListMappings;
					holdoutListId = segmentationResult.holdoutListId;
					testGroupSize = segmentationResult.testGroupSize;
					holdoutGroupSize = segmentationResult.holdoutGroupSize;
					// Persist the deterministic-provisioning metadata so
					// retries and reconciliation reuse the same split.
					abTest.assignmentSeed = segmentationResult.assignmentSeed;
					abTest.audienceSnapshot = segmentationResult.audienceSnapshot;
					abTest.assignmentManifest = segmentationResult.assignmentManifest;
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
				provisionedResources = {
					...provisionedResources,
					testListIds: testListMappings.map((mapping) => mapping.listId),
					holdoutListId,
				};

				abTest.campaignMappings = campaignMappings;
				abTest.testListMappings = testListMappings;
				abTest.holdoutListId = holdoutListId;
				abTest.testGroupSize = testGroupSize;
				abTest.holdoutGroupSize = holdoutGroupSize;
				abTest.status = "draft";
				// Persist orchestration metadata from the config.
				if (config.durationHours !== undefined) {
					abTest.durationHours = config.durationHours;
				}
				// Persist launchAt on the record regardless of autoLaunch so
				// a draft with a planned launch time retains it for later
				// explicit launch via launchAbTest.
				if (config.launchAt !== undefined) {
					abTest.launchAt = config.launchAt;
				}

				// Auto-launch: schedule campaigns with a shared send_at and
				// transition to 'scheduled'. When launchAt is provided, use it
				// directly; otherwise use now + safety lead time.
				if (config.autoLaunch) {
					const sendAt =
						config.launchAt ??
						new Date(
							Date.now() + ABTEST_SAFETY_LEAD_SECONDS * 1000,
						).toISOString();
					await this.listmonkIntegration.launchTest(
						campaignMappings,
						testListMappings,
						{ sendAt },
					);
					abTest.status = "scheduled";
					abTest.launchAt = sendAt;
					abTest.startedAt = new Date().toISOString();
					if (abTest.durationHours !== undefined) {
						abTest.endsAt = new Date(
							new Date(sendAt).getTime() +
								abTest.durationHours * 3600 * 1000,
						).toISOString();
					}
				}
			} catch (error) {
				try {
					await this.listmonkIntegration.rollbackProvisioning(
						provisionedResources,
					);
				} catch (rollbackError) {
					console.error(
						"Failed to rollback Listmonk A/B test provisioning:",
						rollbackError,
					);
				}

				throw error;
			}
		}

		this.tests.set(testId, abTest);
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

		// Cleanup Listmonk resources for any test that has remote campaigns.
		// Use deleteTestResources which is status-aware: it cancels running
		// campaigns before deleting (Listmonk v6.2.0 rejects DELETE on
		// running campaigns), and throws on failure so the local record
		// persists for retry/reconcile.
		if (
			this.listmonkIntegration &&
			!TERMINAL_STATUSES.has(test.status) &&
			test.campaignMappings.length > 0
		) {
			const listIds = test.testListMappings.map((m) => m.listId);
			if (test.holdoutListId !== undefined) {
				listIds.push(test.holdoutListId);
			}
			await this.listmonkIntegration.deleteTestResources({
				campaignIds: [
					...test.campaignMappings.map((m) => m.campaignId),
					...(test.winnerCampaignId !== undefined
						? [test.winnerCampaignId]
						: []),
				],
				listIds,
			});
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

		// Prefer an injected MetricsCollector (test-only simulated collector
		// or a future production collector). Otherwise fall back to the
		// ListmonkAbTestIntegration, which is now fail-closed. Use `return
		// await` so this frame stays on the stack if the promise rejects,
		// making AbTestMetricsUnavailableError easier to trace.
		if (this.metricsCollector) {
			return await this.metricsCollector.collect(test);
		}

		if (this.listmonkIntegration) {
			// collectTestResults throws AbTestMetricsUnavailableError on any
			// fetch failure; do not swallow it into mock data.
			return await this.listmonkIntegration.collectTestResults(
				testId,
				test.campaignMappings,
			);
		}

		// No collector and no integration: fail closed. Production factories
		// always wire a ListmonkAbTestIntegration; tests that need metrics
		// inject a SimulatedMetricsCollector.
		throw new AbTestMetricsUnavailableError(
			testId,
			new Error("no metrics collector or Listmonk integration is configured"),
		);
	}

	async analyzeStatisticalSignificance(
		results: TestResults[],
		confidenceThreshold: number = 0.95,
	): Promise<StatisticalAnalysis> {
		if (results.length < 2) {
			throw new Error("At least 2 variants required for statistical analysis");
		}
		if (results.length > AbTestService.MAX_VARIANTS) {
			throw new Error(
				`Maximum ${AbTestService.MAX_VARIANTS} variants supported for analysis`,
			);
		}
		if (
			!Number.isFinite(confidenceThreshold) ||
			confidenceThreshold <= 0 ||
			confidenceThreshold >= 1
		) {
			throw new Error(
				`confidenceThreshold must be a finite number in (0, 1), received ${confidenceThreshold}`,
			);
		}

		const alpha = 1 - confidenceThreshold;

		// For A/B/C testing, we compare the best performing variant against the control (first variant)
		const controlGroup = results[0];
		if (!controlGroup) {
			throw new Error("Invalid test results data: missing control group");
		}

		// Pick the comparison metric via the shared selector so the
		// significance test and the winner selection cannot diverge.
		const { rate: metricRate, label: metricLabel } =
			this.pickMetricRate(results);
		const anyConversionMeasured = metricLabel === "conversion rate";
		const metricCount = (r: TestResults): number =>
			anyConversionMeasured ? r.conversions : r.clicks;

		// Find the best performing variant by the chosen metric.
		const bestVariant = results.reduce((best, current) =>
			metricRate(current) > metricRate(best) ? current : best,
		);

		// If control is the best, compare against the true second-best
		// (highest-scoring non-control), not just the first non-control that
		// happens to appear in the array. Guard against the data-integrity
		// edge case where every result shares the control's variantId.
		let testGroup: TestResults;
		if (bestVariant.variantId === controlGroup.variantId) {
			const nonControl = results.filter(
				(r) => r.variantId !== controlGroup.variantId,
			);
			if (nonControl.length === 0) {
				throw new Error(
					"Invalid test results data: no non-control variant found for comparison",
				);
			}
			testGroup = nonControl.reduce((best, current) =>
				metricRate(current) > metricRate(best) ? current : best,
			);
		} else {
			testGroup = bestVariant;
		}

		// Two-proportion Z-test on the chosen metric.
		const p1 = metricRate(controlGroup) / 100;
		const p2 = metricRate(testGroup) / 100;
		const n1 = controlGroup.sampleSize;
		const n2 = testGroup.sampleSize;
		const totalSampleSize = n1 + n2;

		// Guard against zero-sample comparisons, which otherwise produce NaN.
		if (n1 === 0 || n2 === 0) {
			return {
				zScore: 0,
				pValue: 1,
				isSignificant: false,
				confidenceLevel: confidenceThreshold,
				sampleSize: totalSampleSize,
			};
		}

		const pooledP =
			(metricCount(controlGroup) + metricCount(testGroup)) / totalSampleSize;
		const standardError = Math.sqrt(
			pooledP * (1 - pooledP) * (1 / n1 + 1 / n2),
		);
		if (!Number.isFinite(standardError) || standardError === 0) {
			return {
				zScore: 0,
				pValue: 1,
				isSignificant: false,
				confidenceLevel: confidenceThreshold,
				sampleSize: totalSampleSize,
			};
		}

		const zScore = Math.abs(p1 - p2) / standardError;

		// Calculate p-value (two-tailed)
		const pValue = 2 * (1 - this.standardNormalCDF(Math.abs(zScore)));

		// For A/B/C (3+ variants), apply Holm-Bonferroni correction to the
		// family of pairwise comparisons. The winner must survive correction
		// against every non-control variant to be declared significant.
		if (results.length > 2) {
			// Compute pairwise p-values: control vs each non-control variant.
			const nonControlResults = results.filter(
				(r) => r.variantId !== controlGroup.variantId,
			);
			const pairwisePValues = nonControlResults.map((variant) => {
				const pv = metricRate(variant) / 100;
				const nv = variant.sampleSize;
				if (nv === 0 || n1 === 0) return 1;
				const pooled =
					(metricCount(controlGroup) + metricCount(variant)) /
					(n1 + nv);
				const se = Math.sqrt(
					pooled * (1 - pooled) * (1 / n1 + 1 / nv),
				);
				if (!Number.isFinite(se) || se === 0) return 1;
				const z = Math.abs(metricRate(controlGroup) / 100 - pv) / se;
				return 2 * (1 - this.standardNormalCDF(z));
			});

			const holmResult = applyHolmCorrection(pairwisePValues, alpha);
			// Find the best variant's index in the pairwise array.
			const bestIdx = nonControlResults.findIndex(
				(r) => r.variantId === testGroup.variantId,
			);
			const correctedPValue = holmResult.adjustedPValues[bestIdx] ?? 1;

			// The winner must survive Holm correction AND be significantly
			// separated from the second-best treatment. If the top two
			// treatments are not statistically distinguishable, the test is
			// inconclusive even if both beat control.
			const isHolmSignificant = holmResult.significant[bestIdx] ?? false;

			// Additionally, check the winner vs the second-best treatment.
			// Sort non-control results by metric rate descending.
			const sortedNonControl = [...nonControlResults].sort(
				(a, b) => metricRate(b) - metricRate(a),
			);
			let isTopTwoSeparated = true;
			if (sortedNonControl.length > 1) {
				const second = sortedNonControl[1];
				if (second) {
					const secondIdx = nonControlResults.findIndex(
						(r) => r.variantId === second.variantId,
					);
					if (
						secondIdx >= 0 &&
						!(holmResult.significant[bestIdx] ?? false) &&
						(holmResult.significant[secondIdx] ?? false)
					) {
						// Winner is not significant but second-best is —
						// they are too close to call.
						isTopTwoSeparated = false;
					}
				}
			}

			return {
				zScore,
				pValue,
				correctedPValue,
				holmCorrected: true,
				isSignificant: isHolmSignificant && isTopTwoSeparated,
				confidenceLevel: confidenceThreshold,
				sampleSize: n1 + n2,
			};
		}

		return {
			zScore,
			pValue,
			isSignificant: pValue < alpha,
			confidenceLevel: confidenceThreshold,
			sampleSize: n1 + n2,
		};
	}

	/**
	 * Build the metric selector used by both the significance test and the
	 * winner selection. Prefers conversion rate when any conversions are
	 * actually measured; otherwise falls back to click rate, since
	 * conversions are zero everywhere until a conversion event store exists.
	 */
	private pickMetricRate(results: TestResults[]): {
		rate: (r: TestResults) => number;
		label: "conversion rate" | "click rate";
	} {
		const anyConversionMeasured = results.some((r) => r.conversions > 0);
		return anyConversionMeasured
			? { rate: (r) => r.conversionRate, label: "conversion rate" }
			: { rate: (r) => r.clickRate, label: "click rate" };
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
		const analysis = await this.analyzeStatisticalSignificance(
			results,
			test.confidenceThreshold,
		);

		// Run the fixed-horizon eligibility gate. If the test is not ready,
		// suppress the winner and record the reason codes so operators know
		// why no decision was made.
		const gateResult = fixedHorizonGate({
			endsAt: test.endsAt,
			startedAt: test.startedAt,
			now: Date.now(),
			policy: DEFAULT_STATISTICAL_POLICY,
			sampleSizes: results.map((r) => r.sampleSize),
		});
		analysis.fixedHorizonReasonCodes = gateResult.reasonCodes;

		// Run SRM check if we have assignment manifest group counts.
		if (test.assignmentManifest) {
			const expected = test.assignmentManifest.groups
				.filter((g) => g.kind === "variant")
				.map((g) => g.expectedCount);
			const observed = results.map((r) => r.sampleSize);
			if (expected.length === observed.length && expected.length >= 2) {
				const srmResult = checkSRM(expected, observed, 0.001);
				analysis.srmPassed = srmResult.passed;
				analysis.srmPValue = srmResult.pValue;
			}
		}

		// Suppress winner if gates have not passed.
		const gatesPassed = gateResult.ready && analysis.srmPassed !== false;

		// Pick the winner on the same metric the significance test used, via
		// the shared selector so the two cannot drift apart. The selector
		// returns both the rate function and its label so recommendations
		// report the metric actually used (no 0.00% conversion rate for a
		// click-rate winner).
		const { rate: metricRate, label: metricLabel } =
			this.pickMetricRate(results);
		const bestRate = Math.max(...results.map(metricRate));

		const winner = analysis.isSignificant && gatesPassed
			? test.variants.find((v) =>
					results.find(
						(r) => r.variantId === v.id && metricRate(r) === bestRate,
					),
				) || null
			: null;

		// Generate recommendations, reporting the selected metric.
		const recommendations = this.generateRecommendations(
			results,
			analysis,
			winner,
			metricLabel,
			metricRate,
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
		metricLabel: "conversion rate" | "click rate",
		metricRate: (r: TestResults) => number,
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
					`Variant ${winner.name} is the winner with ${metricRate(winnerResult).toFixed(2)}% ${metricLabel}.`,
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
