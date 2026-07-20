import { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getListOperation,
	getListsOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type ListsOutput = Pick<typeof OutputUtils, "info" | "json" | "table">;

export interface ListsCliContext {
	client: Pick<ListmonkClient, "list">;
	output: ListsOutput;
}

export interface ListListsInput {
	page?: number;
	per_page?: number;
}

export interface GetListInput {
	id: number;
}

export function createListCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) {
		return error;
	}
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderSubscriberLists(
	context: ListsCliContext,
	input: ListListsInput,
): Promise<void> {
	const page = await getListsOperation.invoke(context, input);
	if (page.results.length === 0) {
		context.output.info("No lists found");
		return;
	}

	context.output.table(page.results as Record<string, unknown>[]);
}

export async function renderSubscriberList(
	context: ListsCliContext,
	input: GetListInput,
): Promise<void> {
	const list = await getListOperation.invoke(context, input);
	context.output.json(list);
}

type ListCommandFlags = {
	page?: number;
	"per-page"?: number;
};

export async function handleListListsCommand({
	flags,
	...args
}: HandlerArgs<ListCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSubscriberLists(
			{ client, output: OutputUtils },
			{ page: flags.page, per_page: flags["per-page"] },
		);
	} catch (error) {
		throw createListCommandError("Failed to list lists", error);
	}
}

type GetCommandFlags = {
	id: number;
};

export async function handleGetListCommand({
	flags,
	...args
}: HandlerArgs<GetCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSubscriberList(
			{ client, output: OutputUtils },
			{ id: flags.id },
		);
	} catch (error) {
		throw createListCommandError("Failed to get list", error);
	}
}

export default defineGroup({
	name: "lists",
	description: "Manage subscriber lists",
	commands: [
		defineCommand({
			name: "list",
			description: "List subscriber lists",
			options: {
				page: option(z.coerce.number().int().positive().optional(), {
					description: "Page number",
				}),
				"per-page": option(
					z.coerce.number().int().positive().max(1000).optional(),
					{ description: "Items per page" },
				),
			},
			handler: handleListListsCommand,
		}),
		defineCommand({
			name: "get",
			description: "Get list details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "List ID",
				}),
			},
			handler: handleGetListCommand,
		}),
	],
});
