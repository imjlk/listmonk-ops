// A/B Testing domain models

/**
 * Safety lead time (seconds) added to "now" when computing a default
 * send_at for shared variant campaign scheduling. Ensures all variant
 * campaigns receive the same future timestamp even when launched
 * immediately. Shared between createTest auto-launch and launchAbTest.
 */
export const ABTEST_SAFETY_LEAD_SECONDS = 60;

export interface AbTest {
	id: string;
	name: string;
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
	/**
	 * Deterministic assignment manifest produced from the seed + audience.
	 * Once stored, retries and reconciliation reuse it rather than
	 * re-splitting the audience.
	 */
	assignmentManifest?: {
		algorithm: "sha256-order-largest-remainder-v1";
		seed: string;
		audienceChecksum: string;
		groups: {
			kind: "variant" | "holdout";
			variantId?: string;
			expectedCount: number;
			subscriberChecksum: string;
		}[];
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
}

export interface AbTestConfig {
	name: string;
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
