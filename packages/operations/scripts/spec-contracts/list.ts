import type { tags } from "typia";
import type { ResourceId, NonEmptyString, ResourceIdInput } from "./primitives";

export type ListmonkUserPermission =
	| "lists:get_all"
	| "lists:manage_all"
	| "list:manage"
	| "list:get"
	| "subscribers:get"
	| "subscribers:get_all"
	| "subscribers:manage"
	| "subscribers:import"
	| "subscribers:sql_query"
	| "tx:send"
	| "campaigns:get"
	| "campaigns:get_all"
	| "campaigns:get_analytics"
	| "campaigns:manage"
	| "campaigns:manage_all"
	| "campaigns:send"
	| "bounces:get"
	| "bounces:manage"
	| "webhooks:post_bounce"
	| "media:get"
	| "media:manage"
	| "templates:get"
	| "templates:manage"
	| "users:get"
	| "users:manage"
	| "roles:get"
	| "roles:manage"
	| "settings:get"
	| "settings:manage"
	| "settings:maintain";

export type ListVisibility = "public" | "private";

export type ListOptin = "single" | "double";

export type ListName = NonEmptyString &
	tags.MaxLength<120> &
	tags.Pattern<"^\\s*\\S[\\s\\S]*$">;

export interface ListCreateInput {
	name: ListName;
	/** Caller-scoped create key; an identical retry with the same key replays the originally created list. */
	idempotency_key?: NonEmptyString & tags.MaxLength<200>;
	/**
	 * List visibility. Optional on input and defaults to `"private"`, matching
	 * the runtime Zod schema's `.default("private")`.
	 */
	type?: ListVisibility;
	/**
	 * Opt-in type. Optional on input and defaults to `"single"`, matching
	 * the runtime Zod schema's `.default("single")`.
	 */
	optin?: ListOptin;
	/** Optional description, defaults to `""`. */
	description?: string;
	tags?: string[];
}

export interface ListCreateOutput {
	list: import("./subscriber").SubscriberListRecord;
	created: boolean;
}

export interface ListUpdateFields {
	name?: ListName;
	type?: ListVisibility;
	optin?: ListOptin;
	description?: string;
	tags?: string[];
}

export type ListUpdateInput = ResourceIdInput &
	(
		| (ListUpdateFields & { name: ListName })
		| (ListUpdateFields & { type: ListVisibility })
		| (ListUpdateFields & { optin: ListOptin })
		| (ListUpdateFields & { description: string })
		| (ListUpdateFields & { tags: string[] })
	);

export interface ListDeleteInput {
	id: ResourceId;
}

export interface ListDeleteOutput {
	id: ResourceId;
	deleted: boolean;
}
