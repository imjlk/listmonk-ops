import type { tags } from "typia";
import type {
	ResourceId,
	NonNegativeInteger,
	PositiveInteger,
	NonEmptyString,
	EmailAddress,
	ResourceIdInput,
	Uuid,
} from "./primitives";

export interface SubscriberListRecord {
	id?: ResourceId | undefined;
	created_at?: string | undefined;
	updated_at?: string | undefined;
	uuid?: string | undefined;
	name?: string | undefined;
	type?: string | undefined;
	optin?: string | undefined;
	tags?: string[] | undefined;
	subscriber_count?: number | undefined;
	description?: string | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export interface SubscriberListCollectionOutput {
	results: SubscriberListRecord[];
	total: number;
	per_page: number;
	page: number;
}

export interface SubscriberCreateOutput {
	subscriber: SubscriberRecord;
	created: boolean;
}

export interface SubscriberRecord {
	id?: ResourceId | undefined;
	created_at?: string | undefined;
	updated_at?: string | undefined;
	uuid?: string | undefined;
	email?: string | undefined;
	name?: string | undefined;
	status?: string | undefined;
	attribs?: Record<string, unknown> | undefined;
	lists?: Record<string, unknown>[] | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export interface SubscriberListInput {
	/** One-based result page. Omitted values use the shared operation default. */
	page?: PositiveInteger | undefined;
	/** Number of records per page, or all records. */
	per_page?: PositiveInteger | "all" | undefined;
	/**
	 * List filter normalized by the shared operation boundary. An empty array
	 * selects subscribers without restricting the source list.
	 */
	list_id?: ResourceId[] | undefined;
	query?: string | undefined;
	order_by?: "name" | "status" | "created_at" | "updated_at" | undefined;
	order?: "ASC" | "DESC" | undefined;
	subscription_status?: NonEmptyString | undefined;
}

export interface SubscriberCollectionOutput {
	results: SubscriberRecord[];
	total: number;
	per_page: number;
	page: number;
}

export interface SubscriberBlocklistInput {
	/** One or more Listmonk subscriber IDs. */
	subscriber_ids: ResourceId[] & tags.MinItems<1>;
	/** Resolve the audience and report work without mutating Listmonk. */
	dry_run: boolean;
	/** Maximum number of subscribers accepted by this invocation. */
	max_items: PositiveInteger;
	/** Continue processing later chunks when an earlier chunk fails. */
	continue_on_error: boolean;
}

export interface SubscriberBulkOutput {
	processed: NonNegativeInteger;
	succeeded: NonNegativeInteger;
	failed: NonNegativeInteger;
	errors: string[];
}

export type SubscriberUuid = Uuid;

export type SubscriberStatus = "enabled" | "disabled" | "blocklisted";

export interface SubscriberCreateInput {
	email: EmailAddress;
	/** Optional, defaults to `""`. */
	name?: string;
	/** Optional, defaults to `"enabled"`. */
	status?: SubscriberStatus;
	/** Optional, defaults to `[]`. */
	lists?: ResourceId[];
	list_uuids?: string[];
	preconfirm_subscriptions?: boolean;
	/** Optional, defaults to `{}`. */
	attribs?: Record<string, unknown>;
}

export interface SubscriberUpdateFields {
	email?: EmailAddress;
	name?: string;
	status?: SubscriberStatus;
	lists?: ResourceId[];
	list_uuids?: string[];
	preconfirm_subscriptions?: boolean;
	attribs?: Record<string, unknown>;
}

export type SubscriberUpdateInput = ResourceIdInput &
	(
		| (SubscriberUpdateFields & { email: EmailAddress })
		| (SubscriberUpdateFields & { name: string })
		| (SubscriberUpdateFields & { status: SubscriberStatus })
		| (SubscriberUpdateFields & { lists: ResourceId[] })
		| (SubscriberUpdateFields & { list_uuids: string[] })
		| (SubscriberUpdateFields & { preconfirm_subscriptions: boolean })
		| (SubscriberUpdateFields & { attribs: Record<string, unknown> })
	);

export interface SubscriberDeleteInput {
	id: ResourceId;
}

export interface SubscriberDeleteOutput {
	id: ResourceId;
	deleted: boolean;
}

export interface SubscriberBulkListsInput {
	subscriber_ids: ResourceId[] & tags.MinItems<1>;
	list_ids: ResourceId[] & tags.MinItems<1>;
	/** Plan only when true. Defaults to false. */
	dry_run?: boolean;
	/** Maximum total subscriber IDs processed. Defaults to 10000. */
	max_items?: PositiveInteger;
	/** Continue processing after a chunk failure. Defaults to false. */
	continue_on_error?: boolean;
}

export interface SubscriberBulkBlocklistInput {
	subscriber_ids: ResourceId[] & tags.MinItems<1>;
	/** Plan only when true. Defaults to false. */
	dry_run?: boolean;
	/** Maximum total subscriber IDs processed. Defaults to 10000. */
	max_items?: PositiveInteger;
	/** Continue processing after a chunk failure. Defaults to false. */
	continue_on_error?: boolean;
}

export type SubscriberHygieneMode = "winback" | "sunset";

export type SubscriberHygieneInput =
	| {
			/** Hygiene mode. Defaults to "winback". */
			mode?: SubscriberHygieneMode;
			/** Inactive threshold in days. Defaults to 90. */
			inactivity_days?: PositiveInteger;
			source_list_ids?: ResourceId[];
			target_list_id?: ResourceId;
			/** Blocklist sunset candidates. Defaults to false. */
			blocklist?: boolean;
			/** Restricts a preview to this candidate subset without mutating anyone. */
			subscriber_ids?:
				| (ResourceId[] & tags.MinItems<1> & tags.MaxItems<10_000>)
				| undefined;
			/** Preview candidates without mutating subscribers. Defaults to true. */
			dry_run?: true | undefined;
			/** Maximum candidates to process. Defaults to 500. */
			max_subscribers?: PositiveInteger;
	  }
	| {
			/** Hygiene mode. Defaults to "winback". */
			mode?: SubscriberHygieneMode;
			/** Inactive threshold in days. Defaults to 90. */
			inactivity_days?: PositiveInteger;
			source_list_ids?: ResourceId[];
			target_list_id?: ResourceId;
			/** Blocklist sunset candidates. Defaults to false. */
			blocklist?: boolean;
			/** Exact candidate set reported by a dry run; the run processes exactly this set. */
			subscriber_ids: ResourceId[] & tags.MinItems<1> & tags.MaxItems<10_000>;
			dry_run: false;
			/** Maximum candidates to process. Defaults to 500. */
			max_subscribers?: PositiveInteger;
	  };

export interface SubscriberHygieneOutput {
	mode: SubscriberHygieneMode;
	cutoffAt: string;
	dryRun: boolean;
	totalSubscribersScanned: NonNegativeInteger;
	candidateSubscribers: NonNegativeInteger;
	processedSubscribers: NonNegativeInteger;
	skippedDueToLimit: NonNegativeInteger;
	/** The selected subscriber ids — echo them for the destructive run. */
	subscriberIds: ResourceId[];
	targetListId?: ResourceId;
	blocklist: boolean;
	sample: Array<{
		emailMasked: string;
		updated_at?: string;
	}>;
	errors: string[];
}
