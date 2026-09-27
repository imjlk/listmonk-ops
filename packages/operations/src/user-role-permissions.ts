/**
 * Exact granular permission names exposed by Listmonk 6.2, including the
 * per-list `list:get` and `list:manage` permissions that only list roles
 * accept. User roles take {@link LISTMONK_USER_ROLE_PERMISSIONS}.
 */
export const LISTMONK_USER_PERMISSIONS = [
	"lists:get_all",
	"lists:manage_all",
	"list:manage",
	"list:get",
	"subscribers:get",
	"subscribers:get_all",
	"subscribers:manage",
	"subscribers:import",
	"subscribers:sql_query",
	"tx:send",
	"campaigns:get",
	"campaigns:get_all",
	"campaigns:get_analytics",
	"campaigns:manage",
	"campaigns:manage_all",
	"campaigns:send",
	"bounces:get",
	"bounces:manage",
	"webhooks:post_bounce",
	"media:get",
	"media:manage",
	"templates:get",
	"templates:manage",
	"users:get",
	"users:manage",
	"roles:get",
	"roles:manage",
	"settings:get",
	"settings:manage",
	"settings:maintain",
] as const;

export type ListmonkUserPermission =
	(typeof LISTMONK_USER_PERMISSIONS)[number];

/**
 * Per-list permissions. Listmonk 6.2 grants them only through list roles
 * (cmd/roles.go validateListRole) and rejects them on user roles.
 */
export const LISTMONK_LIST_ROLE_PERMISSIONS = [
	"list:get",
	"list:manage",
] as const satisfies readonly ListmonkUserPermission[];

export type ListmonkListRolePermission =
	(typeof LISTMONK_LIST_ROLE_PERMISSIONS)[number];

const LISTMONK_LIST_ROLE_PERMISSION_SET = new Set<string>(
	LISTMONK_LIST_ROLE_PERMISSIONS,
);

export type ListmonkUserRolePermission = Exclude<
	ListmonkUserPermission,
	ListmonkListRolePermission
>;

export function isListRolePermission(
	permission: unknown,
): permission is ListmonkListRolePermission {
	return (
		typeof permission === "string" &&
		LISTMONK_LIST_ROLE_PERMISSION_SET.has(permission)
	);
}

/**
 * The permissions a Listmonk 6.2 user role accepts: the permissions.json
 * vocabulary that cmd/roles.go validateUserRole checks every entry against.
 */
export const LISTMONK_USER_ROLE_PERMISSIONS: readonly ListmonkUserRolePermission[] =
	LISTMONK_USER_PERMISSIONS.filter(
		(permission): permission is ListmonkUserRolePermission =>
			!isListRolePermission(permission),
	);

export const MAX_USER_ROLE_PERMISSIONS = 28 as const;

// Preserve the accepted raw input size for duplicate permissions; runtime
// normalization reduces those entries to at most the 28 unique permissions.
export const MAX_USER_ROLE_PERMISSION_ENTRIES =
	LISTMONK_USER_PERMISSIONS.length;

export const LISTMONK_USER_ROLE_PERMISSION_PRESETS = {
	transactionalSubscriberRuntime: ["subscribers:manage", "tx:send"],
	templateProvisioner: ["templates:get", "templates:manage"],
} as const satisfies Record<string, readonly ListmonkUserRolePermission[]>;
