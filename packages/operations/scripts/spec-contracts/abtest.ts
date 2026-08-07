import type { tags } from "typia";
import type {
	ResourceId,
	NonNegativeInteger,
	NonEmptyString,
	IsoDateTime,
} from "./primitives";

export type AbTestStatus =
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

export type AbTestTestingMode = "holdout" | "full-split";

export type AbTestMetricType =
	| "open_rate"
	| "click_rate"
	| "conversion"
	| "revenue"
	| "custom";

export interface AbTestContentOverrides {
	subject?: string;
	body?: string;
	sendTime?: string;
	senderName?: string;
	senderEmail?: string;
}

export interface AbTestVariant {
	id: string;
	name: string;
	percentage: number;
	contentOverrides: AbTestContentOverrides;
}

export interface AbTestMetric {
	id: string;
	name: string;
	type: AbTestMetricType;
	config?: Record<string, unknown>;
}

export interface AbTestBaseConfig {
	subject: string;
	body: string;
	lists: number[];
	template_id?: number;
}

export interface AbTestCampaignMapping {
	variantId: string;
	campaignId: number;
}

export interface AbTestListMapping {
	variantId: string;
	listId: number;
}

export interface AbTestRecord {
	id: string;
	name: string;
	campaignId: string;
	variants: AbTestVariant[];
	status: AbTestStatus;
	metrics: AbTestMetric[];
	winnerVariantId?: string;
	createdAt: string;
	updatedAt: string;
	baseConfig: AbTestBaseConfig;
	testingMode: AbTestTestingMode;
	testGroupPercentage: number;
	testGroupSize: number;
	holdoutGroupSize: number;
	confidenceThreshold: number;
	autoDeployWinner: boolean;
	campaignMappings: AbTestCampaignMapping[];
	testListMappings: AbTestListMapping[];
	holdoutListId?: number;
	winnerCampaignId?: number;
	assignmentSeed?: string;
	audienceSnapshot?: Record<string, unknown>;
	assignmentManifest?: Record<string, unknown>;
	durationHours?: number;
	launchAt?: string;
	startedAt?: string;
	endsAt?: string;
	minimumTestSampleSize?: number;
	assignmentProvenance?: string;
	hypothesis?: Record<string, unknown>;
	stratification?: Record<string, unknown>;
}

export interface AbTestListInput {
	status?: AbTestStatus;
}

export interface AbTestIdInput {
	test_id: NonEmptyString;
}

export interface AbTestCreateVariantInput {
	name: NonEmptyString;
	percentage: number & tags.Type<"float"> & tags.Minimum<0> & tags.Maximum<100>;
	campaign_config: {
		subject?: string;
		body?: string;
		template_id?: ResourceId;
	};
}

export interface AbTestCreateInput {
	name: NonEmptyString;
	campaign_id?: string;
	description?: string;
	lists: ResourceId[] & tags.MinItems<1>;
	variants: AbTestCreateVariantInput[] & tags.MinItems<2> & tags.MaxItems<3>;
	testing_mode?: AbTestTestingMode;
	test_group_percentage: number;
	confidence_threshold: number;
	minimum_sample_size: number;
	duration_hours: number;
	launch_at?: IsoDateTime;
	auto_launch: boolean;
	auto_deploy_winner: boolean;
	ignore_sample_size_warnings: boolean;
	hypothesis?: {
		objective: NonEmptyString;
		hypothesis: NonEmptyString;
		primary_metric: {
			type: "click_rate" | "conversion_rate" | "revenue_per_recipient";
			direction: "maximize" | "minimize";
		};
		expected_lift:
			| { kind: "relative"; value: number & tags.Type<"float"> & tags.Minimum<0> }
			| {
					kind: "absolute";
					value: number & tags.Type<"float"> & tags.Minimum<0>;
					unit: "percentage_point" | "currency_per_recipient";
				};
		owner: {
			id: NonEmptyString;
			display_name?: string;
		};
		experiment_scope: {
			channel: "email";
			experiment_family_key: NonEmptyString & tags.Pattern<"^[a-z0-9]+(?:[._-][a-z0-9]+)*$">;
			attribution_window_hours: number & tags.Minimum<0>;
			exclusion_window_hours: number & tags.Minimum<0>;
		};
	};
	enable_stratification: boolean;
}

export interface AbTestAnalyzeInput extends AbTestIdInput {
	include_recommendations?: boolean;
}

export interface AbTestRunInput {
	test_id: NonEmptyString;
	expected_status?: AbTestStatus;
	expected_updated_at?: IsoDateTime;
	confirm: boolean;
}

export interface AbTestTickInput {
	confirm: boolean;
	dry_run: boolean;
}

export interface AbTestReconcileInput {
	test_id?: NonEmptyString;
	all: boolean;
	repair: boolean;
	confirm: boolean;
}

export interface AbTestRecommendSampleSizeInput {
	lists: ResourceId[] & tags.MinItems<1>;
	test_group_percentage: number & tags.Type<"float"> & tags.Minimum<0> & tags.Maximum<100>;
	variant_count?: number & tags.Type<"int64"> & tags.Minimum<2> & tags.Maximum<3>;
}

export interface AbTestExportAssignmentInput {
	test_id: NonEmptyString;
	confirm: boolean;
}

export interface AbTestListOutput {
	tests: AbTestRecord[];
}

export interface AbTestGetOutput {
	test: AbTestRecord;
}

export interface AbTestDeleteOutput {
	deleted: boolean;
}

export interface AbTestDeployWinnerOutput {
	deployed: boolean;
}

export interface AbTestTestResults {
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

export interface AbTestStatisticalAnalysis {
	zScore: number;
	pValue: number;
	isSignificant: boolean;
	confidenceLevel: number;
	sampleSize: number;
	correctedPValue?: number;
	holmCorrected?: boolean;
	srmPassed?: boolean;
	srmPValue?: number;
	fixedHorizonReasonCodes?: string[];
}

export interface AbTestAnalysis {
	testId: string;
	results: AbTestTestResults[];
	analysis: AbTestStatisticalAnalysis;
	winner: AbTestVariant | null;
	recommendations: string[];
}

export interface AbTestAnalysisOutput {
	analysis: AbTestAnalysis;
}

export interface AbTestSampleSizeRecommendation {
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

export interface AbTestValidation {
	isValid: boolean;
	warnings: string[];
	errors: string[];
	sampleSizeRecommendation?: AbTestSampleSizeRecommendation;
}

export interface AbTestRecommendOutput {
	recommendation: AbTestValidation;
}

export interface AbTestTickResult {
	test_id: string;
	status: AbTestStatus;
	action: string;
}

export interface AbTestTickOutput {
	processed: NonNegativeInteger;
	results: AbTestTickResult[];
}

export interface AbTestReconcileResult {
	test_id: string;
	status: AbTestStatus;
	drift: string;
}

export interface AbTestReconcileOutput {
	reconciled: NonNegativeInteger;
	results: AbTestReconcileResult[];
}

export interface AbTestExportOutput {
	manifest: unknown;
}
