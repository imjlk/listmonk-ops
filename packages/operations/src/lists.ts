import type { List, ListmonkClient } from "@listmonk-ops/openapi";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

export interface ListOperationContext {
	client: Pick<ListmonkClient, "list">;
}

export interface ListPage {
	results: List[];
	total: number;
	per_page: number;
	page: number;
}

type DataResponse<T> = {
	data?: T;
	error?: unknown;
};

const subscriberListSchema = z.looseObject({
	id: z.number().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	uuid: z.string().optional(),
	name: z.string().optional(),
	type: z.string().optional(),
	optin: z.string().optional(),
	tags: z.array(z.string()).optional(),
	subscriber_count: z.number().optional(),
	description: z.string().optional(),
});

const listPageSchema = z.object({
	results: z.array(subscriberListSchema),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

const listInputSchema = z.object({
	page: z.coerce
		.number()
		.int()
		.positive()
		.default(1)
		.describe("Page number for pagination"),
	per_page: z.coerce
		.number()
		.int()
		.positive()
		.default(20)
		.describe("Number of items per page"),
});

const positiveIdSchema = z.number().int().positive();
const subscriberListIdSchema = z
	.codec(
		z.union([
			positiveIdSchema,
			z.string().regex(/^[1-9][0-9]*$/),
		]),
		positiveIdSchema,
		{
			decode: (value) => Number(value),
			encode: (value) => value,
		},
	)
	.describe("Subscriber list ID");

const listIdInputSchema = z.object({
	id: subscriberListIdSchema,
});

const createListInputSchema = z.object({
	name: z.string().trim().min(1).describe("List name"),
	type: z
		.enum(["public", "private"])
		.default("private")
		.describe("List visibility"),
	optin: z
		.enum(["single", "double"])
		.default("single")
		.describe("Opt-in type"),
	description: z.string().default("").describe("List description"),
	tags: z.array(z.string()).default([]).describe("List tags"),
});

const updateListInputSchema = z
	.object({
		id: subscriberListIdSchema,
		name: z.string().trim().min(1).optional().describe("List name"),
		type: z
			.enum(["public", "private"])
			.optional()
			.describe("List visibility"),
		optin: z
			.enum(["single", "double"])
			.optional()
			.describe("Opt-in type"),
		description: z.string().optional().describe("List description"),
		tags: z.array(z.string()).optional().describe("List tags"),
	})
	.refine(
		({ id: _id, ...changes }) =>
			Object.values(changes).some((value) => value !== undefined),
		{
			message: "At least one list field must be provided for update",
			path: ["id"],
		},
	);

const deleteListOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === "object") {
		if ("message" in error && typeof error.message === "string") {
			return error.message;
		}
		if ("error" in error && typeof error.error === "string") {
			return error.error;
		}
		try {
			return JSON.stringify(error);
		} catch {
			// Fall through to String conversion for non-serializable values.
		}
	}
	return String(error);
}

function hasResponseError<T>(
	response: DataResponse<T>,
): response is DataResponse<T> & { error: unknown } {
	return response.error !== undefined;
}

function unwrapData<T>(response: DataResponse<T>, context: string): T {
	if (hasResponseError(response)) {
		throw new Error(`${context}: ${toErrorMessage(response.error)}`);
	}
	if (response.data === undefined) {
		throw new Error(`${context}: received empty data`);
	}
	return response.data;
}

export async function listSubscriberLists(
	{ client }: ListOperationContext,
	input: z.output<typeof listInputSchema>,
): Promise<ListPage> {
	const response = await client.list.list({
		query: { page: input.page, per_page: input.per_page },
	});
	const data = unwrapData(response, "Failed to fetch lists");
	return {
		results: data.results ?? [],
		total: data.total ?? 0,
		per_page: data.per_page ?? input.per_page,
		page: data.page ?? input.page,
	};
}

export async function getSubscriberList(
	{ client }: ListOperationContext,
	input: z.output<typeof listIdInputSchema>,
): Promise<List> {
	const response = await client.list.getById({
		path: { list_id: input.id },
	});
	return unwrapData(response, "Failed to fetch list");
}

async function findCreatedList(
	client: Pick<ListmonkClient, "list">,
	name: string,
): Promise<List | undefined> {
	const pageSize = 100;
	const firstResponse = await client.list.list({
		query: { page: 1, per_page: pageSize, query: name },
	});
	const firstPage = unwrapData(firstResponse, "Failed to resolve created list");
	const firstMatch = firstPage.results?.find((list) => list.name === name);
	if (firstMatch) {
		return firstMatch;
	}

	const pageCount = Math.max(1, Math.ceil((firstPage.total ?? 0) / pageSize));
	for (let page = 2; page <= pageCount; page += 1) {
		const response = await client.list.list({
			query: { page, per_page: pageSize, query: name },
		});
		const pageData = unwrapData(response, "Failed to resolve created list");
		const match = pageData.results?.find((list) => list.name === name);
		if (match) {
			return match;
		}
	}

	return undefined;
}

export async function createSubscriberList(
	{ client }: ListOperationContext,
	input: z.output<typeof createListInputSchema>,
): Promise<List> {
	const response = await client.list.create({
		body: {
			name: input.name,
			type: input.type,
			optin: input.optin,
			description: input.description,
			tags: input.tags,
		},
	});

	if (hasResponseError(response)) {
		throw new Error(`Failed to create list: ${toErrorMessage(response.error)}`);
	}
	if (response.data !== undefined) {
		return response.data;
	}

	const createdList = await findCreatedList(client, input.name);
	if (!createdList) {
		throw new Error(
			"List was created but the created record could not be resolved",
		);
	}
	return createdList;
}

export async function updateSubscriberList(
	{ client }: ListOperationContext,
	input: z.output<typeof updateListInputSchema>,
): Promise<List> {
	const { id, ...body } = input;
	const response = await client.list.update({
		path: { list_id: id },
		body,
	});
	return unwrapData(response, "Failed to update list");
}

export async function deleteSubscriberList(
	{ client }: ListOperationContext,
	input: z.output<typeof listIdInputSchema>,
): Promise<z.output<typeof deleteListOutputSchema>> {
	const response = await client.list.delete({
		path: { list_id: input.id },
	});
	return {
		id: input.id,
		deleted: unwrapData(response, "Failed to delete list"),
	};
}

const readSafety = {
	readOnlyHint: true,
	destructiveHint: false,
	idempotentHint: true,
	openWorldHint: true,
} as const;

export const getListsOperation = defineOperation({
	id: "lists.list",
	title: "List subscriber lists",
	description: "Get subscriber lists from Listmonk",
	inputSchema: listInputSchema,
	outputSchema: listPageSchema,
	safety: readSafety,
	mcp: { name: "listmonk_get_lists" },
	execute: listSubscriberLists,
});

export const getListOperation = defineOperation({
	id: "lists.get",
	title: "Get subscriber list",
	description: "Get a specific subscriber list by ID",
	inputSchema: listIdInputSchema,
	outputSchema: subscriberListSchema,
	safety: readSafety,
	mcp: { name: "listmonk_get_list" },
	execute: getSubscriberList,
});

export const createListOperation = defineOperation({
	id: "lists.create",
	title: "Create subscriber list",
	description: "Create a new subscriber list",
	inputSchema: createListInputSchema,
	outputSchema: subscriberListSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_create_list" },
	execute: createSubscriberList,
});

export const updateListOperation = defineOperation({
	id: "lists.update",
	title: "Update subscriber list",
	description: "Update an existing subscriber list",
	inputSchema: updateListInputSchema,
	outputSchema: subscriberListSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_update_list",
		legacySuccessText: "List updated successfully",
	},
	execute: updateSubscriberList,
});

export const deleteListOperation = defineOperation({
	id: "lists.delete",
	title: "Delete subscriber list",
	description: "Delete a subscriber list",
	inputSchema: listIdInputSchema,
	outputSchema: deleteListOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_delete_list",
		legacySuccessText: "List deleted successfully",
	},
	execute: deleteSubscriberList,
});

// Keep these invokers as explicit functions instead of a callback-based helper.
// ttsc-graph can then preserve each adapter -> invoker -> domain action edge.
// Their shared validation, error, and output rules stay centralized in operation.ts.
export async function invokeGetListsOperation(
	context: ListOperationContext,
	input: unknown,
): Promise<z.output<typeof listPageSchema>> {
	const parsedInput = parseOperationInput(getListsOperation.inputSchema, input);
	let output: ListPage;
	try {
		output = await listSubscriberLists(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getListsOperation.id, error);
	}
	return parseOperationOutput(
		getListsOperation.id,
		getListsOperation.outputSchema,
		output,
	);
}

export async function invokeGetListOperation(
	context: ListOperationContext,
	input: unknown,
): Promise<z.output<typeof subscriberListSchema>> {
	const parsedInput = parseOperationInput(getListOperation.inputSchema, input);
	let output: List;
	try {
		output = await getSubscriberList(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getListOperation.id, error);
	}
	return parseOperationOutput(
		getListOperation.id,
		getListOperation.outputSchema,
		output,
	);
}

export async function invokeCreateListOperation(
	context: ListOperationContext,
	input: unknown,
): Promise<z.output<typeof subscriberListSchema>> {
	const parsedInput = parseOperationInput(
		createListOperation.inputSchema,
		input,
	);
	let output: List;
	try {
		output = await createSubscriberList(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(createListOperation.id, error);
	}
	return parseOperationOutput(
		createListOperation.id,
		createListOperation.outputSchema,
		output,
	);
}

export async function invokeUpdateListOperation(
	context: ListOperationContext,
	input: unknown,
): Promise<z.output<typeof subscriberListSchema>> {
	const parsedInput = parseOperationInput(
		updateListOperation.inputSchema,
		input,
	);
	let output: List;
	try {
		output = await updateSubscriberList(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(updateListOperation.id, error);
	}
	return parseOperationOutput(
		updateListOperation.id,
		updateListOperation.outputSchema,
		output,
	);
}

export async function invokeDeleteListOperation(
	context: ListOperationContext,
	input: unknown,
): Promise<z.output<typeof deleteListOutputSchema>> {
	const parsedInput = parseOperationInput(
		deleteListOperation.inputSchema,
		input,
	);
	let output: z.output<typeof deleteListOutputSchema>;
	try {
		output = await deleteSubscriberList(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(deleteListOperation.id, error);
	}
	return parseOperationOutput(
		deleteListOperation.id,
		deleteListOperation.outputSchema,
		output,
	);
}

export const listOperations = [
	getListsOperation,
	getListOperation,
	createListOperation,
	updateListOperation,
	deleteListOperation,
] as const;

export const listOperationCatalog = defineOperationCatalog({
	id: "lists",
	title: "Subscriber lists",
	operations: listOperations,
});

export type ListOperation = (typeof listOperations)[number];

const listOperationsByMcpName = new Map<string, ListOperation>(
	listOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getListOperationByMcpName(
	name: string,
): ListOperation | undefined {
	return listOperationsByMcpName.get(name);
}

export interface ListOperationInvocation {
	operation: ListOperation;
	output: Record<string, unknown>;
}

export async function invokeListOperationByMcpName(
	context: ListOperationContext,
	name: string,
	input: unknown,
): Promise<ListOperationInvocation | undefined> {
	switch (name) {
		case getListsOperation.mcp.name:
			return {
				operation: getListsOperation,
				output: await invokeGetListsOperation(context, input),
			};
		case getListOperation.mcp.name:
			return {
				operation: getListOperation,
				output: await invokeGetListOperation(context, input),
			};
		case createListOperation.mcp.name:
			return {
				operation: createListOperation,
				output: await invokeCreateListOperation(context, input),
			};
		case updateListOperation.mcp.name:
			return {
				operation: updateListOperation,
				output: await invokeUpdateListOperation(context, input),
			};
		case deleteListOperation.mcp.name:
			return {
				operation: deleteListOperation,
				output: await invokeDeleteListOperation(context, input),
			};
		default:
			return undefined;
	}
}
