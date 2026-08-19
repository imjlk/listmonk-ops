// A/B Testing domain models

/**
 * Safety lead time (seconds) added to "now" when computing a default
 * send_at for shared variant campaign scheduling. Ensures all variant
 * campaigns receive the same future timestamp even when launched
 * immediately. Shared between createTest auto-launch and launchAbTest.
 */
export const ABTEST_SAFETY_LEAD_SECONDS = 60;

/**
 * Terminal statuses from which a test never transitions further without
 * external intervention. Shared between factory.ts (tick/run progression)
 * and abtest-service.ts (deleteTest cleanup) so both agree on what counts
 * as "done".
 */
export const TERMINAL_STATUSES: ReadonlySet<AbTest["status"]> = new Set([
	"completed",
	"cancelled",
	"inconclusive",
	"failed",
]);

/**
 * Add minimumTestSampleSize to AbTest so the fixed-horizon gate can use
 * the per-test configured minimum instead of only the default.
 */

export interface AbTest {
	id: string;
	name: string;
	/** Caller-scoped create key; replays return the originally created test. */
	idempotencyKey?: string;
	/** Canonical fingerprint of the create request bound to the replay key. */
	idempotencyFingerprint?: string;
	/**
	 * Transient create payload persisted before remote provisioning so an
	 * ambiguous retry resumes instead of provisioning duplicates; removed
	 * once provisioning completes.
	 */
	pendingCreate?: { config: AbTestConfig } | undefined;
	/** Set when remote provisioning has completed for this test. */
	provisionedAt?: string;
	campaignId: string;
	variants: Variant[];
	status:
		| "draft"
		| "testing"
		| "scheduled"
		| "running"
		| "analyzing"
		| "deploying"
		| "cancelling"
		| "completed"
		| "inconclusive"
		| "cancelled"
		| "failed";
	metrics: Metric[];
	winnerVariantId?: string;
	createdAt: Date;
	updatedAt: Date;
	// Listmonk integration fields
	baseConfig: {
		subject: string;
		body: string;
		lists: number[];
		template_id?: number;
	};
	// Testing methodology fields
	testingMode: "holdout" | "full-split";
	testGroupPercentage: number;
	testGroupSize: number;
	holdoutGroupSize: number;
	confidenceThreshold: number;
	autoDeployWinner: boolean;
	// Campaign and list mappings
	campaignMappings: { variantId: string; campaignId: number }[];
	testListMappings: { variantId: string; listId: number }[];
	holdoutListId?: number;
	winnerCampaignId?: number;
	// Deterministic provisioning fields (stage 2). All optional so existing
	// v1 records remain valid; a v2 write fills them in once provisioning runs.
	/**
	 * Cryptographic random seed stored at create time so the assignment
	 * manifest is reproducible across retries and reconciliation.
	 */
	assignmentSeed?: string;
	/**
	 * Immutable snapshot of the resolved audience (size + checksum) at
	 * provisioning time. Pre-sample validation, provisioning, and analysis
	 * all reference this same snapshot.
	 */
	audienceSnapshot?: {
		capturedAt: string;
		sourceListIds: number[];
		subscriberCount: number;
		subscriberChecksum: string;
		eligibilityPolicyVersion: 1;
	};
	/** Per-test minimum sample size for the fixed-horizon gate. */
	minimumTestSampleSize?: number;
	/** Hypothesis metadata for pre-registration (Change Set A). */
	hypothesis?: import("./hypothesis").HypothesisMetadata;
	/** Assignment provenance: whether the test has a deterministic manifest. */
	assignmentProvenance?: "manifest_v1" | "legacy_unavailable";
	/** Recipient-domain stratified quota matrix, computed during provisioning
	 * when a stratification policy is enabled and emails are available. */
	stratification?: import("./stratification").StratificationResult;
	/**
	 * Deterministic assignment manifest produced from the seed + audience.
	 * Once stored, retries and reconciliation reuse it rather than
	 * re-splitting the audience.
	 */
	assignmentManifest?: {
		algorithm: "sha256-order-largest-remainder-v1";
		seed: string;
		audienceChecksum: string;
		groups: (
			| {
					kind: "variant";
					variantId: string;
					expectedCount: number;
					subscriberChecksum: string;
			  }
			| {
					kind: "holdout";
					variantId?: string;
					expectedCount: number;
					subscriberChecksum: string;
			  }
		)[];
		assignedCount: number;
	};
	/**
	 * Monotonic revision counter for optimistic concurrency. Bumped on every
	 * persisted transition so concurrent writers can detect stale updates.
	 */
	revision?: number;
	// Orchestration timestamps (stage 3). All optional so existing records
	// remain valid.
	/** Planned duration in hours, used to compute endsAt from startedAt. */
	durationHours?: number;
	/** ISO timestamp when the test is scheduled to start. */
	launchAt?: string;
	/** ISO timestamp when the test actually started (campaigns launched). */
	startedAt?: string;
	/** ISO timestamp when the test is due to end (startedAt + durationHours). */
	endsAt?: string;
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
	// Stage 4 fields — all optional so existing callers/tests stay valid.
	/** Holm-Bonferroni corrected p-value (same as pValue for 2-variant tests). */
	correctedPValue?: number;
	/** Whether Holm correction was applied (3+ variants). */
	holmCorrected?: boolean;
	/** Whether the SRM (Sample Ratio Mismatch) check passed. */
	srmPassed?: boolean;
	/** SRM p-value if the check was run. */
	srmPValue?: number;
	/** Fixed-horizon gate reason codes if the test was not ready. */
	fixedHorizonReasonCodes?: string[];
}

export interface AbTestConfig {
	name: string;
	/** Caller-scoped create key; replays return the originally created test. */
	idempotencyKey?: string;
	campaignId: string;
	variants: Omit<Variant, "id">[];
	metrics: Omit<Metric, "id">[];
	// Listmonk-specific config
	baseConfig: {
		subject: string;
		body: string;
		lists: number[];
		template_id?: number;
	};
	// Testing methodology settings
	testingMode?: "holdout" | "full-split"; // Default: holdout
	testGroupPercentage?: number; // Default 10% for holdout, 100% for full-split
	minimumTestSampleSize?: number; // Minimum subscribers per variant
	confidenceThreshold?: number; // Statistical significance threshold
	autoLaunch?: boolean;
	autoDeployWinner?: boolean; // Auto-deploy winner to holdout group (holdout mode only)
	ignoreStatisticalWarnings?: boolean; // Skip statistical validation warnings
	// Orchestration settings (stage 3)
	durationHours?: number; // Planned test duration in hours
	launchAt?: string; // ISO timestamp for scheduled launch
	// Pre-registration hypothesis (advanced experimentation). Optional; when
	// provided unlocked, createTest locks it before provisioning so the
	// assignment manifest cannot be separated from a frozen hypothesis.
	hypothesis?: import("./hypothesis").HypothesisMetadata;
	// Recipient-domain stratification policy. When enabled, the holdout
	// provisioning path computes a stratified quota matrix from the audience
	// and stores it on AbTest.stratification. Optional; defaults to the
	// disabled policy.
	stratificationPolicy?: import("./stratification").StratificationPolicyV1;
}

export interface AbTestInput {
	name: string;
	campaignId: string;
	variants: Omit<Variant, "id">[];
}

// Command-specific input types
export interface CreateAbTestInput {
	name: string;
	campaign_id?: string;
	/** Caller-scoped create key; re-running with the same key replays the original test. */
	idempotency_key?: string;
	description?: string;
	auto_launch?: boolean;
	variants: Array<{
		name: string;
		percentage: number; // Percentage within test group (should sum to 100)
		campaign_config: {
			subject?: string;
			body?: string;
			template_id?: number;
		};
	}>;
	lists: number[];
	// Testing methodology settings
	testing_mode?: "holdout" | "full-split"; // Default: holdout
	test_group_percentage?: number; // Range: 1-100%, default 10% for holdout, 100% for full-split
	confidence_threshold?: number; // Default 0.95
	minimum_sample_size?: number; // Minimum per variant
	duration_hours?: number;
	launch_at?: string; // ISO timestamp for scheduled launch
	auto_deploy_winner?: boolean; // Auto-deploy to holdout group (holdout mode only)
	ignore_sample_size_warnings?: boolean; // Skip sample size validation warnings
	// Pre-registration hypothesis. Operators describe the objective, primary
	// metric, expected lift, owner, and experiment scope; the service locks it
	// before assignment so the metadata cannot change after recipients are set.
	hypothesis?: {
		objective: string;
		hypothesis: string;
		primary_metric: {
			type: "click_rate" | "conversion_rate" | "revenue_per_recipient";
			direction: "maximize" | "minimize";
		};
		expected_lift:
			| { kind: "relative"; value: number }
			| {
					kind: "absolute";
					value: number;
					unit: "percentage_point" | "currency_per_recipient";
				};
		owner: { id: string; display_name?: string };
		experiment_scope: {
			channel: "email";
			experiment_family_key: string;
			attribution_window_hours: number;
			exclusion_window_hours: number;
		};
	};
	// Enable recipient-domain stratification during holdout provisioning.
	// When true, the service applies the default stratification policy
	// (gmail/naver/daum/kakao + other/unknown fallbacks) and stores the
	// computed quota matrix on AbTest.stratification.
	enable_stratification?: boolean;
}

export interface AnalyzeAbTestInput {
	test_id: string;
	include_recommendations?: boolean;
}

export interface AbTestQueryParams {
	status?:
		| "draft"
		| "testing"
		| "scheduled"
		| "running"
		| "analyzing"
		| "deploying"
		| "cancelling"
		| "completed"
		| "inconclusive"
		| "cancelled"
		| "failed";
	order_by?: "name" | "status" | "created_at" | "updated_at";
	order?: "asc" | "desc";
	page?: number;
	per_page?: number;
}

// Statistical analysis helper types
export interface SampleSizeRecommendation {
	totalSubscribers: number;
	recommendedTestPercentage: number;
	minimumTestPercentage: number;
	currentTestPercentage: number;
	expectedSamplePerVariant: number;
	minimumSamplePerVariant: number;
	statisticalPower: number;
	warnings: string[];
	recommendations: string[];
}

export interface TestValidationResult {
	isValid: boolean;
	warnings: string[];
	errors: string[];
	sampleSizeRecommendation?: SampleSizeRecommendation;
}
