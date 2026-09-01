import type { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeDeleteBounceOperation,
	invokeGetBounceOperation,
	invokeListBouncesOperation,
	invokePruneBouncesOperation,
	MAX_BOUNCE_PRUNE_IDS,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import { getOutput } from "../lib/output";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type BouncesOutput = Pick<typeof OutputUtils, "info" | "json" | "success" | "table">;

export interface BouncesCliContext {
	client: Pick<ListmonkClient, "bounce">;
	output: BouncesOutput;
}

export interface ListBouncesInput {
	page?: number;
	per_page?: number;
	campaign_id?: number;
	source?: string;
	order_by?: "email" | "campaign_name" | "source" | "created_at";
	order?: "asc" | "desc";
}

export function createBouncesCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderBounces(
	context: BouncesCliContext,
	input: ListBouncesInput,
): Promise<void> {
	const page = await invokeListBouncesOperation(context, input);
	if (page.results.length === 0) {
		context.output.info("No bounces found");
		return;
	}
	context.output.table(page.results as Record<string, unknown>[]);
}

export async function renderBounce(
	context: BouncesCliContext,
	input: { id: number },
): Promise<void> {
	context.output.json(await invokeGetBounceOperation(context, input));
}

export async function renderDeleteBounce(
	context: BouncesCliContext,
	input: { id: number },
): Promise<void> {
	const result = await invokeDeleteBounceOperation(context, input);
	context.output.success(`Bounce deleted: ${input.id}`);
	context.output.json(result);
}

export async function renderPruneBounces(
	context: BouncesCliContext,
	input: {
		page?: number;
		per_page?: number;
		campaign_id?: number;
		source?: string;
		order_by?: "email" | "campaign_name" | "source" | "created_at";
		order?: "asc" | "desc";
		dry_run: boolean;
		bounce_ids?: number[];
	},
): Promise<void> {
	const result = await invokePruneBouncesOperation(context, input);
	if (result.dry_run) {
		context.output.info(
			`Dry run: ${result.bounce_ids.length} of ${result.total} bounce records selected (page ${result.page}, per page ${result.per_page})`,
		);
	} else {
		context.output.success(
			`Pruned ${result.acknowledged} bounce record(s) by echoed id`,
		);
	}
	context.output.json(result);
}

type ListBouncesCommandFlags = {
	page?: number;
	"per-page"?: number;
	"campaign-id"?: number;
	source?: string;
	"order-by"?: "email" | "campaign_name" | "source" | "created_at";
	order?: "asc" | "desc";
};

export async function handleListBouncesCommand({
	flags,
	...args
}: HandlerArgs<ListBouncesCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderBounces(
			{ client, output: getOutput() },
			{
				page: flags.page,
				per_page: flags["per-page"],
				campaign_id: flags["campaign-id"],
				source: flags.source,
				order_by: flags["order-by"],
				order: flags.order,
			},
		);
	} catch (error) {
		throw createBouncesCommandError("Failed to list bounces", error);
	}
}

export async function handleGetBounceCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderBounce({ client, output: getOutput() }, { id: flags.id });
	} catch (error) {
		throw createBouncesCommandError("Failed to get bounce", error);
	}
}

export async function handleDeleteBounceCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDeleteBounce(
			{ client, output: getOutput() },
			{
				id: flags.id,
			},
		);
	} catch (error) {
		throw createBouncesCommandError("Failed to delete bounce", error);
	}
}

type PruneBouncesCommandFlags = {
	page?: number;
	"per-page"?: number;
	"campaign-id"?: number;
	source?: string;
	"order-by"?: "email" | "campaign_name" | "source" | "created_at";
	order?: "asc" | "desc";
	"dry-run"?: boolean;
	"bounce-ids"?: string;
};

export async function handlePruneBouncesCommand({
	flags,
	...args
}: HandlerArgs<PruneBouncesCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		const bounceIds = flags["bounce-ids"]
			?.split(",")
			.map((value) => value.trim())
			.filter((value) => value.length > 0)
			.map(Number);
		await renderPruneBounces(
			{ client, output: getOutput() },
			{
				page: flags.page,
				per_page: flags["per-page"],
				campaign_id: flags["campaign-id"],
				source: flags.source,
				order_by: flags["order-by"],
				order: flags.order,
				dry_run: flags["dry-run"] ?? true,
				bounce_ids: bounceIds,
			},
		);
	} catch (error) {
		throw createBouncesCommandError("Failed to prune bounces", error);
	}
}

export default defineGroup({
	name: "bounces",
	description: "Inspect recorded bounce events",
	commands: [
		defineCommand({
			name: "list",
			operationId: "bounces.list",
			description: "List recorded bounce events",
			options: {
				page: option(z.coerce.number().int().positive().optional(), {
					description: "Page number",
				}),
				"per-page": option(z.coerce.number().int().positive().optional(), {
					description: "Items per page",
				}),
				"campaign-id": option(z.coerce.number().int().positive().optional(), {
					description: "Filter bounces by campaign ID",
				}),
				source: option(z.string().trim().min(1).optional(), {
					description: "Filter by bounce source",
				}),
				"order-by": option(
					z
						.enum(["email", "campaign_name", "source", "created_at"])
						.optional(),
					{ description: "Sort field applied by Listmonk" },
				),
				order: option(z.enum(["asc", "desc"]).optional(), {
					description: "Sort direction",
				}),
			},
			handler: handleListBouncesCommand,
		}),
		defineCommand({
			name: "get",
			operationId: "bounces.get",
			description: "Get a recorded bounce event by ID",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Bounce ID",
				}),
			},
			handler: handleGetBounceCommand,
		}),
		defineCommand({
			name: "delete",
			operationId: "bounces.delete",
			description: "Delete a recorded bounce event by ID",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Bounce ID",
				}),
			},
			handler: handleDeleteBounceCommand,
		}),
		defineCommand({
			name: "prune",
			operationId: "bounces.prune",
			description: "Preview or delete a bounded selection of bounce records",
			options: {
				page: option(z.coerce.number().int().positive().optional(), {
					description: "Selection window page (dry run)",
				}),
				"per-page": option(
					z.coerce
						.number()
						.int()
						.positive()
						.max(MAX_BOUNCE_PRUNE_IDS)
						.optional(),
					{
						description: `Selection window size, at most ${MAX_BOUNCE_PRUNE_IDS} (dry run)`,
					},
				),
				"campaign-id": option(z.coerce.number().int().positive().optional(), {
					description: "Filter bounces by campaign ID (dry run)",
				}),
				source: option(z.string().trim().min(1).optional(), {
					description: "Filter by bounce source (dry run)",
				}),
				"order-by": option(
					z
						.enum(["email", "campaign_name", "source", "created_at"])
						.optional(),
					{ description: "Sort field applied by Listmonk (dry run)" },
				),
				order: option(z.enum(["asc", "desc"]).optional(), {
					description: "Sort direction (dry run)",
				}),
				"dry-run": option(z.coerce.boolean().default(true), {
					description: "Preview instead of deleting (defaults to true)",
				}),
				"bounce-ids": option(z.string().trim().min(1).optional(), {
					description:
						"Comma-separated bounce ids echoed from a dry run; required with --no-dry-run",
				}),
			},
			handler: handlePruneBouncesCommand,
		}),
	],
});
