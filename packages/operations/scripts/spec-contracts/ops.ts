import type { tags } from "typia";
import type {
	ResourceId,
	NonNegativeInteger,
	NonEmptyString,
	TrimmedNonEmptyString,
	PositiveInteger,
} from "./primitives";

export type SegmentDriftBaselineMode =
	| "previous"
	| "lookback-mean"
	| "lookback-median";

export interface SegmentDriftInput {
	list_ids?: ResourceId[];
	/** Relative drift threshold. Defaults to 0.2. */
	threshold?: number & tags.Type<"float"> & tags.Minimum<0>;
	/** Minimum absolute subscriber delta for an alert. Defaults to 50. */
	min_absolute_change?: NonNegativeInteger;
	/** Baseline lookback window in days. Defaults to 14. */
	lookback_days?: PositiveInteger;
	/** How to compute the alert baseline. Defaults to "previous". */
	baseline_mode?: SegmentDriftBaselineMode;
	/** Sampling period key; same-key snapshots replace their predecessor so retries never double-weight the period. */
	sample_key?: TrimmedNonEmptyString & tags.MaxLength<200>;
}

export interface SegmentDriftComparison {
	listId: ResourceId;
	listName: string;
	previousCount?: number | undefined;
	currentCount: number & tags.Type<"float"> & tags.Minimum<0>;
	baselineCount?: number | undefined;
	delta?: number | undefined;
	deltaRate?: number | undefined;
	alert: boolean;
}

export interface SegmentDriftOutput {
	capturedAt: string;
	threshold: number & tags.Type<"float"> & tags.Minimum<0>;
	minAbsoluteChange: number & tags.Type<"float"> & tags.Minimum<0>;
	/** Snapshots replaced by this run because they shared its sample key. */
	replaced: NonNegativeInteger;
	comparisons: SegmentDriftComparison[];
	alerts: SegmentDriftComparison[];
}

export interface DailyDigestInput {
	/** Digest window in hours. Defaults to 24. */
	hours?: PositiveInteger;
	/** Maximum allowed bounce rate. Defaults to 0.05. */
	bounce_threshold?: number & tags.Type<"float"> & tags.Minimum<0>;
	/** Minimum required open rate. Defaults to 0.08. */
	open_threshold?: number & tags.Type<"float"> & tags.Minimum<0>;
	/** Minimum required click rate. Defaults to 0.01. */
	click_threshold?: number & tags.Type<"float"> & tags.Minimum<0>;
}

export interface DailyDigestWindow {
	hours: number & tags.Type<"float"> & tags.Minimum<0>;
	from: string;
	to: string;
}

export interface DailyDigestMetrics {
	lists: NonNegativeInteger;
	subscribers: NonNegativeInteger;
	subscriberStatus: Record<string, NonNegativeInteger>;
	campaigns: NonNegativeInteger;
	runningCampaigns: NonNegativeInteger;
	campaignsCreatedInWindow: NonNegativeInteger;
	sent: number & tags.Type<"float"> & tags.Minimum<0>;
	views: number & tags.Type<"float"> & tags.Minimum<0>;
	clicks: number & tags.Type<"float"> & tags.Minimum<0>;
	bouncesInWindow: NonNegativeInteger;
}

export interface DailyDigestCampaignBreach {
	campaignId: ResourceId;
	campaignName: string;
	breaches: string[];
}

export interface DailyDigestRisk {
	campaignBreaches: DailyDigestCampaignBreach[];
	campaignsEligible: NonNegativeInteger;
	campaignsEvaluated: NonNegativeInteger;
	truncated: boolean;
}

export interface DailyDigestOutput {
	generatedAt: string;
	window: DailyDigestWindow;
	metrics: DailyDigestMetrics;
	risk: DailyDigestRisk;
	markdown: string;
}

export interface DeliverabilityGuardInput {
	campaign_id: ResourceId;
	/** Maximum allowed bounce rate. Defaults to 0.05. */
	bounce_threshold?: number &
		tags.Type<"float"> &
		tags.Minimum<0> &
		tags.Maximum<1>;
	/** Minimum required open rate. Defaults to 0.08. */
	open_threshold?: number &
		tags.Type<"float"> &
		tags.Minimum<0> &
		tags.Maximum<1>;
	/** Minimum required click rate. Defaults to 0.01. */
	click_threshold?: number &
		tags.Type<"float"> &
		tags.Minimum<0> &
		tags.Maximum<1>;
	/** Minimum sent count before engagement breaches are evaluated. Defaults to 100. */
	minimum_sent?: PositiveInteger;
	/** Minimum campaign age before engagement evaluation. Defaults to 3600 seconds. */
	minimum_observation_seconds?: number & tags.Type<"int32"> & tags.Minimum<1> & tags.Maximum<31536000>;
	/** Also pause on engagement breaches when pause_on_breach is true. Defaults to false. */
	pause_on_engagement_breach?: boolean;
	/** Pause a running campaign for bounce breaches. Defaults to false. */
	pause_on_breach?: boolean;
}

export interface DeliverabilityGuardMetrics {
	sent: number & tags.Type<"float"> & tags.Minimum<0>;
	toSend: number & tags.Type<"float"> & tags.Minimum<0>;
	views: number & tags.Type<"float"> & tags.Minimum<0>;
	clicks: number & tags.Type<"float"> & tags.Minimum<0>;
	bounces: number & tags.Type<"float"> & tags.Minimum<0>;
	bounceRate: number & tags.Type<"float"> & tags.Minimum<0>;
	openRate: number & tags.Type<"float"> & tags.Minimum<0>;
	clickRate: number & tags.Type<"float"> & tags.Minimum<0>;
}

export interface DeliverabilityGuardOutput {
	campaignId: ResourceId;
	campaignName: string;
	status: string;
	checkedAt: string;
	metrics: DeliverabilityGuardMetrics;
	thresholds: {
		bounceRate: number & tags.Type<"float"> & tags.Minimum<0>;
		openRate: number & tags.Type<"float"> & tags.Minimum<0>;
		clickRate: number & tags.Type<"float"> & tags.Minimum<0>;
	};
	breaches: string[];
	paused: boolean;
}

export interface TemplateRollbackInput {
	template_id: ResourceId;
	/** Explicit rollback target from registry-history; pins the rollback so a retry after an intervening change fails instead of rolling to a different version. */
	to_version_id?: NonEmptyString;
	/** Active registry version the caller observed; a retry conflicts whenever the active version moved elsewhere. A cycle promoting the original back restores this pin's match — pair it with expected_head_revision to catch that transition. */
	from_version_id?: NonEmptyString;
	/** Registry head revision the caller observed; every registry-managed write — a same-version re-promotion included — advances it, so a pinned retry conflicts on A → X → A. */
	expected_head_revision?: NonNegativeInteger;
	/** Remote template hash the caller observed; a template mutated outside the registry conflicts instead of being rolled back over. */
	expected_remote_hash?: NonEmptyString;
}

export interface TemplateRollbackOutput {
	templateId: ResourceId;
	templateName: string;
	versionId: string;
	activeVersionId: string;
	/** Registry head revision after the rollback; echo it to pin a retry. */
	headRevision: NonNegativeInteger;
	promotedAt: string;
	/** False when the requested rollback was already applied. */
	rolledBack: boolean;
}

export interface CampaignReviewFields {
	name: ReviewText;
	subject: ReviewText;
	from_email: ReviewText;
	status: ReviewText;
	send_at: ReviewText;
	updated_at: ReviewText;
	content_type: ReviewText;
	messenger: ReviewText;
	template_id: ResourceId | null;
	template_updated_at: ReviewText;
	template_body_sha256: ReviewDigest;
	body_sha256: ReviewDigest;
	altbody_sha256: ReviewDigest;
	preview_sha256: ReviewDigest;
}
type ReviewText = (string & tags.MaxLength<512>) | null;
type ReviewDigest = (string & tags.Pattern<"^[a-f0-9]{64}$">) | null;
export interface CampaignReviewSnapshot {
	version: 1;
	campaign_id: ResourceId;
	campaign_uuid: ReviewText;
	fields: CampaignReviewFields;
	lists: { id: ResourceId; name: ReviewText; subscriber_count: NonNegativeInteger | null }[] & tags.MaxItems<100>;
}
export interface CampaignReviewInput {
	campaign_id: ResourceId;
	max_audience?: PositiveInteger;
	previous_snapshot?: CampaignReviewSnapshot;
}
export interface CampaignReviewOutput {
	snapshot: CampaignReviewSnapshot;
	preview: { html: (string & tags.MaxLength<2000000>) | null; trusted: false };
	preflight: {
		checks: { id: string; level: "pass" | "warn" | "fail"; message: string }[];
		summary: { pass: number; warn: number; fail: number }; audienceEstimate: number;
	};
	comparison: { compared: boolean; changed_fields: string[]; messages: string[] };
	limitations: string[];
}

export interface OpsHealthInput {
	scope?: "all" | "sequences" | "webhooks";
	at?: string & tags.Format<"date-time">;
	worker_stale_ms?: number & tags.Type<"int64"> & tags.Minimum<1000> & tags.Maximum<86400000>;
	scan_limit?: number & tags.Type<"int64"> & tags.Minimum<1> & tags.Maximum<10000>;
}
export type OpsHealthSeverity = "healthy" | "warning" | "unknown" | "critical";
export interface OpsHealthFinding {
	code: string;
	severity: OpsHealthSeverity;
	count: NonNegativeInteger;
	reason: string;
	next_actions: { operation_id?: string; command: string; mode: "read" }[] & tags.MaxItems<2>;
}
export interface OpsHealthComponent {
	component: "sequences" | "webhooks";
	backend: "file" | "postgres" | "unknown";
	availability: "available" | "unavailable" | "unsupported";
	severity: OpsHealthSeverity;
	complete: boolean;
	truncated: boolean;
	coverage: { collection: string; scanned: NonNegativeInteger; total: NonNegativeInteger; truncated: boolean }[] & tags.MaxItems<4>;
	metrics: Record<string, NonNegativeInteger>;
	findings: OpsHealthFinding[] & tags.MaxItems<32>;
}
export interface OpsHealthOutput {
	checked_at: string;
	scope: "all" | "sequences" | "webhooks";
	severity: OpsHealthSeverity;
	check_passed: boolean;
	complete: boolean;
	truncated: boolean;
	components: OpsHealthComponent[] & tags.MinItems<1> & tags.MaxItems<2>;
	limitations: string[];
}
