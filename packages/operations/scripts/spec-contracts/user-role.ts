import type { tags } from "typia";
import type { NonEmptyString } from "./primitives";
import type { ListmonkUserPermission } from "./list";

export type UserRoleName = NonEmptyString & tags.MaxLength<120>;

export interface UserRoleDesiredState {
	name: UserRoleName;
	permissions: ListmonkUserPermission[] & tags.MaxItems<30>;
}

export interface UserRoleManifestReconcileInput {
	schema_version: 1;
	roles: UserRoleDesiredState[] &
		tags.MinItems<1> &
		tags.MaxItems<500>;
	/**
	 * Plan only when true; apply when false. Optional on input and defaults to
	 * a safe dry run (true), matching the runtime Zod schema's `.default(true)`.
	 */
	dry_run?: boolean;
}

export type UserRoleReconcileAction = "create" | "update" | "unchanged";

export interface UserRoleReconcileSummary {
	name: UserRoleName;
	action: UserRoleReconcileAction;
	applied: boolean;
}

export interface UserRoleManifestReconcileOutput {
	schema_version: 1;
	dry_run: boolean;
	results: UserRoleReconcileSummary[];
}
