import { generateAssignmentSeed } from "./assignment";
import { createHash } from "node:crypto";
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
import {
	isStrictIsoTimestamp,
	lockHypothesis,
	validateHypothesisMetadata,
	verifyHypothesisChecksum,
	type HypothesisMetadata,
} from "./hypothesis";
import type {
	AbTest,
	AbTestConfig,
	StatisticalAnalysis,
	TestAnalysis,
	TestResults,
	TestValidationResult,
	Variant,
} from "./types";
import { AbTestConflictError } from "./errors";
import { ABTEST_SAFETY_LEAD_SECONDS, TERMINAL_STATUSES } from "./types";

/**
 * A/B/C Testing Service - supports up to 3 variants (A, B, C)
 */

function canonicalizeConfigValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalizeConfigValue);
	}
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.keys(record)
				.sort()
				.map((key) => [key, canonicalizeConfigValue(record[key])]),
		);
	}
	return value;
}

/**
 * Canonical fingerprint of a create request. Adapter-equivalent requests
 * (one omitting a default, another supplying it explicitly) hash equally
 * because callers fingerprint the fully defaulted config. Per-call
 * placeholders (the synthesized base campaign id and the hypothesis
 * lock timestamp) are excluded so retries derive the same fingerprint.
 */
export function fingerprintAbTestConfig(config: AbTestConfig): string {
	const { idempotencyKey: _key, ...payload } = config;
	const { createdAt: _createdAt, ...hypothesis } = payload.hypothesis ?? {};
	// Normalize the defaults the service applies during provisioning so
	// requests differing only in omitted defaults hash equally.
	const testingMode = payload.testingMode ?? "holdout";
	const normalized = {
		...payload,
		testingMode,
		testGroupPercentage:
			payload.testGroupPercentage ?? (testingMode === "holdout" ? 10 : 100),
		confidenceThreshold: payload.confidenceThreshold ?? 0.95,
		autoDeployWinner: payload.autoDeployWinner ?? false,
		// Explicit false and an omitted flag behave identically at runtime.
		autoLaunch: payload.autoLaunch ?? false,
		ignoreStatisticalWarnings: payload.ignoreStatisticalWarnings ?? false,
		...(hypothesis ? { hypothesis } : {}),
	};
	return createHash("sha256")
		.update(JSON.stringify(canonicalizeConfigValue(normalized)))
		.digest("hex");
}

export class AbTestService {
	private static readonly MAX_VARIANTS = 3;
	private static readonly VARIANT_LABELS = ["A", "B", "C"];
	private tests: Map<string, AbTest> = new Map();

	constructor(
		private listmonkIntegration?: ListmonkAbTestIntegration,
		private metricsCollector?: MetricsCollector,
	) {}

	private readonly inFlightKeyedCreates = new Map<
		string,
		{ fingerprint: string; creation: Promise<AbTest> }
	>();

	async createTest(config: AbTestConfig): Promise<AbTest> {
		if (config.idempotencyKey !== undefined) {
			// Direct library consumers are not serialized by the operation
			// wrapper, so reserve the key while provisioning is in flight:
			// a concurrent caller with the same key and the same request
			// awaits this creation instead of provisioning a second set of
			// campaigns and lists, while a different request under the same
			// key conflicts exactly as a persisted replay would.
			const key = config.idempotencyKey;
			const fingerprint = fingerprintAbTestConfig(config);
			const inFlight = this.inFlightKeyedCreates.get(key);
			if (inFlight) {
				if (inFlight.fingerprint !== fingerprint) {
					throw new AbTestConflictError(
						`Idempotency key already used by a different create request: ${key}`,
					);
				}
				return inFlight.creation;
			}
			const creation = this.createUnreservedTest(config).finally(() => {
				this.inFlightKeyedCreates.delete(key);
			});
			this.inFlightKeyedCreates.set(key, { fingerprint, creation });
			return creation;
		}

		return this.createUnreservedTest(config);
	}

	private async createUnreservedTest(config: AbTestConfig): Promise<AbTest> {
		const { test, replayed } = await this.recordCreateIntent(config);
		if (replayed) {
			return test;
		}
		try {
			return await this.provisionTest(test);
		} catch (error) {
			// An unkeyed create has no replay path, so a failed provision
			// discards the unreachable draft rather than accumulating it.
			if (config.idempotencyKey === undefined) {
				this.tests.delete(test.id);
			}
			throw error;
		}
	}

	/**
	 * Validate the create request and persist a draft record carrying the
	 * replay key before any remote provisioning runs, so an ambiguous retry
	 * resumes the original creation instead of provisioning duplicates.
	 * Returns the persisted draft and whether it was an existing replay.
	 */
	async recordCreateIntent(
		config: AbTestConfig,
	): Promise<{ test: AbTest; replayed: boolean }> {
		if (config.idempotencyKey !== undefined) {
			const existing = await this.getTestByIdempotencyKey(
				config.idempotencyKey,
			);
			if (existing) {
				if (
					existing.idempotencyFingerprint !== undefined &&
					existing.idempotencyFingerprint !== fingerprintAbTestConfig(config)
				) {
					throw new AbTestConflictError(
						`Idempotency key already used by a different create request: ${config.idempotencyKey}`,
					);
				}
				// A completed creation is a replay; a persisted-but-unprovisioned
				// intent resumes provisioning instead. Records persisted before
				// intent-first creation carry neither marker and count as
				// completed legacy creations.
				const completed =
					existing.provisionedAt !== undefined ||
					existing.pendingCreate === undefined;
				return { test: existing, replayed: completed };
			}
		}

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
		if (
			config.testGroupPercentage !== undefined &&
			(!Number.isFinite(config.testGroupPercentage) ||
				config.testGroupPercentage <= 0 ||
				config.testGroupPercentage > 100)
		) {
			throw new Error(
				"testGroupPercentage must be a finite number in (0, 100]",
			);
		}
		if (
			config.confidenceThreshold !== undefined &&
			(!Number.isFinite(config.confidenceThreshold) ||
				config.confidenceThreshold <= 0 ||
				config.confidenceThreshold >= 1)
		) {
			throw new Error("confidenceThreshold must be a finite number in (0, 1)");
		}
		if (
			config.minimumTestSampleSize !== undefined &&
			(!Number.isSafeInteger(config.minimumTestSampleSize) ||
				config.minimumTestSampleSize <= 0)
		) {
			throw new Error("minimumTestSampleSize must be a positive integer");
		}
		if (
			config.durationHours !== undefined &&
			(!Number.isFinite(config.durationHours) || config.durationHours <= 0)
		) {
			throw new Error("durationHours must be a positive finite number");
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
				config.testGroupPercentage ?? (testingMode === "holdout" ? 10 : 100);

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
		const testGroupPercentage =
			config.testGroupPercentage ?? (testingMode === "holdout" ? 10 : 100);
		const confidenceThreshold = config.confidenceThreshold ?? 0.95;
		const autoDeployWinner = config.autoDeployWinner ?? false;

		const draftTest: AbTest = {
			id: testId,
			name: config.name,
			idempotencyKey: config.idempotencyKey,
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
			// Lock the pre-registration hypothesis before any provisioning so the
			// assignment manifest is bound to a frozen, checksummed hypothesis.
			// When a caller supplies an already-locked hypothesis, validate it
			// strictly and verify its checksum before accepting it, so tampered
			// or malformed metadata cannot reach remote campaign/list provisioning.
				hypothesis: config.hypothesis
					? config.hypothesis.lockedAt
						? (() => {
								validateHypothesisMetadata(config.hypothesis!, true);
								if (
									!isStrictIsoTimestamp(config.hypothesis!.lockedAt)
								) {
									throw new Error(
										"Pre-locked hypothesis lockedAt is not a valid ISO 8601 timestamp",
									);
								}
								if (!verifyHypothesisChecksum(config.hypothesis!)) {
									throw new Error(
										"Pre-locked hypothesis checksum verification failed; the metadata may have been tampered with",
									);
								}
								// Deep-clone so the stored test's hypothesis is
								// detached from the caller's config object.
								return structuredClone(config.hypothesis!);
							})()
						: lockHypothesis(config.hypothesis)
					: undefined,
			idempotencyFingerprint: fingerprintAbTestConfig(config),
			pendingCreate: { config },
		};
		this.tests.set(draftTest.id, draftTest);
		return { test: draftTest, replayed: false };
	}

	/**
	 * Run remote provisioning for a persisted create intent and finalize it.
	 * A test whose provisioning already completed is returned unchanged.
	 */

	/**
	 * Shared finalization for the provision flow: applies orchestration
	 * metadata, auto-launches when configured, and marks the record
	 * provisioned. Split out so the phased executor's checkpoint-adoption
	 * path converges with the fresh-provisioning path.
	 */
	private async finalizeProvisionedTest(
		test: AbTest,
		config: AbTestConfig,
	): Promise<AbTest> {
		// Apply the accepted orchestration metadata in the shared path so
		// checkpoint adoption and fresh provisioning persist identically.
		if (config.durationHours !== undefined) {
			test.durationHours = config.durationHours;
		}
		if (config.minimumTestSampleSize !== undefined) {
			test.minimumTestSampleSize = config.minimumTestSampleSize;
		}
		if (config.launchAt !== undefined) {
			test.launchAt = config.launchAt;
		}
		// Auto-launch: schedule campaigns with a shared send_at and
		// transition to 'scheduled'. When launchAt is provided, use it
		// directly; otherwise use now + safety lead time. The chosen window
		// is stamped on the record BEFORE the remote schedule so a crash
		// mid-launch leaves the window inspectable (the phased executor
		// commits this stamp in its own checkpoint step).
		if (config.autoLaunch) {
			const sendAt =
				test.launchAt ??
				config.launchAt ??
				new Date(
					Date.now() + ABTEST_SAFETY_LEAD_SECONDS * 1000,
				).toISOString();
			test.launchAt = sendAt;
			const integration = this.listmonkIntegration;
			if (!integration) {
				throw new Error("Listmonk integration not available");
			}
			await integration.launchTest(
				test.campaignMappings,
				test.testListMappings,
				{ sendAt },
			);
			test.status = "scheduled";
			test.launchAt = sendAt;
			test.startedAt = new Date().toISOString();
			if (test.durationHours !== undefined) {
				test.endsAt = new Date(
					new Date(sendAt).getTime() +
						test.durationHours * 3600 * 1000,
				).toISOString();
			}
		}
		test.provisionedAt = new Date().toISOString();
		test.updatedAt = new Date();
		delete test.pendingCreate;
		this.tests.set(test.id, test);
		return test;
	}

	/**
	 * Campaign provisioning phase: reconciles campaigns already tagged for
	 * this test (including ones whose mapping was lost to a crash between
	 * remote creation and the checkpoint commit), creates only the missing
	 * variants, and records the mapping on the in-memory record — the
	 * executor commits this checkpoint before segmentation runs.
	 */
	async provisionCampaignsPhase(test: AbTest): Promise<AbTest> {
		if (test.provisionedAt !== undefined || test.campaignMappings.length > 0) {
			return test;
		}
		const config = test.pendingCreate?.config;
		if (config === undefined) {
			return test;
		}
		if (!this.listmonkIntegration) {
			return test;
		}
		const tagged = await this.listmonkIntegration.findCampaignsByTestTag(
			test.id,
		);
		const mappings: Array<{ variantId: string; campaignId: number }> = [];
		for (const variant of test.variants) {
			const matches = tagged.filter((campaign) =>
				campaign.tags.includes(`variant:${variant.id}`),
			);
			if (matches.length > 1) {
				throw new Error(
					`Ambiguous campaigns tagged variant:${variant.id} for test ${test.id}; resolve the duplicates before retrying`,
				);
			}
			if (matches.length === 1) {
				const campaignId = matches[0]!.id;
				if (mappings.some((m) => m.campaignId === campaignId)) {
					// A malformed campaign tagged for two variants would be
					// adopted twice, silently stranding one variant.
					throw new Error(
						`Campaign ${campaignId} is tagged for multiple variants of test ${test.id}; correct the tags before retrying`,
					);
				}
				mappings.push({ variantId: variant.id, campaignId });
			}
		}
		if (mappings.length < test.variants.length) {
			// Create only variants with no reconciled campaign; the
			// deterministic `abtest:` and `variant:` tags make any later
			// retry re-reconcile these too.
			const created =
				await this.listmonkIntegration.createTestCampaignsForVariants(
					test,
					config.baseConfig,
					test.variants
						.filter(
							(variant) =>
								!mappings.some((m) => m.variantId === variant.id),
						)
						.map((variant) => variant.id),
				);
			mappings.push(...created);
		}
		test.campaignMappings = mappings;
		return test;
	}

	/**
	 * Segmentation seed checkpoint: stamps the deterministic assignment seed
	 * on the record so the phased executor can commit it before any
	 * segmentation list is created — a retry then re-splits identically.
	 */
	async recordSegmentationSeedPhase(test: AbTest): Promise<AbTest> {
		if (
			test.provisionedAt !== undefined ||
			test.assignmentSeed !== undefined ||
			test.testingMode !== "holdout"
		) {
			return test;
		}
		test.assignmentSeed = generateAssignmentSeed();
		return test;
	}

	/**
	 * Auto-launch window checkpoint: stamps the deterministic sendAt on the
	 * record (preferring an already-stamped window so retries never
	 * recompute it) so the phased executor can commit it before any remote
	 * scheduling runs.
	 */
	async recordAutoLaunchWindowPhase(test: AbTest): Promise<AbTest> {
		if (test.provisionedAt !== undefined) {
			return test;
		}
		const config = test.pendingCreate?.config;
		if (config === undefined || !config.autoLaunch) {
			return test;
		}
		test.launchAt =
			test.launchAt ??
			config.launchAt ??
			new Date(
				Date.now() + ABTEST_SAFETY_LEAD_SECONDS * 1000,
			).toISOString();
		return test;
	}

	/**
	 * Segmentation phase: computes (or, when the checkpoint already carries
	 * the split, reuses) the audience split and records the test-list
	 * mappings and deterministic assignment metadata — the executor commits
	 * this checkpoint before finalization.
	 */
	async provisionSegmentationPhase(test: AbTest): Promise<AbTest> {
		if (test.provisionedAt !== undefined || test.campaignMappings.length === 0) {
			return test;
		}
		if (test.testListMappings.length > 0) {
			return test;
		}
		const config = test.pendingCreate?.config;
		if (config === undefined || !this.listmonkIntegration) {
			return test;
		}
		if (test.testingMode === "holdout") {
			// Adopt lists a prior crashed attempt tagged for this test and
			// reuse the persisted seed so the re-split is identical and the
			// membership re-sync is idempotent.
			const existingLists =
				await this.listmonkIntegration.findListsByTestTag(test.id);
			const segmentationResult =
				await this.listmonkIntegration.segmentSubscribersForHoldout(
					config.baseConfig.lists,
					test.variants,
					test.testGroupPercentage,
					{
						testId: test.id,
						assignmentSeed: test.assignmentSeed,
						stratificationPolicy: config.stratificationPolicy,
						existingLists,
					},
				);
			test.testListMappings = segmentationResult.testListMappings;
			test.holdoutListId = segmentationResult.holdoutListId;
			test.testGroupSize = segmentationResult.testGroupSize;
			test.holdoutGroupSize = segmentationResult.holdoutGroupSize;
			test.assignmentSeed = segmentationResult.assignmentSeed;
			test.audienceSnapshot = segmentationResult.audienceSnapshot;
			test.assignmentManifest = segmentationResult.assignmentManifest;
			test.assignmentProvenance = "manifest_v1";
			if (segmentationResult.stratification) {
				test.stratification = segmentationResult.stratification;
			}
		} else {
			test.testListMappings =
				await this.listmonkIntegration.segmentSubscribers(
					config.baseConfig.lists,
					test.variants,
					test.id,
				);
			const totalSubscribers =
				await this.listmonkIntegration.getTotalSubscribers(
					config.baseConfig.lists,
				);
			test.testGroupSize = totalSubscribers;
			test.holdoutGroupSize = 0;
			test.assignmentProvenance = "legacy_unavailable";
		}
		return test;
	}

	async provisionTest(test: AbTest): Promise<AbTest> {
		if (test.provisionedAt !== undefined) {
			return test;
		}
		const config = test.pendingCreate?.config;
		if (config === undefined) {
			// Legacy drafts recorded before intent-first persistence have no
			// payload; treat them as completed drafts rather than failing.
			return test;
		}
		// Create Listmonk campaigns if integration is available
		if (this.listmonkIntegration) {
			// Rollback only what THIS invocation created: resources committed
			// by earlier checkpoint phases belong to the persisted record and
			// must survive a failed finalization so the retry can resume.
			const adoptedListIds = new Set(
				test.testListMappings.map((mapping) => mapping.listId),
			);
			let provisionedResources: ProvisionedAbTestResources = {
				testId: test.id,
				campaignIds: [],
				testListIds: [],
			};

			try {
				// The phased executor checkpoints each stage; when the
				// campaign checkpoint is already present, adopt it instead of
				// re-creating (and reconciling protects the crash window).
				const adoptedCampaignIds = new Set(
					test.campaignMappings.map((mapping) => mapping.campaignId),
				);
				const campaignMappings =
					test.campaignMappings.length > 0
						? test.campaignMappings
						: await this.listmonkIntegration.createTestCampaigns(
								test,
								config.baseConfig,
							);
				provisionedResources = {
					...provisionedResources,
					// Only resources created in THIS invocation roll back;
					// adopted checkpoint mappings survive a failed
					// finalization so the retry can resume them.
					campaignIds: campaignMappings
						.map((mapping) => mapping.campaignId)
						.filter((id) => !adoptedCampaignIds.has(id)),
				};

				if (test.testListMappings.length > 0) {
					// Segmentation checkpoint already committed by the phased
					// executor; adopt it instead of re-splitting. Adopted
					// lists belong to the persisted checkpoint and never roll
					// back, so the rollback set stays empty here.
					test.campaignMappings = campaignMappings;
					test.status = "draft";
					// Awaited inside the try so a failed auto-launch still
					// triggers the rollback path below.
					return await this.finalizeProvisionedTest(test, config);
				}

				// Use appropriate segmentation method based on testing mode
				let testListMappings: { variantId: string; listId: number }[];
				let holdoutListId: number | undefined;
				let testGroupSize: number;
				let holdoutGroupSize: number;

				if (test.testingMode === "holdout") {
					// Use holdout methodology with deterministic assignment.
					const segmentationResult =
						await this.listmonkIntegration.segmentSubscribersForHoldout(
							config.baseConfig.lists,
							test.variants,
							test.testGroupPercentage,
							{
								testId: test.id,
								stratificationPolicy: config.stratificationPolicy,
							},
						);

					testListMappings = segmentationResult.testListMappings;
					holdoutListId = segmentationResult.holdoutListId;
					testGroupSize = segmentationResult.testGroupSize;
					holdoutGroupSize = segmentationResult.holdoutGroupSize;
					// Persist the deterministic-provisioning metadata so
					// retries and reconciliation reuse the same split.
					test.assignmentSeed = segmentationResult.assignmentSeed;
					test.audienceSnapshot = segmentationResult.audienceSnapshot;
					test.assignmentManifest = segmentationResult.assignmentManifest;
					// Record that recipients were assigned through a deterministic
					// manifest, so consumers can distinguish it from legacy splits.
					test.assignmentProvenance = "manifest_v1";
					// Capture the stratified quota matrix when a stratification
					// policy produced one, so reports can show per-provider shares.
					if (segmentationResult.stratification) {
						test.stratification = segmentationResult.stratification;
					}
				} else {
					// Use full-split methodology (legacy)
					testListMappings =
						await this.listmonkIntegration.segmentSubscribers(
							config.baseConfig.lists,
							test.variants,
							test.id,
						);

					// Calculate group sizes for full-split
					const totalSubscribers =
						await this.listmonkIntegration.getTotalSubscribers(
							config.baseConfig.lists,
						);
					testGroupSize = totalSubscribers;
					holdoutGroupSize = 0;
					// Full-split provisioning predates deterministic manifests.
					test.assignmentProvenance = "legacy_unavailable";
				}
				provisionedResources = {
					...provisionedResources,
					// Adopted checkpoint mappings survive a failed
					// finalization; only this invocation's new lists roll back.
					testListIds: testListMappings
						.map((mapping) => mapping.listId)
						.filter((id) => !adoptedListIds.has(id)),
					holdoutListId: adoptedListIds.has(holdoutListId ?? -1)
						? undefined
						: holdoutListId,
				};

				test.campaignMappings = campaignMappings;
				test.testListMappings = testListMappings;
				test.holdoutListId = holdoutListId;
				test.testGroupSize = testGroupSize;
				test.holdoutGroupSize = holdoutGroupSize;
				test.status = "draft";
				// Persist orchestration metadata from the config.
				if (config.durationHours !== undefined) {
					test.durationHours = config.durationHours;
				}
				if (config.minimumTestSampleSize !== undefined) {
					test.minimumTestSampleSize = config.minimumTestSampleSize;
				}
				// Persist launchAt on the record regardless of autoLaunch so
				// a draft with a planned launch time retains it for later
				// explicit launch via launchAbTest.
				if (config.launchAt !== undefined) {
					test.launchAt = config.launchAt;
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
					test.status = "scheduled";
					test.launchAt = sendAt;
					test.startedAt = new Date().toISOString();
					if (test.durationHours !== undefined) {
						test.endsAt = new Date(
							new Date(sendAt).getTime() +
								test.durationHours * 3600 * 1000,
						).toISOString();
					}
				}
			} catch (error) {
				try {
					const { deletedCampaignIds, deletedListIds } =
						await this.listmonkIntegration.rollbackProvisioning(
							provisionedResources,
						);
					// Only confirmed deletions leave the mapping table; a
					// best-effort delete that failed keeps its mapping so the
					// retry reconciles the surviving tagged resource instead
					// of creating a duplicate.
					const rolledBackCampaigns = new Set(deletedCampaignIds);
					const rolledBackLists = new Set(deletedListIds);
					test.campaignMappings = test.campaignMappings.filter(
						(mapping) => !rolledBackCampaigns.has(mapping.campaignId),
					);
					test.testListMappings = test.testListMappings.filter(
						(mapping) => !rolledBackLists.has(mapping.listId),
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
		test.provisionedAt = new Date().toISOString();
		test.updatedAt = new Date();
		delete test.pendingCreate;
		this.tests.set(test.id, test);
		return test;
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

	async getTestByIdempotencyKey(key: string): Promise<AbTest | null> {
		for (const test of this.tests.values()) {
			if (test.idempotencyKey === key) {
				return test;
			}
		}
		return null;
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
		hypothesis?: HypothesisMetadata,
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
		const { rate: metricRate, label: metricLabel, direction: metricDirection } =
			this.pickMetricRate(results, hypothesis);
		// revenue_per_recipient is a continuous monetary metric that cannot
		// be tested with the two-proportion Z-test used here. Reject it
		// explicitly until a dedicated statistical test is implemented.
		if (metricLabel === "revenue per recipient") {
			throw new Error(
				"revenue_per_recipient metric is not yet supported by the significance test; use click_rate or conversion_rate",
			);
		}
		const anyConversionMeasured = metricLabel === "conversion rate";
		const metricCount = (r: TestResults): number =>
			anyConversionMeasured ? r.conversions : r.clicks;

		// Find the best performing variant by the chosen metric, respecting
		// the direction from the pre-registered hypothesis (or default
		// maximize for legacy tests).
		const isBetter =
			metricDirection === "minimize"
				? (a: number, b: number) => a < b
				: (a: number, b: number) => a > b;
		const bestVariant = results.reduce((best, current) =>
			isBetter(metricRate(current), metricRate(best)) ? current : best,
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
				isBetter(metricRate(current), metricRate(best)) ? current : best,
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

			// Direct winner vs runner-up comparison across ALL variants
			// (including control). Only append the top-two p-value to the
			// Holm family when it is a treatment-vs-treatment comparison
			// (not already in pairwisePValues as a control-vs-treatment).
			// Sort by metric rate respecting direction so the top-two
			// comparison uses the correct ranking.
			const sortedAll = [...results].sort((a, b) =>
				metricDirection === "minimize"
					? metricRate(a) - metricRate(b)
					: metricRate(b) - metricRate(a),
			);
			let isTopTwoSeparated = true;
			if (sortedAll.length > 1) {
				const bestTreatment = sortedAll[0];
				const secondTreatment = sortedAll[1];
				if (bestTreatment && secondTreatment) {
					// Check if either top performer is the control — if so,
					// the comparison is already in pairwisePValues.
					const involvesControl =
						bestTreatment.variantId === controlGroup.variantId ||
						secondTreatment.variantId === controlGroup.variantId;
					const pBest = metricRate(bestTreatment) / 100;
					const pSecond = metricRate(secondTreatment) / 100;
					const nBest = bestTreatment.sampleSize;
					const nSecond = secondTreatment.sampleSize;
					if (nBest > 0 && nSecond > 0) {
						const pooledTwo =
							(metricCount(bestTreatment) +
								metricCount(secondTreatment)) /
							(nBest + nSecond);
						const seTwo = Math.sqrt(
							pooledTwo *
								(1 - pooledTwo) *
								(1 / nBest + 1 / nSecond),
						);
						if (
							Number.isFinite(seTwo) &&
							seTwo > 0
						) {
							const zTwo =
								Math.abs(pBest - pSecond) / seTwo;
							const pTwo = 2 * (1 - this.standardNormalCDF(zTwo));
							if (involvesControl) {
								// Already in pairwisePValues — use the
								// existing Holm result.
								const existingIdx = nonControlResults.findIndex(
									(r) =>
										r.variantId ===
										(bestTreatment.variantId ===
										controlGroup.variantId
											? secondTreatment.variantId
											: bestTreatment.variantId),
								);
								isTopTwoSeparated =
									holmResult.significant[existingIdx] ?? false;
							} else {
								// Treatment-vs-treatment: append to the
								// Holm family.
								const allPValues = [...pairwisePValues, pTwo];
								const allHolm = applyHolmCorrection(allPValues, alpha);
								isTopTwoSeparated =
									allHolm.significant[allPValues.length - 1] ??
									false;
							}
						} else if (pBest === pSecond) {
							isTopTwoSeparated = false;
						}
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
	 * winner selection. When a pre-registered hypothesis is present, its
	 * declared primary metric and direction drive the selection. Otherwise
	 * falls back to the observed-data heuristic (conversion rate when any
	 * conversions are measured, otherwise click rate).
	 */
	private pickMetricRate(
		results: TestResults[],
		hypothesis?: HypothesisMetadata,
	): {
		rate: (r: TestResults) => number;
		label: "conversion rate" | "click rate" | "revenue per recipient";
		direction: "maximize" | "minimize";
	} {
		if (hypothesis) {
			const type = hypothesis.primaryMetric.type;
			const direction = hypothesis.primaryMetric.direction;
			if (type === "conversion_rate") {
				return {
					rate: (r) => r.conversionRate,
					label: "conversion rate",
					direction,
				};
			}
			if (type === "revenue_per_recipient") {
				// revenue_per_recipient uses revenue divided by sample size;
				// fall back to conversion rate when revenue is not collected.
				return {
					rate: (r) =>
						r.revenue !== undefined && r.sampleSize > 0
							? r.revenue / r.sampleSize
							: 0,
					label: "revenue per recipient",
					direction,
				};
			}
			// click_rate
			return {
				rate: (r) => r.clickRate,
				label: "click rate",
				direction,
			};
		}
		// Legacy fallback
		const anyConversionMeasured = results.some((r) => r.conversions > 0);
		return anyConversionMeasured
			? {
					rate: (r) => r.conversionRate,
					label: "conversion rate",
					direction: "maximize",
				}
			: {
					rate: (r) => r.clickRate,
					label: "click rate",
					direction: "maximize",
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

		// Reject an unverifiable hypothesis before analysis so a tampered
		// or incomplete pre-registration cannot influence metric selection
		// or winner decisions.
		if (test.hypothesis) {
			if (!test.hypothesis.lockedAt || !test.hypothesis.checksum) {
				throw new Error(
					`Hypothesis for test ${testId} is not locked; cannot use an unlocked hypothesis for analysis`,
				);
			}
			if (!verifyHypothesisChecksum(test.hypothesis)) {
				throw new Error(
					`Hypothesis checksum verification failed for test ${testId}; the pre-registered metadata may have been tampered with`,
				);
			}
		}

		const results = await this.getTestResults(testId);
		const analysis = await this.analyzeStatisticalSignificance(
			results,
			test.confidenceThreshold,
			test.hypothesis,
		);

		// Run the fixed-horizon eligibility gate. If the test is not ready,
		// suppress the winner and record the reason codes so operators know
		// why no decision was made.
		// Build a per-test policy from the test's own settings.
		const testPolicy: typeof DEFAULT_STATISTICAL_POLICY = {
			...DEFAULT_STATISTICAL_POLICY,
			confidenceLevel: test.confidenceThreshold,
			minimumDurationHours:
				test.durationHours ?? DEFAULT_STATISTICAL_POLICY.minimumDurationHours,
			minimumSamplePerVariant:
				test.minimumTestSampleSize ??
				DEFAULT_STATISTICAL_POLICY.minimumSamplePerVariant,
		};
		// Use launchAt as the duration reference when available, since it
		// represents when the campaigns actually started sending. Fall back
		// to startedAt for backward compatibility.
		const durationRef = test.launchAt ?? test.startedAt;
		const gateResult = fixedHorizonGate({
			endsAt: test.endsAt,
			startedAt: durationRef,
			now: Date.now(),
			policy: testPolicy,
			sampleSizes: results.map((r) => r.sampleSize),
		});
		analysis.fixedHorizonReasonCodes = gateResult.reasonCodes;

		// Run SRM check. Prefer assignment manifest group counts; for
		// full-split tests without a manifest, derive expected counts from
		// variant percentages and the total test group size.
		let srmExpected: number[] | null = null;
		if (test.assignmentManifest) {
			srmExpected = test.assignmentManifest.groups
				.filter((g) => g.kind === "variant")
				.map((g) => g.expectedCount);
		} else if (test.testingMode === "full-split") {
			// Derive expected from variant percentages and total sample.
			const totalSample = results.reduce((sum, r) => sum + r.sampleSize, 0);
			srmExpected = test.variants.map((v) =>
				Math.round((v.percentage / 100) * totalSample),
			);
		}
		if (srmExpected) {
			const observed = results.map((r) => r.sampleSize);
			if (srmExpected.length === observed.length && srmExpected.length >= 2) {
				const srmResult = checkSRM(srmExpected, observed, 0.001);
				analysis.srmPassed = srmResult.passed;
				analysis.srmPValue = srmResult.pValue;
			} else {
				analysis.srmPassed = false;
				analysis.srmPValue = 1;
				analysis.fixedHorizonReasonCodes = [
					...(analysis.fixedHorizonReasonCodes ?? []),
					"srm_input_mismatch",
				];
			}
		}

		// Suppress winner if gates have not passed. Also suppress
		// isSignificant so the lifecycle tick does not mark the test
		// 'completed' when the gate says no decision should be made.
		const gatesPassed = gateResult.ready && analysis.srmPassed !== false;
		if (!gatesPassed) {
			analysis.isSignificant = false;
		}

		// Pick the winner on the same metric the significance test used, via
		// the shared selector so the two cannot drift apart. The selector
		// returns both the rate function, its label, and direction so
		// minimize-direction hypotheses select the lowest-scoring variant.
		const {
			rate: metricRate,
			label: metricLabel,
			direction: metricDirection,
		} = this.pickMetricRate(results, test.hypothesis);
		const bestRate =
			metricDirection === "minimize"
				? Math.min(...results.map(metricRate))
				: Math.max(...results.map(metricRate));

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

		// Deploy winner to holdout group. An already-deployed winner
		// campaign — tagged winner:deployed for this test, whether by a
		// completed prior call or one whose local commit was lost — is
		// adopted instead of creating a second campaign, so an ambiguous
		// retry converges on the same holdout delivery.
		if (this.listmonkIntegration) {
			// A failed invocation must leave the persisted lifecycle where
			// this call found it: restoring a terminal `completed` test to
			// `analyzing` on a transient adoption-lookup failure would make
			// run/tick eligible to process an already-finished test again.
			const originalStatus = test.status;
			try {
				const existing =
					await this.listmonkIntegration.findCampaignsByTestTag(testId);
				const deployed = existing.filter((campaign) =>
					campaign.tags.includes("winner:deployed"),
				);
				if (deployed.length > 1) {
					throw new Error(
						`Test ${testId} has ${deployed.length} campaigns tagged winner:deployed (${deployed.map((campaign) => campaign.id).join(", ")}); exactly one is required, so resolve the duplicates manually before deploying`,
					);
				}
				const adopted = deployed[0];
				if (adopted) {
					// The adopted campaign must carry exactly one variant tag
					// and it must be the variant the current analysis selected:
					// delayed metrics can change the analyzed winner after the
					// first attempt already delivered a different variant.
					const variantIds = adopted.tags
						.filter((tag) => tag.startsWith("variant:"))
						.map((tag) => tag.slice("variant:".length));
					const adoptedVariantId = variantIds.length === 1
						? variantIds[0]
						: undefined;
					if (!adoptedVariantId) {
						throw new Error(
							`Winner campaign ${adopted.id} for test ${testId} carries ambiguous variant tags [${adopted.tags.filter((tag) => tag.startsWith("variant:")).join(", ")}]; resolve the campaign tags manually before deploying`,
						);
					}
					if (adoptedVariantId !== analysis.winner.id) {
						throw new Error(
							`Winner campaign ${adopted.id} for test ${testId} deployed variant ${adoptedVariantId}, but the current analysis selected variant ${analysis.winner.id}; the holdout already received a different variant, so resolve the winner manually instead of adopting the campaign`,
						);
					}

					// Finish an auto-launch the first attempt could not: a
					// created-but-unlaunched campaign stays a draft, and the
					// retry must launch it before completing the test. A
					// campaign that already moved past draft was launched.
					if (test.autoDeployWinner && adopted.status === "draft") {
						await this.listmonkIntegration.autoDeployWinner(adopted.id);
					}

					test.winnerCampaignId = adopted.id;
					test.winnerVariantId = analysis.winner.id;
					test.status = "completed";
					test.updatedAt = new Date();
					this.tests.set(testId, test);
					return;
				}

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
				test.status = originalStatus;
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
		metricLabel: "conversion rate" | "click rate" | "revenue per recipient",
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
