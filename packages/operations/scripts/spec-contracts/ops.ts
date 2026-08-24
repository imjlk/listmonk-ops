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
	/** Pause a running or scheduled campaign when breached. Defaults to false. */
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
	/** Active registry version the caller observed; a retry after any intervening change — including the ABA transition of promoting the original back — conflicts instead of rolling again. */
	from_version_id?: NonEmptyString;
	/** Registry head revision the caller observed; it advances even when a cycle restores the active version and remote hash, so a pinned retry conflicts on A → B → A. */
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
