import type { tags } from "typia";
import type { ResourceId, NonEmptyString, ResourceIdInput } from "./primitives";

export type {
	ListmonkUserPermission,
	ListmonkUserRolePermission,
} from "../../src/user-role-permissions";

export type ListmonkUserRolePermission = Exclude<
	ListmonkUserPermission,
	"list:get" | "list:manage"
>;

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
