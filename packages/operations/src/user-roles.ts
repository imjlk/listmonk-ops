import type { ListmonkClient, UserRole } from "@listmonk-ops/openapi";
import { bindUserRoleReconcileOperationSpec } from "./specs";
import { z } from "zod";
import { jsonResourceValue, unwrapResourceResponse } from "./resource-helpers";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	OperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

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
		.transform((permissions) => [...new Set(permissions)].sort()),
});

export const MAX_USER_ROLE_MANIFEST_BYTES = 1024 * 1024;
export const MAX_USER_ROLE_MANIFEST_ROLES = 500;

function userRoleManifestByteLength(manifest: {
	schema_version: 1;
	roles: readonly z.output<typeof userRoleDesiredStateSchema>[];
}): number {
	return new TextEncoder().encode(
		JSON.stringify({
			schema_version: manifest.schema_version,
			roles: manifest.roles,
		}),
	).byteLength;
}

const userRoleManifestSchema = z
	.object({
		schema_version: z.literal(1),
		roles: z.array(userRoleDesiredStateSchema).min(1),
	})
	.superRefine((manifest, context) => {
		if (userRoleManifestByteLength(manifest) > MAX_USER_ROLE_MANIFEST_BYTES) {
			context.addIssue({
				code: "custom",
				message: `User role manifest exceeds the ${MAX_USER_ROLE_MANIFEST_BYTES}-byte limit`,
			});
		}
		if (manifest.roles.length > MAX_USER_ROLE_MANIFEST_ROLES) {
			context.addIssue({
				code: "custom",
				message: `User role manifest exceeds the ${MAX_USER_ROLE_MANIFEST_ROLES}-role limit`,
			});
		}
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

const userRoleManifestOperationInputSchema = userRoleManifestSchema.safeExtend({
	roles: z.array(userRoleDesiredStateSchema).min(1).max(500),
	dry_run: z.boolean().default(true),
});

const userRoleReconcileSummarySchema = z.object({
	name: z.string().min(1).max(120),
	action: z.enum(["create", "update", "unchanged"]),
	applied: z.boolean(),
});

const userRoleManifestOperationOutputSchema = z.object({
	schema_version: z.literal(1),
	dry_run: z.boolean(),
	results: z.array(userRoleReconcileSummarySchema),
});

export type UserRoleManifestOperationInput = z.input<
	typeof userRoleManifestOperationInputSchema
>;

export type UserRoleManifestOperationResult = z.output<
	typeof userRoleManifestOperationOutputSchema
>;

type NormalizedUserRoleDesiredState = z.output<
	typeof userRoleDesiredStateSchema
>;

export interface UserRoleDesiredState {
	name: string;
	/** Empty creates or reconciles a valid no-access role. */
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

/**
 * Project a reconcile result into the body-free summary shape exposed through
 * the shared surface. Role IDs, permission values, and any remote error body
 * are intentionally dropped so a manifest apply cannot leak credential-adjacent
 * metadata through either success or partial-failure paths.
 */
function toUserRoleReconcileSummary(result: {
	name: string;
	action: "create" | "update" | "unchanged";
	applied: boolean;
}): z.output<typeof userRoleReconcileSummarySchema> {
	const { name, action, applied } = result;
	return { name, action, applied };
}

/**
 * Body-free partial apply details projected through the shared surface. The
 * remote error body, role IDs, and permission values are intentionally dropped
 * so a manifest apply failure cannot leak credential-adjacent metadata.
 */
export class UserRoleManifestOperationApplyError extends OperationExecutionError {
	public readonly failedRole: string;
	public readonly appliedResults: readonly z.output<
		typeof userRoleReconcileSummarySchema
	>[];

	public constructor(error: UserRoleManifestApplyError) {
		const appliedResults = error.appliedResults.map(toUserRoleReconcileSummary);
		super(
			"user-roles.reconcile",
			new Error(
				`${error.message}; completed entries: ${JSON.stringify(appliedResults)}`,
				{ cause: error.cause },
			),
		);
		this.name = "UserRoleManifestOperationApplyError";
		this.failedRole = error.failedRole;
		this.appliedResults = appliedResults;
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

/**
 * Reconcile a versioned role manifest. The complete manifest is planned before
 * the first remote mutation. Remote writes are not transactional; an apply
 * failure exposes completed entries through UserRoleManifestApplyError so
 * callers can reconcile the partial remote state.
 */
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

/** Execute manifest reconciliation through the normalized operation boundary. */
export async function executeUserRoleManifestReconcile(
	context: UserRoleOperationContext,
	input: z.output<typeof userRoleManifestOperationInputSchema>,
): Promise<UserRoleManifestOperationResult> {
	const result = await reconcileUserRoleManifest(
		context,
		{
			schema_version: input.schema_version,
			roles: input.roles,
		},
		{ apply: !input.dry_run },
	);
	return {
		schema_version: result.schema_version,
		dry_run: input.dry_run,
		results: result.results.map(toUserRoleReconcileSummary),
	};
}

export const reconcileUserRoleManifestOperation = defineOperation({
	id: "user-roles.reconcile",
	title: "Reconcile user-role manifest",
	description:
		"Plan or apply a versioned least-privilege user-role manifest against exact-name Listmonk user roles",
	inputSchema: userRoleManifestOperationInputSchema,
	outputSchema: userRoleManifestOperationOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_reconcile_user_role_manifest",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindUserRoleReconcileOperationSpec(),
	execute: executeUserRoleManifestReconcile,
});

export async function invokeReconcileUserRoleManifestOperation(
	context: UserRoleOperationContext,
	input: unknown,
): Promise<UserRoleManifestOperationResult> {
	const parsedInput = parseOperationInput(
		reconcileUserRoleManifestOperation.inputSchema,
		input,
	);
	let output: UserRoleManifestOperationResult;
	try {
		output = await executeUserRoleManifestReconcile(context, parsedInput);
	} catch (error) {
		if (error instanceof UserRoleManifestApplyError) {
			throw new UserRoleManifestOperationApplyError(error);
		}
		throw normalizeOperationExecutionError(
			reconcileUserRoleManifestOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		reconcileUserRoleManifestOperation.id,
		reconcileUserRoleManifestOperation.outputSchema,
		output,
	);
}

export const userRoleOperations = [reconcileUserRoleManifestOperation] as const;

export const userRoleOperationCatalog = defineOperationCatalog({
	id: "user-roles",
	title: "User roles",
	operations: userRoleOperations,
	specMigrationExemptions: [],
});

export type UserRoleOperation = (typeof userRoleOperations)[number];

export interface UserRoleOperationInvocation {
	operation: UserRoleOperation;
	output: Record<string, unknown>;
}

export async function invokeUserRoleOperationByMcpName(
	context: UserRoleOperationContext,
	name: string,
	input: unknown,
): Promise<UserRoleOperationInvocation | undefined> {
	switch (name) {
		case reconcileUserRoleManifestOperation.mcp.name:
			return {
				operation: reconcileUserRoleManifestOperation,
				output: await invokeReconcileUserRoleManifestOperation(context, input),
			};
		default:
			return undefined;
	}
}
