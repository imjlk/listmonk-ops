import type { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeDeleteBounceOperation,
	invokeGetBounceOperation,
	invokeListBouncesOperation,
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
	],
});
