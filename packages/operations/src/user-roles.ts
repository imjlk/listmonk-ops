import type { ListmonkClient, UserRole } from "@listmonk-ops/openapi";
import { z } from "zod";
import { unwrapResourceResponse } from "./resource-helpers";

/** Exact granular permission names exposed by Listmonk 6.2. */
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

export const LISTMONK_USER_ROLE_PERMISSION_PRESETS = {
	transactionalSubscriberRuntime: ["subscribers:manage", "tx:send"],
	templateProvisioner: ["templates:get", "templates:manage"],
} as const satisfies Record<string, readonly ListmonkUserPermission[]>;

const PROTECTED_SUPER_ADMIN_ROLE_ID = 1;

function isProtectedUserRoleId(id: number): boolean {
	return id === PROTECTED_SUPER_ADMIN_ROLE_ID;
}

const userPermissionSchema = z.enum(LISTMONK_USER_PERMISSIONS);
const userRoleDesiredStateSchema = z.object({
	name: z.string().trim().min(1),
	permissions: z
		.array(userPermissionSchema)
		.min(1)
		.transform((permissions) => [...new Set(permissions)].sort()),
});
const userRoleManifestSchema = z
	.object({
		schema_version: z.literal(1),
		roles: z.array(userRoleDesiredStateSchema).min(1),
	})
	.superRefine((manifest, context) => {
		const names = new Set<string>();
		for (const [index, role] of manifest.roles.entries()) {
			if (names.has(role.name)) {
				context.addIssue({
					code: "custom",
					message: `User role manifest contains duplicate name ${JSON.stringify(role.name)}`,
					path: ["roles", index, "name"],
				});
			}
			names.add(role.name);
		}
	});
const userRoleSchema = z.looseObject({
	id: z.number().int().positive().refine(Number.isSafeInteger),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	type: z.string().optional(),
	name: z.string().min(1),
	permissions: z.array(z.string()),
});

type NormalizedUserRoleDesiredState = z.output<
	typeof userRoleDesiredStateSchema
>;

export interface UserRoleDesiredState {
	name: string;
	permissions: readonly ListmonkUserPermission[];
}

export interface UserRoleManifest {
	schema_version: 1;
	roles: readonly UserRoleDesiredState[];
}

export interface UserRoleOperationContext {
	client: Pick<ListmonkClient, "userRole">;
}

export interface UserRoleReconcileOptions {
	/** Apply the planned mutation. Omit or set false for a read-only plan. */
	apply?: boolean;
}

export interface UserRoleReconcileResult {
	name: string;
	action: "create" | "update" | "unchanged";
	applied: boolean;
	role?: UserRole;
}

export interface UserRoleManifestReconcileResult {
	schema_version: 1;
	apply: boolean;
	results: UserRoleReconcileResult[];
}

export class UserRoleManifestApplyError extends Error {
	public readonly failedRole: string;
	public readonly appliedResults: readonly UserRoleReconcileResult[];

	public constructor(
		failedRole: string,
		appliedResults: readonly UserRoleReconcileResult[],
		cause: unknown,
	) {
		super(
			`User role manifest apply failed at ${JSON.stringify(failedRole)} after ${appliedResults.length} completed entries`,
			{ cause },
		);
		this.name = "UserRoleManifestApplyError";
		this.failedRole = failedRole;
		this.appliedResults = [...appliedResults];
	}
}

function permissionsMatch(
	current: readonly string[],
	desired: readonly ListmonkUserPermission[],
): boolean {
	const canonicalCurrent = [...new Set(current)].sort();
	return (
		canonicalCurrent.length === desired.length &&
		canonicalCurrent.every((permission, index) => permission === desired[index])
	);
}

async function listUserRoles(
	client: Pick<ListmonkClient, "userRole">,
): Promise<UserRole[]> {
	const response = await client.userRole.list();
	const data = unwrapResourceResponse(response, "Failed to list user roles");
	return z.array(userRoleSchema).parse(data.results) as UserRole[];
}

function planUserRoleFromCandidates(
	desired: NormalizedUserRoleDesiredState,
	candidates: readonly UserRole[],
): UserRoleReconcileResult {
	const matches = candidates.filter((role) => role.name === desired.name);
	if (matches.length > 1) {
		throw new Error(
			`User role reconcile is ambiguous: ${matches.length} roles are named ${JSON.stringify(desired.name)}`,
		);
	}
	const existing = matches[0];
	if (existing === undefined) {
		return { name: desired.name, action: "create", applied: false };
	}
	if (isProtectedUserRoleId(existing.id)) {
		throw new Error(
			`User role reconcile refuses to manage protected Super Admin role ${JSON.stringify(desired.name)}`,
		);
	}
	return {
		name: desired.name,
		action: permissionsMatch(existing.permissions, desired.permissions)
			? "unchanged"
			: "update",
		applied: false,
		role: existing,
	};
}

/** Plan one exact-name role reconciliation without mutating Listmonk. */
export async function planUserRoleReconcile(
	context: UserRoleOperationContext,
	input: UserRoleDesiredState,
): Promise<UserRoleReconcileResult> {
	const desired = userRoleDesiredStateSchema.parse(input);
	return planUserRoleFromCandidates(
		desired,
		await listUserRoles(context.client),
	);
}

async function applyUserRoleReconcilePlan(
	context: UserRoleOperationContext,
	desired: NormalizedUserRoleDesiredState,
	plan: UserRoleReconcileResult,
): Promise<UserRoleReconcileResult> {
	if (plan.action === "unchanged") return plan;
	if (plan.action === "create") {
		const role = userRoleSchema.parse(
			unwrapResourceResponse(
				await context.client.userRole.create({ body: desired }),
				`Failed to create user role ${JSON.stringify(desired.name)}`,
			),
		) as UserRole;
		return { ...plan, applied: true, role };
	}

	const existingId = plan.role?.id;
	if (
		typeof existingId !== "number" ||
		!Number.isSafeInteger(existingId) ||
		existingId <= 0 ||
		isProtectedUserRoleId(existingId)
	) {
		throw new Error(
			`User role update plan for ${JSON.stringify(desired.name)} has a protected or invalid ID`,
		);
	}
	const role = userRoleSchema.parse(
		unwrapResourceResponse(
			await context.client.userRole.update({
				path: { id: existingId },
				body: desired,
			}),
			`Failed to update user role ${JSON.stringify(desired.name)}`,
		),
	) as UserRole;
	return { ...plan, applied: true, role };
}

/** Reconcile one exact-name role, read-only unless `apply` is true. */
export async function reconcileUserRole(
	context: UserRoleOperationContext,
	input: UserRoleDesiredState,
	options: UserRoleReconcileOptions = {},
): Promise<UserRoleReconcileResult> {
	const desired = userRoleDesiredStateSchema.parse(input);
	const plan = planUserRoleFromCandidates(
		desired,
		await listUserRoles(context.client),
	);
	if (options.apply !== true || plan.action === "unchanged") return plan;
	return applyUserRoleReconcilePlan(context, desired, plan);
}

/** Ensure one exact-name role exists with the declared permission set. */
export async function ensureUserRole(
	context: UserRoleOperationContext,
	input: UserRoleDesiredState,
): Promise<UserRoleReconcileResult> {
	return reconcileUserRole(context, input, { apply: true });
}

/** Plan a complete versioned role manifest before its first remote mutation. */
export async function reconcileUserRoleManifest(
	context: UserRoleOperationContext,
	input: UserRoleManifest,
	options: UserRoleReconcileOptions = {},
): Promise<UserRoleManifestReconcileResult> {
	const manifest = userRoleManifestSchema.parse(input);
	const candidates = await listUserRoles(context.client);
	const plannedRoles = manifest.roles.map((desired) => ({
		desired,
		plan: planUserRoleFromCandidates(desired, candidates),
	}));
	if (options.apply !== true) {
		return {
			schema_version: 1,
			apply: false,
			results: plannedRoles.map(({ plan }) => plan),
		};
	}

	const results: UserRoleReconcileResult[] = [];
	for (const { desired, plan } of plannedRoles) {
		try {
			results.push(await applyUserRoleReconcilePlan(context, desired, plan));
		} catch (cause) {
			throw new UserRoleManifestApplyError(desired.name, results, cause);
		}
	}
	return { schema_version: 1, apply: true, results };
}
