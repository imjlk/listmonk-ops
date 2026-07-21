import { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeCreateListOperation,
	invokeDeleteListOperation,
	invokeGetListOperation,
	invokeGetListsOperation,
	invokeUpdateListOperation,
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

type ListsOutput = Pick<typeof OutputUtils, "info" | "json" | "success" | "table">;

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

export interface CreateListInput {
	name: string;
	type?: "public" | "private";
	optin?: "single" | "double";
	description?: string;
	tags?: string[];
}

export interface UpdateListInput {
	id: number;
	name?: string;
	type?: "public" | "private";
	optin?: "single" | "double";
	description?: string;
	tags?: string[];
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
	const page = await invokeGetListsOperation(context, input);
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
	const list = await invokeGetListOperation(context, input);
	context.output.json(list);
}

function parseListTags(value: string | undefined): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}

	const tags = value
		.split(",")
		.map((tag) => tag.trim())
		.filter((tag) => tag.length > 0);
	if (tags.length === 0) {
		throw new Error("Expected a comma-separated list of non-empty tags");
	}
	return tags;
}

export async function renderCreateSubscriberList(
	context: ListsCliContext,
	input: CreateListInput,
): Promise<void> {
	const list = await invokeCreateListOperation(context, input);
	context.output.success(`List created: ${list.id ?? input.name}`);
	context.output.json(list);
}

export async function renderUpdateSubscriberList(
	context: ListsCliContext,
	input: UpdateListInput,
): Promise<void> {
	const { id, ...changes } = input;
	if (Object.keys(changes).length === 0) {
		throw new Error("At least one list field must be provided for update");
	}

	const list = await invokeUpdateListOperation(context, input);
	context.output.success(`List updated: ${id}`);
	context.output.json(list);
}

export async function renderDeleteSubscriberList(
	context: ListsCliContext,
	input: GetListInput,
): Promise<void> {
	const result = await invokeDeleteListOperation(context, input);
	context.output.success(`List deleted: ${input.id}`);
	context.output.json(result);
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

type CreateCommandFlags = {
	name: string;
	type: "public" | "private";
	optin: "single" | "double";
	description?: string;
	tags?: string;
};

export async function handleCreateListCommand({
	flags,
	...args
}: HandlerArgs<CreateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderCreateSubscriberList(
			{ client, output: OutputUtils },
			{
				name: flags.name,
				type: flags.type,
				optin: flags.optin,
				description: flags.description,
				tags: parseListTags(flags.tags),
			},
		);
	} catch (error) {
		throw createListCommandError("Failed to create list", error);
	}
}

type UpdateCommandFlags = {
	id: number;
	name?: string;
	type?: "public" | "private";
	optin?: "single" | "double";
	description?: string;
	tags?: string;
};

export async function handleUpdateListCommand({
	flags,
	...args
}: HandlerArgs<UpdateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderUpdateSubscriberList(
			{ client, output: OutputUtils },
			{
				id: flags.id,
				name: flags.name,
				type: flags.type,
				optin: flags.optin,
				description: flags.description,
				tags: parseListTags(flags.tags),
			},
		);
	} catch (error) {
		throw createListCommandError("Failed to update list", error);
	}
}

export async function handleDeleteListCommand({
	flags,
	...args
}: HandlerArgs<GetCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDeleteSubscriberList(
			{ client, output: OutputUtils },
			{ id: flags.id },
		);
	} catch (error) {
		throw createListCommandError("Failed to delete list", error);
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
					z.coerce.number().int().positive().optional(),
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
		defineCommand({
			name: "create",
			description: "Create a subscriber list",
			options: {
				name: option(z.string().trim().min(1), {
					description: "List name",
				}),
				type: option(z.enum(["public", "private"]).default("private"), {
					description: "List visibility",
				}),
				optin: option(z.enum(["single", "double"]).default("single"), {
					description: "Opt-in type",
				}),
				description: option(z.string().optional(), {
					description: "List description",
				}),
				tags: option(z.string().trim().optional(), {
					description: "Comma-separated list tags",
				}),
			},
			handler: handleCreateListCommand,
		}),
		defineCommand({
			name: "update",
			description: "Update a subscriber list",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "List ID",
				}),
				name: option(z.string().trim().min(1).optional(), {
					description: "List name",
				}),
				type: option(z.enum(["public", "private"]).optional(), {
					description: "List visibility",
				}),
				optin: option(z.enum(["single", "double"]).optional(), {
					description: "Opt-in type",
				}),
				description: option(z.string().optional(), {
					description: "List description",
				}),
				tags: option(z.string().trim().optional(), {
					description: "Comma-separated list tags",
				}),
			},
			handler: handleUpdateListCommand,
		}),
		defineCommand({
			name: "delete",
			description: "Delete a subscriber list",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "List ID",
				}),
			},
			handler: handleDeleteListCommand,
		}),
	],
});
