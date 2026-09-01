import type { tags } from "typia";
import type {
	NonNegativeInteger,
	PaginationInput,
	PositiveInteger,
	ResourceId,
	TrimmedNonEmptyString,
} from "./primitives";

export interface BounceCampaignSummary {
	id?: ResourceId | undefined;
	name?: string | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

/**
 * A Listmonk bounce record as observed from the 6.2 API. The upstream
 * OpenAPI document misses `subscriber_status` and models a stray `total`
 * inside the item, so this contract follows observed responses and keeps
 * an index signature for forward compatibility.
 */
export interface BounceRecord {
	id?: ResourceId | undefined;
	type?: string | undefined;
	source?: string | undefined;
	meta?: Record<string, unknown> | undefined;
	created_at?: string | undefined;
	email?: string | undefined;
	subscriber_uuid?: string | undefined;
	subscriber_id?: ResourceId | undefined;
	subscriber_status?: string | undefined;
	campaign?: BounceCampaignSummary | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export interface BounceListInput extends PaginationInput {
	/** Filter bounce records by the campaign they belong to. */
	campaign_id?: ResourceId | undefined;
	/** Filter bounce records by their source of origin. */
	source?: TrimmedNonEmptyString | undefined;
	/** Sort field applied by Listmonk. */
	order_by?:
		| ("email" | "campaign_name" | "source" | "created_at")
		| undefined;
	/** Sort direction applied by Listmonk. */
	order?: ("asc" | "desc") | undefined;
}

export interface BounceCollectionOutput {
	results: BounceRecord[];
	total: number;
	per_page: number;
	page: number;
}

export type BounceIdInput = {
	/** Positive Listmonk bounce ID. */
	id: ResourceId;
};

export interface BounceDeleteOutput {
	id: ResourceId;
	deleted: boolean;
}

/** Selection window size bound for one previewed prune batch. */
export type BouncePruneWindowLimit = number &
	tags.Type<"int64"> &
	tags.Minimum<1> &
	tags.Maximum<100>;

export interface BouncePruneSelection {
	/** One-based page of the selection window a dry run previews. */
	page?: PositiveInteger | undefined;
	/** Selection window size, at most 100. Omitted values use the shared operation default. */
	per_page?: BouncePruneWindowLimit | undefined;
	/** Filter bounce records by the campaign they belong to. */
	campaign_id?: ResourceId | undefined;
	/** Filter bounce records by their source of origin. */
	source?: TrimmedNonEmptyString | undefined;
	/** Sort field applied by Listmonk. */
	order_by?:
		| ("email" | "campaign_name" | "source" | "created_at")
		| undefined;
	/** Sort direction applied by Listmonk. */
	order?: ("asc" | "desc") | undefined;
}

export type BouncePruneInput = BouncePruneSelection & {
	/** Whether to only preview the deletion. Defaults to true. */
	dry_run?: boolean | undefined;
	/**
	 * The exact bounce ids a dry run reported (1 to 100). Required for a
	 * destructive run so a confirmed deletion never drifts from the
	 * previewed set.
	 */
	bounce_ids?: (readonly ResourceId[] & tags.MinItems<1> & tags.MaxItems<100>) | undefined;
};

export interface BouncePruneOutput {
	dry_run: boolean;
	bounce_ids: ResourceId[];
	/** Selection-window metadata; present on dry-run previews. */
	total?: number | undefined;
	page?: number | undefined;
	per_page?: number | undefined;
	/** Per-id acknowledgement count; present on destructive runs. */
	acknowledged?: number | undefined;
}
