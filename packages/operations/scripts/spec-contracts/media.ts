import type { tags } from "typia";
import type {
	ResourceId,
	NonEmptyString,
	TrimmedNonEmptyString,
} from "./primitives";

export interface MediaRecord {
	id?: ResourceId | undefined;
	uuid?: string | undefined;
	filename?: string | undefined;
	content_type?: string | undefined;
	created_at?: string | undefined;
	thumb_url?: string | undefined;
	thumb_uri?: string | undefined;
	provider?: string | undefined;
	meta?: Record<string, unknown> | undefined;
	url?: string | undefined;
	uri?: string | undefined;
	/** Preserve fields added by newer Listmonk releases. */
	[key: string]: unknown;
}

export interface MediaCollectionOutput {
	results: MediaRecord[];
	total: number;
	per_page: number;
	page: number;
}

export interface MediaUploadInput {
	/** Base64-encoded file contents. Max length matches the runtime 10 MiB decoded cap plus padding/slack. */
	base64: NonEmptyString & tags.MaxLength<14981014>;
	filename: TrimmedNonEmptyString & tags.MaxLength<255>;
	/** Optional MIME content type. When omitted, the operation infers it from the filename. */
	content_type?: TrimmedNonEmptyString & tags.MaxLength<127>;
}

export interface MediaDeleteInput {
	id: ResourceId;
}

export interface MediaDeleteOutput {
	id: ResourceId;
	deleted: boolean;
}
