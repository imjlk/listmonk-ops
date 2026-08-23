import type { ResourceCreateIdempotencyStore } from "@listmonk-ops/common";
import type { List, ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindListsCreateOperationSpec,
	bindListsDeleteOperationSpec,
	bindListsGetOperationSpec,
	bindListsListOperationSpec,
	bindListsUpdateOperationSpec,
} from "./specs";
import { executeKeyedCreate } from "./keyed-create";
import { isDefinitivePreDispatchError } from "./transactional-idempotency";
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
	/**
	 * Adapter-supplied resource-create idempotency store. When absent, an
	 * `idempotency_key` is rejected as unsupported on this surface; CLI and
	 * MCP inject a file-backed implementation.
	 */
	createIdempotencyStore?: ResourceCreateIdempotencyStore;
	/** SHA-256 digest helper paired with the store (runtime-neutral). */
	hashCreatePayload?: (serialized: string) => string;
	/**
	 * Resolved Listmonk identity namespacing idempotency records. Required
	 * when `idempotency_key` is used so a key can never replay across
	 * instances.
	 */
	target?: {
		baseUrl?: string;
		username?: string;
	};
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
	response?: { status?: number };
};

const subscriberListSchema = z.looseObject({
	id: z.number().int().positive().optional(),
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

const listCreateOutputSchema = z.object({
	list: subscriberListSchema,
	created: z.boolean(),
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
	idempotency_key: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.optional()
		.describe(
			"Caller-scoped create key; an identical retry with the same key replays the originally created list instead of creating a duplicate",
		),
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

/**
 * Exact-name matches across list pages. Paging stops early once
 * `maxMatches` are found, so single-match resolution does not scan the
 * whole catalog while recovery still detects ambiguity.
 */
async function findListsByName(
	client: Pick<ListmonkClient, "list">,
	name: string,
	options: { maxMatches?: number } = {},
): Promise<List[]> {
	const maxMatches = options.maxMatches ?? Number.POSITIVE_INFINITY;
	const pageSize = 100;
	const matches: List[] = [];
	const firstResponse = await client.list.list({
		query: { page: 1, per_page: pageSize, query: name },
	});
	const firstPage = unwrapData(firstResponse, "Failed to resolve created list");
	matches.push(
		...(firstPage.results?.filter((list) => list.name === name) ?? []),
	);
	if (matches.length >= maxMatches) {
		return matches;
	}

	const pageCount = Math.max(1, Math.ceil((firstPage.total ?? 0) / pageSize));
	for (let page = 2; page <= pageCount; page += 1) {
		const response = await client.list.list({
			query: { page, per_page: pageSize, query: name },
		});
		const pageData = unwrapData(response, "Failed to resolve created list");
		matches.push(
			...(pageData.results?.filter((list) => list.name === name) ?? []),
		);
		if (matches.length >= maxMatches) {
			return matches;
		}
	}

	return matches;
}

export interface ListCreateResult {
	list: List;
	created: boolean;
}

function canonicalListCreatePayload(
	input: z.output<typeof createListInputSchema>,
): Record<string, unknown> {
	return {
		name: input.name,
		type: input.type,
		optin: input.optin,
		description: input.description,
		tags: [...input.tags].sort(),
	};
}

/**
 * Correlate an accepted keyed create that came back without a usable id to
 * the list it produced. A name match is never proof — names are not unique
 * and another caller may have created a same-named list — so binding is
 * authorized only by immutable identity: the created record's `uuid` from
 * the create response matching exactly one list in the name-scoped search.
 */
async function correlateCreatedList(
	client: Pick<ListmonkClient, "list">,
	name: string,
	createdUuid: string,
): Promise<List | undefined> {
	const matches = await findListsByName(client, name);
	const correlated = matches.filter((list) => list.uuid === createdUuid);
	const candidate = correlated[0];
	if (
		correlated.length === 1 &&
		candidate !== undefined &&
		candidate.id !== undefined
	) {
		return candidate;
	}
	return undefined;
}

async function createSubscriberListUnkeyed(
	client: Pick<ListmonkClient, "list">,
	input: z.output<typeof createListInputSchema>,
): Promise<ListCreateResult> {
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
		return { list: response.data, created: true };
	}
	const matches = await findListsByName(client, input.name, { maxMatches: 1 });
	const created = matches[0];
	if (!created) {
		throw new Error(
			"List was created but the created record could not be resolved",
		);
	}
	return { list: created, created: true };
}

export async function createSubscriberList(
	{ client, createIdempotencyStore, hashCreatePayload, target }: ListOperationContext,
	input: z.output<typeof createListInputSchema>,
): Promise<ListCreateResult> {
	if (input.idempotency_key === undefined) {
		return createSubscriberListUnkeyed(client, input);
	}
	if (createIdempotencyStore === undefined || hashCreatePayload === undefined) {
		throw new Error(
			"idempotency_key requires a resource-create idempotency store on this surface",
		);
	}
	if (!target?.baseUrl || !target?.username) {
		throw new Error(
			"idempotency_key requires a resolved Listmonk target (baseUrl and username) so the key cannot replay across instances",
		);
	}

	const result = await executeKeyedCreate<List>({
		store: createIdempotencyStore,
		hashCreatePayload,
		target: { baseUrl: target.baseUrl, username: target.username },
		key: input.idempotency_key,
		resourceKind: "list",
		resourceLabel: "list",
		canonicalPayload: canonicalListCreatePayload(input),
		resourceIdOf: (list) =>
			list.id !== undefined ? String(list.id) : undefined,
		describeResource: (list) => `id ${String(list.id ?? list.name ?? "?")}`,
		replay: async (resourceId) => {
			try {
				return await getSubscriberList(
					{ client },
					{ id: Number(resourceId) },
				);
			} catch (error) {
				throw new Error(
					`Idempotency replay could not load list ${resourceId}: ${toErrorMessage(error)}`,
					{ cause: error },
				);
			}
		},
		issue: async () => {
			let response: Awaited<ReturnType<typeof client.list.create>>;
			try {
				response = await client.list.create({
					body: {
						name: input.name,
						type: input.type,
						optin: input.optin,
						description: input.description,
						tags: input.tags,
					},
				});
			} catch (error) {
				return {
					failure: {
						error,
						// Proven pre-dispatch failures (ECONNREFUSED, ENOTFOUND,
						// 4xx with a status) never reached Listmonk; everything
						// else is ambiguous.
						definitive: isDefinitivePreDispatchError(error),
					},
				};
			}
			if (hasResponseError(response)) {
				const status =
					typeof response.response?.status === "number"
						? response.response.status
						: undefined;
				return {
					failure: {
						error: new Error(
							`Failed to create list: ${toErrorMessage(response.error)}`,
						),
						// A 4xx answer rejected the request outright; a 5xx or a
						// statusless error may have partially processed it.
						definitive: status !== undefined && status >= 400 && status < 500,
					},
				};
			}
			if (response.data?.id !== undefined) {
				return { resource: response.data };
			}
			// No usable id: only immutable correlation may bind the key — a
			// name match alone is never proof — so correlate the created
			// record's uuid, when the response supplied one, against the
			// name-scoped lists.
			if (response.data?.uuid !== undefined) {
				try {
					const correlated = await correlateCreatedList(
						client,
						input.name,
						response.data.uuid,
					);
					if (correlated !== undefined) {
						return { resource: correlated };
					}
				} catch (error) {
					return {
						failure: {
							error: new Error(
								`Keyed list create was accepted but the created record could not be re-read: ${toErrorMessage(error)}`,
								{ cause: error },
							),
							definitive: false,
						},
					};
				}
			}
			return {};
		},
	});
	return { list: result.resource, created: result.created };
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
	spec: bindListsListOperationSpec(),
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
	spec: bindListsGetOperationSpec(),
	execute: getSubscriberList,
});

export const createListOperation = defineOperation({
	id: "lists.create",
	title: "Create subscriber list",
	description: "Create a new subscriber list",
	inputSchema: createListInputSchema,
	outputSchema: listCreateOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_create_list" },
	spec: bindListsCreateOperationSpec(),
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
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_update_list",
		legacySuccessText: "List updated successfully",
	},
	spec: bindListsUpdateOperationSpec(),
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
	spec: bindListsDeleteOperationSpec(),
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
): Promise<z.output<typeof listCreateOutputSchema>> {
	const parsedInput = parseOperationInput(
		createListOperation.inputSchema,
		input,
	);
	let output: ListCreateResult;
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
	specMigrationExemptions: [],
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
