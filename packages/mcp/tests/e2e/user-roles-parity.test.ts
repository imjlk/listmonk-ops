import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestName, TEST_CONFIG } from "../setup.js";

const TESTS_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(TESTS_DIRECTORY, "../../../..");
const CLI_DIRECTORY = resolve(PROJECT_ROOT, "apps/cli");
const CLI_ENTRY = resolve(CLI_DIRECTORY, "src/index.ts");

type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type UserRoleManifestResult = {
	schema_version: 1;
	dry_run: boolean;
	results: Array<{
		name: string;
		action: "create" | "update" | "unchanged";
		applied: boolean;
	}>;
};

type UserRoleRecord = {
	id: number;
	name: string;
	permissions: string[];
};

function resolveCliE2eCredential(
	config: Pick<typeof TEST_CONFIG, "apiToken" | "password">,
): string {
	return config.apiToken || config.password;
}

function runCliReconcileUserRoleManifest(
	manifestPath: string,
	options: { confirm: boolean; dryRun: boolean },
): CliResult {
	const args = ["bun", CLI_ENTRY];
	if (options.confirm) args.push("--confirm");
	args.push(
		"user-roles",
		"reconcile",
		"--manifest-file",
		manifestPath,
		options.dryRun ? "--dry-run" : "--no-dry-run",
		"--format=json",
	);
	const result = Bun.spawnSync(args, {
		cwd: CLI_DIRECTORY,
		env: {
			...process.env,
			BUN_FORCE_COLOR: "0",
			LISTMONK_API_URL: TEST_CONFIG.baseUrl,
			LISTMONK_USERNAME: TEST_CONFIG.username,
			LISTMONK_API_TOKEN: resolveCliE2eCredential(TEST_CONFIG),
		},
		stdout: "pipe",
		stderr: "pipe",
	});

	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
}

function parseCliManifestOutput(result: CliResult): UserRoleManifestResult {
	const diagnosticOutput = [result.stdout, result.stderr]
		.filter(Boolean)
		.join("\n");
	if (result.exitCode !== 0) {
		throw new Error(
			`CLI user-role manifest reconciliation failed with exit ${result.exitCode}: ${diagnosticOutput}`,
		);
	}
	const jsonStart = result.stdout.indexOf("{");
	if (jsonStart < 0) {
		throw new Error(
			`CLI user-role manifest reconciliation did not return JSON: ${diagnosticOutput}`,
		);
	}
	return JSON.parse(result.stdout.slice(jsonStart)) as UserRoleManifestResult;
}

function roleApiUrl(path: string): string {
	// TEST_CONFIG.baseUrl already ends with the Listmonk `/api` segment, so the
	// role endpoints live directly under it (e.g. `${baseUrl}/roles/users`).
	const base = TEST_CONFIG.baseUrl.replace(/\/+$/, "");
	return `${base}${path}`;
}

// Mirror the test client's auth scheme: a token authorization header when an
// API token is configured, falling back to basic auth with the password.
function roleAuthHeader(): string {
	const credential = resolveCliE2eCredential(TEST_CONFIG);
	return `token ${TEST_CONFIG.username}:${credential}`;
}

async function listLocalUserRoles(): Promise<UserRoleRecord[]> {
	const response = await fetch(roleApiUrl("/roles/users"), {
		headers: { Authorization: roleAuthHeader() },
	});
	if (!response.ok) {
		throw new Error(
			`Failed to list user roles: ${response.status} ${await response.text()}`,
		);
	}
	const payload = (await response.json()) as {
		data?: UserRoleRecord[] | { results?: UserRoleRecord[] };
	};
	const data = payload.data;
	if (Array.isArray(data)) return data;
	return data?.results ?? [];
}

/**
 * Listmonk 6.2 does not expose a DELETE for user roles, so the e2e cleanup
 * neutralizes the role by dropping it to a no-access role. Test isolation is
 * additionally guaranteed by the unique `buildTestName` prefix.
 */
async function neutralizeLocalUserRole(id: number): Promise<void> {
	const response = await fetch(roleApiUrl(`/roles/users/${id}`), {
		method: "PUT",
		headers: {
			Authorization: roleAuthHeader(),
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ name: `cleaned-up-${id}`, permissions: [] }),
	});
	if (!response.ok) {
		throw new Error(
			`Failed to neutralize user role ${id}: ${response.status} ${await response.text()}`,
		);
	}
}

describe("User-role manifest CLI and MCP parity", () => {
	const { client, utils } = createMCPTestSuite();

	test("shares dry-run output, confirmation, and apply semantics", async () => {
		const stateDirectory = await mkdtemp(
			join(tmpdir(), "listmonk-ops-user-role-manifest-e2e-"),
		);
		const manifestPath = join(stateDirectory, "roles.json");
		const roleName = buildTestName("user-role-manifest-parity");
		const manifest = {
			schema_version: 1 as const,
			roles: [
				{
					name: roleName,
					permissions: ["templates:get", "templates:manage"] as const,
				},
			],
		};
		await writeFile(manifestPath, JSON.stringify(manifest), "utf8");
		let createdRoleId: number | undefined;

		try {
			const blocked = runCliReconcileUserRoleManifest(manifestPath, {
				confirm: false,
				dryRun: true,
			});
			expect(blocked.exitCode).not.toBe(0);
			expect(`${blocked.stdout}\n${blocked.stderr}`).toContain(
				"requires explicit confirmation",
			);

			const cliPlan = parseCliManifestOutput(
				runCliReconcileUserRoleManifest(manifestPath, {
					confirm: true,
					dryRun: true,
				}),
			);
			const mcpPlanResult = await client.callTool(
				"listmonk_reconcile_user_role_manifest",
				{ ...manifest, dry_run: true, confirm: true },
			);
			const mcpPlan = utils.assertSuccess<UserRoleManifestResult>(
				mcpPlanResult,
				"Failed to plan the user-role manifest through MCP",
			);
			expect(cliPlan).toEqual(mcpPlan);
			expect(cliPlan).toEqual({
				schema_version: 1,
				dry_run: true,
				results: [
					{ name: roleName, action: "create", applied: false },
				],
			});

			const applyResult = await client.callTool(
				"listmonk_reconcile_user_role_manifest",
				{ ...manifest, dry_run: false, confirm: true },
			);
			const applied = utils.assertSuccess<UserRoleManifestResult>(
				applyResult,
				"Failed to apply the user-role manifest through MCP",
			);
			expect(applied).toEqual({
				schema_version: 1,
				dry_run: false,
				results: [
					{ name: roleName, action: "create", applied: true },
				],
			});

			const roles = await listLocalUserRoles();
			const created = roles.find((role) => role.name === roleName);
			expect(created).toBeDefined();
			expect([...(created?.permissions ?? [])].sort()).toEqual([
				"templates:get",
				"templates:manage",
			]);
			createdRoleId = created?.id;

			// Re-applying the same manifest reports an unchanged role, proving
			// idempotency across both adapters.
			const reappliedResult = await client.callTool(
				"listmonk_reconcile_user_role_manifest",
				{ ...manifest, dry_run: false, confirm: true },
			);
			const reapplied = utils.assertSuccess<UserRoleManifestResult>(
				reappliedResult,
				"Failed to re-apply the idempotent user-role manifest",
			);
			expect(reapplied).toEqual({
				schema_version: 1,
				dry_run: false,
				results: [
					{ name: roleName, action: "unchanged", applied: false },
				],
			});
		} finally {
			try {
				// Re-resolve the role by name during cleanup so a failed
				// assertion between apply and cleanup cannot leak a role into
				// the shared stack when createdRoleId was never assigned.
				const roles = await listLocalUserRoles();
				const stale =
					createdRoleId ??
					roles.find((role) => role.name === roleName)?.id;
				if (stale !== undefined) {
					await neutralizeLocalUserRole(stale);
				}
			} finally {
				await rm(stateDirectory, { recursive: true, force: true });
			}
		}
	});
});
