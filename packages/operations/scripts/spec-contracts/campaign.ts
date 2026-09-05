import type { tags } from "typia";
import type {
	CAMPAIGN_ANALYTICS_DATE_PATTERN_SOURCE,
	MAX_CAMPAIGN_ANALYTICS_IDS,
} from "../../src/campaign-analytics-date";
import type {
	MAX_CAMPAIGN_TEST_RECIPIENTS,
	MAX_CAMPAIGN_TEST_RECIPIENT_EMAIL_LENGTH,
} from "../../src/campaign-test-bound";
import type {
	ResourceId,
	NonNegativeInteger,
	PositiveInteger,
	NonEmptyString,
	TrimmedNonEmptyString,
	IsoDateTime,
	ResourceIdInput,
} from "./primitives";
import type { CAMPAIGN_SEND_AT_PATTERN_SOURCE } from "../../src/campaign-send-at";

export type CampaignSendAt = string &
	tags.Pattern<typeof CAMPAIGN_SEND_AT_PATTERN_SOURCE>;

export interface CampaignGetInput {
	/** Listmonk campaign ID. */
	id: ResourceId;
	/** Omit the potentially large message body when the server supports it. */
	no_body?: boolean | undefined;
}

export interface CampaignGetOutput {
	id?: ResourceId | undefined;
	created_at?: string | undefined;
	updated_at?: string | undefined;
	uuid?: string | undefined;
	name?: string | undefined;
	subject?: string | undefined;
	from_email?: string | undefined;
	body?: string | undefined;
	body_source?: string | null | undefined;
	altbody?: string | null | undefined;
	send_at?: string | null | undefined;
	status?: string | undefined;
	type?: "regular" | "optin" | undefined;
	content_type?:
		| "richtext"
		| "html"
		| "markdown"
		| "plain"
		| "visual"
		| undefined;
	tags?: string[] | undefined;
	template_id?: ResourceId | null | undefined;
	messenger?: string | undefined;
	lists?: Record<string, unknown>[] | undefined;
	archive?: boolean | undefined;
	media?: Record<string, unknown>[] | undefined;
	views?: number | null | undefined;
	clicks?: number | null | undefined;
	bounces?: number | null | undefined;
	to_send?: number | null | undefined;
	sent?: number | null | undefined;
	started_at?: string | null | undefined;
	/**
	 * Preserve additional fields returned by newer Listmonk releases so this
	 * read contract remains forward-compatible at the handwritten API boundary.
	 */
	[key: string]: unknown;
}

export interface CampaignListInput {
	/** One-based result page. Omitted values use the shared operation default. */
	page?: PositiveInteger | undefined;
	/** Number of records per page, or all records. */
	per_page?: PositiveInteger | "all" | undefined;
	status?:
		| (
				| "draft"
				| "scheduled"
				| "running"
				| "paused"
				| "finished"
				| "cancelled"
		  )[]
		| undefined;
	no_body?: boolean | undefined;
	query?: string | undefined;
	tags?: string[] | undefined;
	order?: "ASC" | "DESC" | undefined;
	order_by?: "name" | "status" | "created_at" | "updated_at" | undefined;
}

export interface CampaignCollectionOutput {
	results: CampaignGetOutput[];
	total: number;
	per_page: number;
	page: number;
}

export interface CampaignStatsOutput {
	id: ResourceId;
	status?: string | undefined;
	views?: number | null | undefined;
	clicks?: number | null | undefined;
	bounces?: number | null | undefined;
	to_send?: number | null | undefined;
	sent?: number | null | undefined;
	started_at?: string | null | undefined;
}

export interface CampaignScheduleInput {
	/** Listmonk campaign ID. */
	id: ResourceId;
	/**
	 * ISO 8601 or Listmonk-compatible `YYYY-MM-DD HH:MM:SS` send timestamp.
	 * The exact accepted forms are shared with the campaign domain validator.
	 */
	send_at: CampaignSendAt;
	/** Campaign updated_at observed by the preflight that approved this send. */
	expected_updated_at?: NonEmptyString | undefined;
}

export interface CampaignScheduleOutput {
	id: ResourceId;
	status: string;
}

export interface CampaignLifecycleInput {
	/** Listmonk campaign ID. */
	id: ResourceId;
	/** Campaign updated_at observed by the preflight that approved this transition. */
	expected_updated_at?: NonEmptyString | undefined;
}

export interface CampaignLifecycleOutput {
	id: ResourceId;
	status: string;
}

export interface CampaignPreflightInput {
	/** Listmonk campaign ID. */
	campaign_id: ResourceId;
	/** Warning threshold for the resolved audience size. */
	max_audience: PositiveInteger;
	/** Whether to validate outbound links after SSRF policy checks. */
	check_links: boolean;
	/** Per-link timeout in milliseconds. */
	link_check_timeout_ms: PositiveInteger;
}

export interface CampaignPreflightCheck {
	id: string;
	level: "pass" | "warn" | "fail";
	message: string;
	details?: Record<string, unknown> | undefined;
}

export interface CampaignPreflightOutput {
	campaignId: ResourceId;
	campaignName: string;
	campaignUpdatedAt: NonEmptyString;
	status: string;
	audienceEstimate: NonNegativeInteger;
	checkedAt: IsoDateTime;
	checks: CampaignPreflightCheck[];
	summary: {
		pass: NonNegativeInteger;
		warn: NonNegativeInteger;
		fail: NonNegativeInteger;
	};
}

export type CampaignType = "regular" | "optin";

export type CampaignContentType = "richtext" | "html" | "markdown" | "plain" | "visual";

export interface CampaignBodyFields {
	name: TrimmedNonEmptyString;
	subject: TrimmedNonEmptyString;
	from_email: TrimmedNonEmptyString;
	body: TrimmedNonEmptyString;
	body_source?: string | null;
	altbody?: string;
	/**
	 * Campaign type. Optional on input and defaults to `"regular"`, matching
	 * the runtime Zod schema's `.default("regular")`.
	 */
	type?: CampaignType;
	template_id: ResourceId | null;
	lists: ResourceId[] & tags.MinItems<1>;
	tags?: string[];
	/**
	 * Messenger. Optional on input and defaults to `"email"`, matching the
	 * runtime Zod schema's `.default("email")`.
	 */
	messenger?: TrimmedNonEmptyString;
	/**
	 * Content type. Optional on input and defaults to `"html"`, matching the
	 * runtime Zod schema's `.default("html")`.
	 */
	content_type?: CampaignContentType;
	send_at?: string | null;
	headers?: Record<string, string>[];
	attribs?: Record<string, unknown>;
	archive?: boolean;
	archive_slug?: string | null;
	archive_template_id?: ResourceId | null;
	archive_meta?: Record<string, unknown>;
	media?: ResourceId[];
	subscribers?: string[];
}

export interface CampaignCreateInput extends CampaignBodyFields {
	/** Caller-scoped create key; an identical retry with the same key replays the originally created campaign. */
	idempotency_key?: NonEmptyString & tags.MaxLength<200>;
}

export interface CampaignCreateOutput {
	campaign: CampaignGetOutput;
	created: boolean;
}

export interface CampaignUpdateFields {
	name?: TrimmedNonEmptyString;
	subject?: TrimmedNonEmptyString;
	from_email?: TrimmedNonEmptyString;
	body?: TrimmedNonEmptyString;
	body_source?: string | null;
	altbody?: string;
	type?: CampaignType;
	template_id?: ResourceId | null;
	lists?: ResourceId[] & tags.MinItems<1>;
	tags?: string[];
	messenger?: TrimmedNonEmptyString;
	content_type?: CampaignContentType;
	send_at?: string | null;
	headers?: Record<string, string>[];
	attribs?: Record<string, unknown>;
	archive?: boolean;
	archive_slug?: string | null;
	archive_template_id?: ResourceId | null;
	archive_meta?: Record<string, unknown>;
	media?: ResourceId[];
	subscribers?: string[];
}

export type CampaignUpdateInput = ResourceIdInput &
	(
		| (CampaignUpdateFields & { name: TrimmedNonEmptyString })
		| (CampaignUpdateFields & { subject: TrimmedNonEmptyString })
		| (CampaignUpdateFields & { from_email: TrimmedNonEmptyString })
		| (CampaignUpdateFields & { body: TrimmedNonEmptyString })
		| (CampaignUpdateFields & { body_source: string | null })
		| (CampaignUpdateFields & { altbody: string })
		| (CampaignUpdateFields & { type: CampaignType })
		| (CampaignUpdateFields & { template_id: ResourceId | null })
		| (CampaignUpdateFields & { lists: ResourceId[] & tags.MinItems<1> })
		| (CampaignUpdateFields & { tags: string[] })
		| (CampaignUpdateFields & { messenger: TrimmedNonEmptyString })
		| (CampaignUpdateFields & { content_type: CampaignContentType })
		| (CampaignUpdateFields & { send_at: string | null })
		| (CampaignUpdateFields & { headers: Record<string, string>[] })
		| (CampaignUpdateFields & { attribs: Record<string, unknown> })
		| (CampaignUpdateFields & { archive: boolean })
		| (CampaignUpdateFields & { archive_slug: string | null })
		| (CampaignUpdateFields & { archive_template_id: ResourceId | null })
		| (CampaignUpdateFields & { archive_meta: Record<string, unknown> })
		| (CampaignUpdateFields & { media: ResourceId[] })
		| (CampaignUpdateFields & { subscribers: string[] })
	);

export interface CampaignDeleteInput {
	id: ResourceId;
}

export interface CampaignDeleteOutput {
	id: ResourceId;
	deleted: boolean;
}

export interface CampaignCloneInput {
	id: ResourceId;
	name: TrimmedNonEmptyString;
	/** Caller-scoped clone key; an identical retry with the same key replays the originally cloned campaign. */
	idempotency_key?: NonEmptyString & tags.MaxLength<200>;
}

export interface CampaignCloneOutput {
	campaign: CampaignGetOutput;
	created: boolean;
}

export type CampaignAnalyticsDate = NonEmptyString &
	tags.Pattern<typeof CAMPAIGN_ANALYTICS_DATE_PATTERN_SOURCE>;

export type CampaignArchiveInput = ResourceIdInput & {
	/** Whether the campaign's public archive page is enabled. */
	archive: boolean;
};

export interface CampaignArchiveOutput {
	id: ResourceId;
	/** Echoed archive-enabled state. */
	archive: boolean;
	/** Archive template id as reported by Listmonk (0 when unset). */
	archive_template_id?: number | undefined;
	/** Archive slug as reported by Listmonk (empty when unset). */
	archive_slug?: string | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export type CampaignAnalyticsType =
	| "views"
	| "clicks"
	| "links"
	| "bounces";

export type CampaignAnalyticsInput = {
	/** Analytics facet to read. */
	type: CampaignAnalyticsType;
	/** Inclusive range start as an ISO calendar date (YYYY-MM-DD). */
	from: CampaignAnalyticsDate;
	/** Inclusive range end as an ISO calendar date (YYYY-MM-DD). */
	to: CampaignAnalyticsDate;
	/** Campaign ids to aggregate, repeated as id query parameters. */
	campaign_ids: readonly ResourceId[] &
		tags.MinItems<1> &
		tags.MaxItems<typeof MAX_CAMPAIGN_ANALYTICS_IDS>;
};

export interface CampaignAnalyticsOutput {
	type: CampaignAnalyticsType;
	/** Echoed range start. */
	from: string;
	/** Echoed range end. */
	to: string;
	campaign_ids: ResourceId[];
	/**
	 * Observed rows: `{campaign_id, count, timestamp}` daily buckets for
	 * views/clicks/bounces, `{url, count}` aggregates for links.
	 */
	results: Record<string, unknown>[];
}

export type CampaignPreviewInput = ResourceIdInput;

export interface CampaignPreviewOutput {
	/** Fully rendered HTML preview of the campaign body. */
	html: NonEmptyString;
}

/**
 * Bounded email of one existing subscriber who receives a campaign test
 * message, shared by the published contract and future variants.
 */
export type CampaignTestRecipientEmail = NonEmptyString &
	tags.MaxLength<typeof MAX_CAMPAIGN_TEST_RECIPIENT_EMAIL_LENGTH> &
	tags.Format<"email">;

export type CampaignTestInput = ResourceIdInput & {
	/**
	 * Emails of existing subscribers who receive the test message. The
	 * observed Listmonk 6.2 endpoint rejects unknown emails.
	 */
	subscribers: (readonly CampaignTestRecipientEmail[] &
		tags.MinItems<1> &
		tags.MaxItems<typeof MAX_CAMPAIGN_TEST_RECIPIENTS>);
	/** Optional subject override for the rendered test message. */
	subject?: TrimmedNonEmptyString | undefined;
	/** Optional template override for the rendered test message. */
	template_id?: ResourceId | undefined;
	/** Optional body override for the rendered test message. */
	body?: NonEmptyString | undefined;
	/** Optional messenger override; defaults to the campaign's messenger. */
	messenger?: TrimmedNonEmptyString | undefined;
	/** Optional From address override for the rendered test message. */
	from_email?: TrimmedNonEmptyString | undefined;
};

export interface CampaignTestOutput {
	id: ResourceId;
	subscribers: string[];
	sent: boolean;
}
