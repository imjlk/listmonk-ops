import type { List, ListmonkClient } from "@listmonk-ops/openapi";
import { z } from "zod";
import { defineOperation } from "./operation";

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
		.max(1000)
		.default(20)
		.describe("Number of items per page"),
});

const listIdInputSchema = z.object({
	id: z.coerce
		.number()
		.int()
		.positive()
		.describe("Subscriber list ID"),
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

const updateListInputSchema = z.object({
	id: z.coerce
		.number()
		.int()
		.positive()
		.describe("Subscriber list ID"),
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
});

const deleteListOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String(error.message);
	}
	return String(error);
}

function unwrapData<T>(response: DataResponse<T>, context: string): T {
	if ("error" in response && response.error !== undefined) {
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
		query: { page: 1, per_page: pageSize },
	});
	const firstPage = unwrapData(firstResponse, "Failed to resolve created list");
	const firstMatch = firstPage.results?.find((list) => list.name === name);
	if (firstMatch) {
		return firstMatch;
	}

	const lastPage = Math.max(1, Math.ceil((firstPage.total ?? 0) / pageSize));
	if (lastPage === 1) {
		return undefined;
	}

	const lastResponse = await client.list.list({
		query: { page: lastPage, per_page: pageSize },
	});
	const lastPageData = unwrapData(
		lastResponse,
		"Failed to resolve created list",
	);
	return lastPageData.results?.find((list) => list.name === name);
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

	if ("error" in response && response.error !== undefined) {
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

export const listOperations = [
	getListsOperation,
	getListOperation,
	createListOperation,
	updateListOperation,
	deleteListOperation,
] as const;

export type ListOperation = (typeof listOperations)[number];

const listOperationsByMcpName = new Map<string, ListOperation>(
	listOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getListOperationByMcpName(
	name: string,
): ListOperation | undefined {
	return listOperationsByMcpName.get(name);
}
