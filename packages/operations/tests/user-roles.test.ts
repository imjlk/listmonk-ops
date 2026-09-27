import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import type { UserRoleDesiredState } from "../src/user-roles";
import { MAX_USER_ROLE_PERMISSION_ENTRIES } from "../src/user-role-permissions";
import { userRoleManifestReconcileInputContract } from "../src/specs/contract-schemas";
import {
	ensureUserRole,
	invokeReconcileUserRoleManifestOperation,
	LISTMONK_LIST_ROLE_PERMISSIONS,
	LISTMONK_USER_PERMISSIONS,
	LISTMONK_USER_ROLE_PERMISSION_PRESETS,
	LISTMONK_USER_ROLE_PERMISSIONS,
	MAX_USER_ROLE_PERMISSIONS,
	OperationInputError,
	reconcileUserRole,
	reconcileUserRoleManifest,
	UserRoleManifestApplyError,
} from "../src";

type UserRoleClient = Pick<ListmonkClient, "userRole">;

function userRoleContext(
	methods: Partial<UserRoleClient["userRole"]>,
): { client: UserRoleClient } {
	return { client: { userRole: methods } as UserRoleClient };
}

function acceptUserRolePermission(
	permission: UserRoleDesiredState["permissions"][number],
): UserRoleDesiredState["permissions"][number] {
	return permission;
}

// @ts-expect-error Per-list permissions are only valid on Listmonk list roles.
acceptUserRolePermission("list:get");

describe("declarative user role reconciliation", () => {
	test("plans and applies an exact-name least-privilege update", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{
						id: 2,
						type: "user",
						name: "Transactional runtime",
						permissions: ["tx:send"],
					},
				],
				total: 1,
				per_page: 1,
				page: 1,
			},
		}));
		const update = mock(
			async ({ path, body }: { path: { id: number }; body: Record<string, unknown> }) => ({
				data: { id: path.id, type: "user", ...body },
			}),
		);
		const context = userRoleContext({
			list: list as UserRoleClient["userRole"]["list"],
			update: update as UserRoleClient["userRole"]["update"],
		});
		const desired = {
			name: "Transactional runtime",
			permissions: ["tx:send", "subscribers:manage", "tx:send"] as const,
		};

		await expect(reconcileUserRole(context, desired)).resolves.toMatchObject({
			name: "Transactional runtime",
			action: "update",
			applied: false,
		});
		expect(update).not.toHaveBeenCalled();

		await expect(ensureUserRole(context, desired)).resolves.toMatchObject({
			action: "update",
			applied: true,
			role: {
				id: 2,
				permissions: ["subscribers:manage", "tx:send"],
			},
		});
		expect(update).toHaveBeenCalledWith({
			path: { id: 2 },
			body: {
				name: "Transactional runtime",
				permissions: ["subscribers:manage", "tx:send"],
			},
		});
	});

	test("deduplicates full permission sets within the accepted input limit", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 0, page: 1 },
		}));
		const context = userRoleContext({
			list: list as UserRoleClient["userRole"]["list"],
		});
		const permissions = [
			...LISTMONK_USER_ROLE_PERMISSIONS,
			LISTMONK_USER_ROLE_PERMISSIONS[0],
			LISTMONK_USER_ROLE_PERMISSIONS[1],
		];

		expect(permissions).toHaveLength(MAX_USER_ROLE_PERMISSION_ENTRIES);
		await expect(
			reconcileUserRoleManifest(context, {
				schema_version: 1,
				roles: [{ name: "Full access", permissions }],
			}),
		).resolves.toMatchObject({
			apply: false,
			results: [{ name: "Full access", action: "create", applied: false }],
		});
	});

	test("plans a complete manifest once and reports partial remote apply", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 0, page: 1 },
		}));
		const create = mock(async ({ body }: { body: { name: string; permissions: string[] } }) => {
			if (body.name === "Template provisioner") {
				throw new Error("remote create failed");
			}
			return { data: { id: 3, type: "user", ...body } };
		});
		const context = userRoleContext({
			list: list as UserRoleClient["userRole"]["list"],
			create: create as UserRoleClient["userRole"]["create"],
		});
		const manifest = {
			schema_version: 1 as const,
			roles: [
				{
					name: "Transactional runtime",
					permissions: LISTMONK_USER_ROLE_PERMISSION_PRESETS.transactionalSubscriberRuntime,
				},
				{
					name: "Template provisioner",
					permissions: LISTMONK_USER_ROLE_PERMISSION_PRESETS.templateProvisioner,
				},
			],
		};

		await expect(reconcileUserRoleManifest(context, manifest)).resolves.toEqual({
			schema_version: 1,
			apply: false,
			results: [
				{ name: "Transactional runtime", action: "create", applied: false },
				{ name: "Template provisioner", action: "create", applied: false },
			],
		});
		expect(list).toHaveBeenCalledTimes(1);

		let failure: unknown;
		try {
			await reconcileUserRoleManifest(context, manifest, { apply: true });
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(UserRoleManifestApplyError);
		const manifestError = failure as UserRoleManifestApplyError;
		expect(manifestError.failedRole).toBe("Template provisioner");
		expect(manifestError.appliedResults).toEqual([
			expect.objectContaining({
				name: "Transactional runtime",
				action: "create",
				applied: true,
			}),
		]);
	});

	test("reconciles an empty permission set for a no-access role", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{
						id: 4,
						type: "user",
						name: "Suspended integration",
						permissions: ["tx:send"],
					},
				],
				total: 1,
				per_page: 1,
				page: 1,
			},
		}));
		const update = mock(
			async ({ path, body }: { path: { id: number }; body: Record<string, unknown> }) => ({
				data: { id: path.id, type: "user", ...body },
			}),
		);
		const context = userRoleContext({
			list: list as UserRoleClient["userRole"]["list"],
			update: update as UserRoleClient["userRole"]["update"],
		});

		await expect(
			ensureUserRole(context, {
				name: "Suspended integration",
				permissions: [],
			}),
		).resolves.toMatchObject({
			action: "update",
			applied: true,
			role: { id: 4, permissions: [] },
		});
		expect(update).toHaveBeenCalledWith({
			path: { id: 4 },
			body: { name: "Suspended integration", permissions: [] },
		});
	});

	test("fails closed for duplicate names and the protected Super Admin role", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{
						id: 1,
						type: "user",
						name: "Super Admin",
						permissions: [],
					},
				],
				total: 1,
				per_page: 1,
				page: 1,
			},
		}));
		const context = userRoleContext({
			list: list as UserRoleClient["userRole"]["list"],
		});

		await expect(
			reconcileUserRole(context, {
				name: "Super Admin",
				permissions: ["roles:manage"],
			}),
		).rejects.toThrow("protected Super Admin");
		await expect(
			reconcileUserRoleManifest(context, {
				schema_version: 1,
				roles: [
					{ name: "Duplicate", permissions: ["tx:send"] },
					{ name: "Duplicate", permissions: ["templates:get"] },
				],
			}),
		).rejects.toThrow("duplicate name");
	});

	test("publishes the complete Listmonk 6.2 permission vocabulary and safe presets", () => {
		expect(LISTMONK_USER_PERMISSIONS).toHaveLength(30);
		expect(LISTMONK_LIST_ROLE_PERMISSIONS).toEqual(["list:get", "list:manage"]);
		expect(LISTMONK_USER_ROLE_PERMISSIONS).toHaveLength(
			MAX_USER_ROLE_PERMISSIONS,
		);
		// Listmonk 6.2 permissions.json: the only names validateUserRole accepts.
		expect(LISTMONK_USER_ROLE_PERMISSIONS).toEqual([
			"lists:get_all",
			"lists:manage_all",
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
		]);
		expect(LISTMONK_USER_ROLE_PERMISSION_PRESETS).toEqual({
			transactionalSubscriberRuntime: ["subscribers:manage", "tx:send"],
			templateProvisioner: ["templates:get", "templates:manage"],
		});
	});

	test("publishes only valid user-role permissions in the input contract", () => {
		const contract = JSON.stringify(userRoleManifestReconcileInputContract);
		expect(contract).not.toContain('"const":"list:get"');
		expect(contract).not.toContain('"const":"list:manage"');
		expect(contract).toContain('"maxItems":30');
	});

	test("rejects list-role permissions before any remote call", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 0, page: 1 },
		}));
		const create = mock(async () => ({ data: { id: 5 } }));
		const update = mock(async () => ({ data: { id: 5 } }));
		const context = userRoleContext({
			list: list as UserRoleClient["userRole"]["list"],
			create: create as unknown as UserRoleClient["userRole"]["create"],
			update: update as unknown as UserRoleClient["userRole"]["update"],
		});

		for (const permission of LISTMONK_LIST_ROLE_PERMISSIONS) {
			const manifest = {
				schema_version: 1 as const,
				roles: [
					{ name: "Template provisioner", permissions: ["templates:get"] as const },
					{
						name: "Newsletter editor",
						permissions: ["campaigns:manage", permission],
					},
				],
			};

			// The runtime contract accepts only user-role permissions; this cast
			// lets the test exercise an input a TypeScript caller cannot express.
			await expect(
				reconcileUserRoleManifest(context, manifest as never),
			).rejects.toThrow();
			await expect(
				reconcileUserRoleManifest(context, manifest as never, { apply: true }),
			).rejects.toThrow();
			await expect(
				ensureUserRole(context, {
					name: "Newsletter editor",
					permissions: [permission] as never,
				}),
			).rejects.toThrow();

			const failure = await invokeReconcileUserRoleManifestOperation(context, {
				...manifest,
				dry_run: false,
			}).catch((error: unknown) => error);
			expect(failure).toBeInstanceOf(OperationInputError);
			expect((failure as Error).message).toContain(
				"Invalid parameter roles.1.permissions.1",
			);
		}
		expect(list).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});
});
