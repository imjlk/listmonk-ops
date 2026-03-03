// A/B Testing domain models
export interface AbTest {
	id: string;
	name: string;
	campaignId: string;
	variants: Variant[];
	status:
		| "draft"
		| "testing"
		| "running"
		| "analyzing"
		| "deploying"
		| "completed"
		| "cancelled";
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
		| "running"
		| "analyzing"
		| "deploying"
		| "completed"
		| "cancelled";
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
