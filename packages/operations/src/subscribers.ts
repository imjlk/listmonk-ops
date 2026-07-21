import type { ListmonkClient, Subscriber } from "@listmonk-ops/openapi";
import { z } from "zod";
import {
	createResourceSafety,
	deleteResourceSafety,
	jsonResourceValue,
	normalizeResourceList,
	readResourceSafety,
	resourceIdSchema,
	toResourceErrorMessage,
	unwrapResourceResponse,
	updateResourceSafety,
} from "./resource-helpers";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

export interface SubscriberOperationContext {
	client: Pick<ListmonkClient, "subscriber">;
}

const subscriberStatusSchema = z.enum(["enabled", "disabled", "blocklisted"]);
const subscriberOrderBySchema = z.enum([
	"name",
	"status",
	"created_at",
	"updated_at",
]);
const subscriberOrderSchema = z.enum(["ASC", "DESC"]);

const subscriberSchema = z.looseObject({
	id: z.number().int().positive().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	uuid: z.string().optional(),
	email: z.string().optional(),
	name: z.string().optional(),
	status: z.string().optional(),
	attribs: z.record(z.string(), z.unknown()).optional(),
	lists: z.array(z.looseObject({})).optional(),
});

const subscriberListOutputSchema = z.object({
	results: z.array(subscriberSchema),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

const subscriberIdInputSchema = z.object({
	id: resourceIdSchema,
});

const subscriberListIdSchema = z.preprocess(
	(value) => (Array.isArray(value)
		? value
		: value === undefined
			? undefined
			: [value]),
	z.array(resourceIdSchema).optional(),
);

const subscriberListInputSchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	per_page: z.union([z.coerce.number().int().positive(), z.literal("all")]).default(20),
	list_id: subscriberListIdSchema,
	query: z.string().trim().optional(),
	order_by: subscriberOrderBySchema.optional(),
	order: subscriberOrderSchema.optional(),
	subscription_status: z.string().trim().min(1).optional(),
});

const subscriberFields = {
	email: z.string().trim().email(),
	name: z.string().trim().optional(),
	status: subscriberStatusSchema.optional(),
	lists: z.array(resourceIdSchema).optional(),
	list_uuids: z.array(z.string()).optional(),
	preconfirm_subscriptions: z.boolean().optional(),
	attribs: z.record(z.string(), z.unknown()).optional(),
};

const createSubscriberInputSchema = z.object({
	email: subscriberFields.email,
	name: subscriberFields.name.default(""),
	status: subscriberFields.status.default("enabled"),
	lists: subscriberFields.lists.default([]),
	list_uuids: subscriberFields.list_uuids,
	preconfirm_subscriptions: subscriberFields.preconfirm_subscriptions,
	attribs: subscriberFields.attribs.default({}),
});

const updateSubscriberInputSchema = z
	.object({
		id: resourceIdSchema,
		email: subscriberFields.email.optional(),
		name: subscriberFields.name,
		status: subscriberFields.status,
		lists: subscriberFields.lists,
		list_uuids: subscriberFields.list_uuids,
		preconfirm_subscriptions: subscriberFields.preconfirm_subscriptions,
		attribs: subscriberFields.attribs,
	})
	.refine(
		({ id: _id, ...changes }) =>
			Object.values(changes).some((value) => value !== undefined),
		{
			message: "At least one subscriber field must be provided for update",
			path: ["id"],
		},
	);

const deleteSubscriberOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

export type SubscriberListPage = z.output<typeof subscriberListOutputSchema>;

type SubscriberCreateBody = NonNullable<
	Parameters<ListmonkClient["subscriber"]["create"]>[0]["body"]
>;
type SubscriberUpdateBody = NonNullable<
	Parameters<ListmonkClient["subscriber"]["update"]>[0]["body"]
>;

function asSubscriber(value: Subscriber): z.output<typeof subscriberSchema> {
	return value as z.output<typeof subscriberSchema>;
}

export async function listSubscribers(
	{ client }: SubscriberOperationContext,
	input: z.output<typeof subscriberListInputSchema>,
): Promise<SubscriberListPage> {
	const query: Record<string, unknown> = {
		page: input.page,
		per_page: input.per_page,
	};
	if (input.list_id) query.list_id = input.list_id;
	if (input.query) query.query = input.query;
	if (input.order_by) query.order_by = input.order_by;
	if (input.order) query.order = input.order;
	if (input.subscription_status) {
		query.subscription_status = input.subscription_status;
	}

	const response = await client.subscriber.list({ query });
	const data = unwrapResourceResponse(response, "Failed to fetch subscribers");
	return normalizeResourceList(data, {
		page: input.page,
		per_page: input.per_page === "all" ? (data.results?.length ?? 0) : input.per_page,
	});
}

export async function getSubscriber(
	{ client }: SubscriberOperationContext,
	input: z.output<typeof subscriberIdInputSchema>,
): Promise<z.output<typeof subscriberSchema>> {
	const response = await client.subscriber.getById({ path: { id: input.id } });
	return asSubscriber(
		unwrapResourceResponse(response, "Failed to fetch subscriber"),
	);
}

async function findCreatedSubscriber(
	client: Pick<ListmonkClient, "subscriber">,
	email: string,
): Promise<Subscriber | undefined> {
	const pageSize = 100;
	const firstResponse = await client.subscriber.list({
		query: { page: 1, per_page: pageSize, query: email },
	});
	const data = unwrapResourceResponse(
		firstResponse,
		"Failed to resolve created subscriber",
	);
	const expectedEmail = email.toLowerCase();
	const firstMatch = data.results?.find(
		(subscriber) => subscriber.email?.toLowerCase() === expectedEmail,
	);
	if (firstMatch) return firstMatch;

	const pageCount = Math.max(1, Math.ceil((data.total ?? 0) / pageSize));
	for (let page = 2; page <= pageCount; page += 1) {
		const response = await client.subscriber.list({
			query: { page, per_page: pageSize, query: email },
		});
		const pageData = unwrapResourceResponse(
			response,
			"Failed to resolve created subscriber",
		);
		const match = pageData.results?.find(
			(subscriber) => subscriber.email?.toLowerCase() === expectedEmail,
		);
		if (match) return match;
	}

	return undefined;
}

export async function createSubscriber(
	{ client }: SubscriberOperationContext,
	input: z.output<typeof createSubscriberInputSchema>,
): Promise<z.output<typeof subscriberSchema>> {
	const response = await client.subscriber.create({
		body: input as SubscriberCreateBody,
	});
	if ("error" in response && response.error !== undefined) {
		throw new Error(
			`Failed to create subscriber: ${toResourceErrorMessage(response.error)}`,
		);
	}
	if (response.data !== undefined) return asSubscriber(response.data);

	const created = await findCreatedSubscriber(client, input.email);
	if (!created) {
		throw new Error(
			"Subscriber was created but the created record could not be resolved",
		);
	}
	return asSubscriber(created);
}

export async function updateSubscriber(
	{ client }: SubscriberOperationContext,
	input: z.output<typeof updateSubscriberInputSchema>,
): Promise<z.output<typeof subscriberSchema>> {
	const { id, ...body } = input;
	const response = await client.subscriber.update({
		path: { id },
		body: body as SubscriberUpdateBody,
	});
	return asSubscriber(
		unwrapResourceResponse(response, "Failed to update subscriber"),
	);
}

export async function deleteSubscriber(
	{ client }: SubscriberOperationContext,
	input: z.output<typeof subscriberIdInputSchema>,
): Promise<z.output<typeof deleteSubscriberOutputSchema>> {
	const response = await client.subscriber.delete({ path: { id: input.id } });
	return {
		id: input.id,
		deleted: unwrapResourceResponse(response, "Failed to delete subscriber"),
	};
}

export const getSubscribersOperation = defineOperation({
	id: "subscribers.list",
	title: "List subscribers",
	description: "Get subscribers from Listmonk",
	inputSchema: subscriberListInputSchema,
	outputSchema: subscriberListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_subscribers", legacySuccessText: jsonResourceValue },
	execute: listSubscribers,
});

export const getSubscriberOperation = defineOperation({
	id: "subscribers.get",
	title: "Get subscriber",
	description: "Get a subscriber by ID",
	inputSchema: subscriberIdInputSchema,
	outputSchema: subscriberSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_subscriber", legacySuccessText: jsonResourceValue },
	execute: getSubscriber,
});

export const createSubscriberOperation = defineOperation({
	id: "subscribers.create",
	title: "Create subscriber",
	description: "Create a subscriber in Listmonk",
	inputSchema: createSubscriberInputSchema,
	outputSchema: subscriberSchema,
	safety: createResourceSafety,
	mcp: { name: "listmonk_create_subscriber", legacySuccessText: jsonResourceValue },
	execute: createSubscriber,
});

export const updateSubscriberOperation = defineOperation({
	id: "subscribers.update",
	title: "Update subscriber",
	description: "Update a subscriber in Listmonk",
	inputSchema: updateSubscriberInputSchema,
	outputSchema: subscriberSchema,
	safety: updateResourceSafety,
	mcp: { name: "listmonk_update_subscriber", legacySuccessText: jsonResourceValue },
	execute: updateSubscriber,
});

export const deleteSubscriberOperation = defineOperation({
	id: "subscribers.delete",
	title: "Delete subscriber",
	description: "Delete a subscriber from Listmonk",
	inputSchema: subscriberIdInputSchema,
	outputSchema: deleteSubscriberOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_delete_subscriber",
		legacySuccessText: "Subscriber deleted successfully",
	},
	execute: deleteSubscriber,
});

export async function invokeGetSubscribersOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<SubscriberListPage> {
	const parsedInput = parseOperationInput(
		getSubscribersOperation.inputSchema,
		input,
	);
	let output: SubscriberListPage;
	try {
		output = await listSubscribers(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getSubscribersOperation.id, error);
	}
	return parseOperationOutput(
		getSubscribersOperation.id,
		getSubscribersOperation.outputSchema,
		output,
	);
}

export async function invokeGetSubscriberOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<z.output<typeof subscriberSchema>> {
	const parsedInput = parseOperationInput(
		getSubscriberOperation.inputSchema,
		input,
	);
	let output: z.output<typeof subscriberSchema>;
	try {
		output = await getSubscriber(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getSubscriberOperation.id, error);
	}
	return parseOperationOutput(
		getSubscriberOperation.id,
		getSubscriberOperation.outputSchema,
		output,
	);
}

export async function invokeCreateSubscriberOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<z.output<typeof subscriberSchema>> {
	const parsedInput = parseOperationInput(
		createSubscriberOperation.inputSchema,
		input,
	);
	let output: z.output<typeof subscriberSchema>;
	try {
		output = await createSubscriber(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(createSubscriberOperation.id, error);
	}
	return parseOperationOutput(
		createSubscriberOperation.id,
		createSubscriberOperation.outputSchema,
		output,
	);
}

export async function invokeUpdateSubscriberOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<z.output<typeof subscriberSchema>> {
	const parsedInput = parseOperationInput(
		updateSubscriberOperation.inputSchema,
		input,
	);
	let output: z.output<typeof subscriberSchema>;
	try {
		output = await updateSubscriber(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(updateSubscriberOperation.id, error);
	}
	return parseOperationOutput(
		updateSubscriberOperation.id,
		updateSubscriberOperation.outputSchema,
		output,
	);
}

export async function invokeDeleteSubscriberOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<z.output<typeof deleteSubscriberOutputSchema>> {
	const parsedInput = parseOperationInput(
		deleteSubscriberOperation.inputSchema,
		input,
	);
	let output: z.output<typeof deleteSubscriberOutputSchema>;
	try {
		output = await deleteSubscriber(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(deleteSubscriberOperation.id, error);
	}
	return parseOperationOutput(
		deleteSubscriberOperation.id,
		deleteSubscriberOperation.outputSchema,
		output,
	);
}

export const subscriberOperations = [
	getSubscribersOperation,
	getSubscriberOperation,
	createSubscriberOperation,
	updateSubscriberOperation,
	deleteSubscriberOperation,
] as const;

export type SubscriberOperation = (typeof subscriberOperations)[number];

const subscriberOperationsByMcpName = new Map<string, SubscriberOperation>(
	subscriberOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getSubscriberOperationByMcpName(
	name: string,
): SubscriberOperation | undefined {
	return subscriberOperationsByMcpName.get(name);
}

export interface SubscriberOperationInvocation {
	operation: SubscriberOperation;
	output: Record<string, unknown>;
}

export async function invokeSubscriberOperationByMcpName(
	context: SubscriberOperationContext,
	name: string,
	input: unknown,
): Promise<SubscriberOperationInvocation | undefined> {
	switch (name) {
		case getSubscribersOperation.mcp.name:
			return {
				operation: getSubscribersOperation,
				output: await invokeGetSubscribersOperation(context, input),
			};
		case getSubscriberOperation.mcp.name:
			return {
				operation: getSubscriberOperation,
				output: await invokeGetSubscriberOperation(context, input),
			};
		case createSubscriberOperation.mcp.name:
			return {
				operation: createSubscriberOperation,
				output: await invokeCreateSubscriberOperation(context, input),
			};
		case updateSubscriberOperation.mcp.name:
			return {
				operation: updateSubscriberOperation,
				output: await invokeUpdateSubscriberOperation(context, input),
			};
		case deleteSubscriberOperation.mcp.name:
			return {
				operation: deleteSubscriberOperation,
				output: await invokeDeleteSubscriberOperation(context, input),
			};
		default:
			return undefined;
	}
}
