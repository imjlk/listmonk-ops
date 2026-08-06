import type { OutputUtils } from "@listmonk-ops/common";
import { getOutput } from "../lib/output";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeReconcileUserRoleManifestOperation,
	MAX_USER_ROLE_MANIFEST_BYTES,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { parseJson, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type UserRolesOutput = Pick<
	typeof OutputUtils,
	"info" | "json" | "success" | "table"
>;

export interface UserRolesCliContext {
	client: Pick<ListmonkClient, "userRole">;
	output: UserRolesOutput;
}

export function createUserRoleCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderReconcileUserRoleManifest(
	context: UserRolesCliContext,
	input: unknown,
): Promise<void> {
	const result = await invokeReconcileUserRoleManifestOperation(context, input);
	const appliedCount = result.results.filter(({ applied }) => applied).length;
	const summary = result.dry_run
		? `${result.results.length} entries`
		: `${appliedCount} changed, ${result.results.length - appliedCount} unchanged`;
	context.output.success(
		`User role manifest ${result.dry_run ? "planned" : "applied"}: ${summary}`,
	);
	context.output.json(result);
}

type ReconcileCommandFlags = {
	"manifest-file": string;
	"dry-run": boolean;
};

export async function handleReconcileUserRoleManifestCommand({
	flags,
	...args
}: HandlerArgs<ReconcileCommandFlags>): Promise<void> {
	try {
		// defineCommand enforces the operation's destructive safety metadata and
		// global --confirm flag before this handler can read or apply a manifest.
		const file = Bun.file(flags["manifest-file"]);
		if (!(await file.exists())) {
			throw new Error(`File not found: ${flags["manifest-file"]}`);
		}
		if (file.size > MAX_USER_ROLE_MANIFEST_BYTES) {
			throw new Error(
				`User role manifest exceeds the ${MAX_USER_ROLE_MANIFEST_BYTES}-byte limit`,
			);
		}
		const parsed = parseJson<unknown>(await file.text(), "user role manifest");
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new Error("User role manifest must contain a JSON object");
		}
		const client = await getListmonkClient(args);
		await renderReconcileUserRoleManifest(
			{ client, output: getOutput() },
			{
				...parsed,
				dry_run: flags["dry-run"],
			},
		);
	} catch (error) {
		throw createUserRoleCommandError(
			"Failed to reconcile user role manifest",
			error,
		);
	}
}

export default defineGroup({
	name: "user-roles",
	description: "Manage least-privilege Listmonk user roles",
	commands: [
		defineCommand({
			name: "reconcile",
			operationId: "user-roles.reconcile",
			description: "Plan or apply a versioned user-role manifest",
			options: {
				"manifest-file": option(z.string().trim().min(1), {
					description: "Path to a versioned user-role manifest JSON file",
					fileType: "path",
				}),
				"dry-run": option(z.boolean().default(true), {
					description: "Plan without changing Listmonk user roles",
				}),
			},
			handler: handleReconcileUserRoleManifestCommand,
		}),
	],
});
