import type {
	PaginationInput,
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
