import type { ListmonkClient, Subscriber } from "@listmonk-ops/openapi";
import {
	bindSubscriberBlocklistOperationSpec,
	bindSubscribersAddToListsOperationSpec,
	bindSubscribersCreateOperationSpec,
	bindSubscribersDeleteOperationSpec,
	bindSubscribersGetOperationSpec,
	bindSubscribersListOperationSpec,
	bindSubscribersRemoveFromListsOperationSpec,
	bindSubscribersUnblocklistOperationSpec,
	bindSubscribersImportStartOperationSpec,
	bindSubscribersImportStatusOperationSpec,
	bindSubscribersImportStopOperationSpec,
	bindSubscribersUpdateOperationSpec,
} from "./specs";
import { z } from "zod";
import {
	MAX_SUBSCRIBER_IMPORT_CSV_BYTES,
	MAX_SUBSCRIBER_IMPORT_LISTS,
} from "./subscriber-import-bound";
import {
	createResourceSafety,
	deleteResourceSafety,
	deliverySuppressionSafety,
	jsonResourceValue,
	normalizeResourceList,
	readResourceSafety,
	requireAcknowledgement,
	resourceIdSchema,
	toResourceErrorMessage,
	unwrapResourceResponse,
	updateResourceSafety,
} from "./resource-helpers";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	type BulkExecutorResult,
	executeSubscriberBulk,
} from "./subscriber-bulk";

export { isResourceMissingError } from "./resource-helpers";

export interface SubscriberOperationContext {
	client: Pick<ListmonkClient, "subscriber">;
}

/** Context for the asynchronous subscriber-import lifecycle. */
export interface SubscriberImportOperationContext {
	client: Pick<ListmonkClient, "import">;
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

const subscriberCreateOutputSchema = z.object({
	subscriber: subscriberSchema,
	created: z.boolean(),
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
	per_page: z.union([z.coerce.number().int().positive(), z.literal("all")]).default(
		20,
	),
	list_id: subscriberListIdSchema.optional(),
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
		per_page: input.per_page === "all"
			? (data.results?.length ?? 0)
			: input.per_page,
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
	// Listmonk's subscriber query parameter is a raw SQL expression; bind the
	// email as an escaped equality predicate so the lookup stays exact and
	// never degrades into a full-table scan on large installations.
	const escaped = email.replace(/'/g, "''");
	// Postgres folds unquoted identifiers case-insensitively, so LOWER(email)
	// matches the case-insensitive comparison used on the resolved records.
	const emailPredicate = `LOWER(email) = LOWER('${escaped}')`;
	const firstResponse = await client.subscriber.list({
		query: { page: 1, per_page: pageSize, query: emailPredicate },
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
			query: { page, per_page: pageSize, query: emailPredicate },
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

// Listmonk enforces unique subscriber emails, so an ambiguous-create retry
// surfaces as an "already exists" rejection. Replay only when the persisted
// subscriber matches the requested identity; a conflicting configuration
// under the same email stays an explicit error.
function isSubscriberEmailExistsError(error: unknown): boolean {
	return (
		error instanceof Error &&
		responseStatusOf(error) === 409 &&
		/e-?mail already exists/i.test(error.message)
	);
}

function responseStatusOf(error: unknown): number | undefined {
	const cause = (error as { cause?: unknown })?.cause;
	const status = (
		cause as { response?: { status?: unknown } } | undefined
	)?.response?.status;
	return typeof status === "number" ? status : undefined;
}

function canonicalJson(value: unknown): string {
	// The generated transport serializes bigint attributes as strings and
	// routes other values through JSON.stringify (honoring toJSON), so
	// canonicalize the same way before comparing a replay.
	if (typeof value === "bigint") return JSON.stringify(value.toString());
	if (
		value !== null &&
		typeof value === "object" &&
		typeof (value as { toJSON?: unknown }).toJSON === "function"
	) {
		return canonicalJson((value as { toJSON: () => unknown }).toJSON());
	}
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return JSON.stringify(value.map(canonicalJson));
	return JSON.stringify(
		Object.fromEntries(
			Object.keys(value as Record<string, unknown>)
				.sort()
				.map((key) => [
					key,
					canonicalJson((value as Record<string, unknown>)[key]),
				]),
		),
	);
}

function sameSubscriberCreateIntent(
	existing: Subscriber,
	input: z.output<typeof createSubscriberInputSchema>,
): boolean {
	// Compare every observable create effect: identity fields, list
	// membership (by uuid when the request addressed lists by uuid), and
	// the canonical attribute payload. preconfirm_subscriptions mutates
	// per-list subscription status in ways the request cannot express, so
	// a replay is only offered when it was omitted.
	if (input.preconfirm_subscriptions !== undefined) {
		return false;
	}
	// Both selectors can be supplied together and each contributes
	// memberships, so compare the union: persisted uuids when uuids were
	// requested, plus persisted ids whenever numeric ids were requested.
	const byUuid =
		input.list_uuids !== undefined
			? [...(existing.lists ?? [])]
					.map((list) => list.uuid ?? "")
					.filter(Boolean)
					.sort()
			: undefined;
	const byId =
		input.lists.length > 0 || input.list_uuids === undefined
			? [...(existing.lists ?? [])].map((list) => list.id).sort()
			: undefined;
	const requestedLists = JSON.stringify({
		byUuid,
		byId,
	});
	const expectedUuids =
		input.list_uuids !== undefined ? [...input.list_uuids].sort() : undefined;
	const expectedIds =
		input.lists.length > 0 || input.list_uuids === undefined
			? [...input.lists].sort()
			: undefined;
	const expectedLists = JSON.stringify({
		byUuid: expectedUuids,
		byId: expectedIds,
	});
	// A persisted unsubscribed membership is not the subscription the
	// request asked for, so decline the replay instead of reporting it.
	const unsubscribed =
		input.list_uuids === undefined
			? input.lists.some((listId) =>
					(existing.lists ?? []).some(
						(list) =>
							list.id === listId &&
							list.subscription_status === "unsubscribed",
					),
				)
			: input.list_uuids.some((listUuid) =>
					(existing.lists ?? []).some(
						(list) =>
							list.uuid === listUuid &&
							list.subscription_status === "unsubscribed",
					),
				);
	return (
		!unsubscribed &&
		existing.email?.toLowerCase() === input.email.toLowerCase() &&
		(existing.name ?? "") === input.name &&
		existing.status === input.status &&
		JSON.stringify(requestedLists) === JSON.stringify(expectedLists) &&
		canonicalJson(existing.attribs ?? {}) === canonicalJson(input.attribs)
	);
}

export async function createSubscriber(
	{ client }: SubscriberOperationContext,
	input: z.output<typeof createSubscriberInputSchema>,
): Promise<z.output<typeof subscriberCreateOutputSchema>> {
	let createError: Error | undefined;
	const response = await client.subscriber.create({
		body: input as SubscriberCreateBody,
	});
	if ("error" in response && response.error !== undefined) {
		createError = new Error(
			`Failed to create subscriber: ${toResourceErrorMessage(response.error)}`,
			{ cause: response },
		);
		if (!isSubscriberEmailExistsError(createError)) {
			throw createError;
		}
		const existing = await findCreatedSubscriber(client, input.email);
		if (!existing || !sameSubscriberCreateIntent(existing, input)) {
			throw createError;
		}
		return { subscriber: asSubscriber(existing), created: false };
	}
	if (response.data !== undefined) {
		return { subscriber: asSubscriber(response.data), created: true };
	}

	const created = await findCreatedSubscriber(client, input.email);
	if (!created) {
		throw new Error(
			"Subscriber was created but the created record could not be resolved",
		);
	}
	return { subscriber: asSubscriber(created), created: true };
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

const bulkOperationOptionsFields = {
	dry_run: z.boolean().default(false),
	max_items: z.coerce.number().int().positive().default(10000),
	continue_on_error: z.boolean().default(false),
};

const subscriberBulkListsInputSchema = z.object({
	subscriber_ids: z.array(resourceIdSchema).min(1),
	list_ids: z.array(resourceIdSchema).min(1),
	...bulkOperationOptionsFields,
});

// Blocklist and unblocklist share the same input shape: neither exposes an
// `action` field. blocklist always sends `action: "add"` and unblocklist
// always sends `action: "remove"` from inside the executor, so callers
// cannot accidentally unblock subscribers by passing `action: "remove"` to
// `blocklist` (or vice versa). Both operations live in the registry so the
// intent is explicit at the call site.
const subscriberBulkBlocklistInputSchema = z.object({
	subscriber_ids: z.array(resourceIdSchema).min(1),
	...bulkOperationOptionsFields,
});
const subscriberBulkUnblocklistInputSchema = subscriberBulkBlocklistInputSchema;

const bulkOperationOutputSchema = z.object({
	processed: z.number().int().nonnegative(),
	succeeded: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	errors: z.array(z.string()),
});

export type BulkOperationOutput = z.output<typeof bulkOperationOutputSchema>;

interface SubscriberBulkRunOptions {
	dry_run: boolean;
	max_items: number;
	continue_on_error: boolean;
	action: (chunk: number[]) => Promise<unknown>;
}

async function runSubscriberBulk(
	subscriberIds: readonly number[],
	options: SubscriberBulkRunOptions,
): Promise<BulkExecutorResult> {
	return executeSubscriberBulk(
		{ subscriberIds, action: options.action },
		{
			dry_run: options.dry_run,
			max_items: options.max_items,
			continue_on_error: options.continue_on_error,
		},
	);
}

/**
 * Unwrap a bulk mutation response and require a positive acknowledgement.
 * Listmonk sometimes returns `{ data: false }` without an error envelope
 * when a mutation is rejected; `unwrapResourceResponse` treats that as
 * success because `false` is a defined value. We explicitly require
 * `data === true` so the bulk executor's fail-fast and continue-on-error
 * bookkeeping stay accurate.
 */
/**
 * Add a batch of subscribers to one or more lists. Subscriber IDs are
 * chunked and each chunk is sent as a `manageLists` action: add. Respects
 * the shared bulk options (dry_run, max_items, continue_on_error).
 */
export async function addSubscribersToLists(
	ctx: SubscriberOperationContext,
	input: z.output<typeof subscriberBulkListsInputSchema>,
): Promise<BulkOperationOutput> {
	const targetListIds = input.list_ids;
	return runSubscriberBulk(input.subscriber_ids, {
		dry_run: input.dry_run,
		max_items: input.max_items,
		continue_on_error: input.continue_on_error,
		action: async (chunk) => {
			const response = await ctx.client.subscriber.manageLists({
				body: {
					action: "add",
					ids: chunk,
					target_list_ids: targetListIds,
				},
			});
			requireAcknowledgement(
				response,
				"Failed to add subscribers to lists",
			);
		},
	});
}

/**
 * Remove a batch of subscribers from one or more lists. Mirrors
 * {@link addSubscribersToLists} with `manageLists` action: remove.
 */
export async function removeSubscribersFromLists(
	ctx: SubscriberOperationContext,
	input: z.output<typeof subscriberBulkListsInputSchema>,
): Promise<BulkOperationOutput> {
	const targetListIds = input.list_ids;
	return runSubscriberBulk(input.subscriber_ids, {
		dry_run: input.dry_run,
		max_items: input.max_items,
		continue_on_error: input.continue_on_error,
		action: async (chunk) => {
			const response = await ctx.client.subscriber.manageLists({
				body: {
					action: "remove",
					ids: chunk,
					target_list_ids: targetListIds,
				},
			});
			requireAcknowledgement(
				response,
				"Failed to remove subscribers from lists",
			);
		},
	});
}

/**
 * Internal helper that runs either an `add` or `remove` blocklist action
 * over the chunked subscriber list. Both `blocklistSubscribers` and
 * `unblocklistSubscribers` call this with a fixed action so the public
 * input schemas never expose an `action` field.
 */
async function applyBlocklistAction(
	ctx: SubscriberOperationContext,
	input: z.output<typeof subscriberBulkBlocklistInputSchema>,
	action: "add" | "remove",
): Promise<BulkOperationOutput> {
	return runSubscriberBulk(input.subscriber_ids, {
		dry_run: input.dry_run,
		max_items: input.max_items,
		continue_on_error: input.continue_on_error,
		action: async (chunk) => {
			const response = await ctx.client.subscriber.manageBlocklist({
				body: { action, ids: chunk },
			});
			requireAcknowledgement(
				response,
				`Failed to ${action} subscriber blocklist entries`,
			);
		},
	});
}

/**
 * Add a batch of subscribers to the blocklist via `manageBlocklist` with
 * `action: "add"`. The action is fixed; callers cannot override it.
 * Respects the shared bulk options.
 */
export async function blocklistSubscribers(
	ctx: SubscriberOperationContext,
	input: z.output<typeof subscriberBulkBlocklistInputSchema>,
): Promise<BulkOperationOutput> {
	return applyBlocklistAction(ctx, input, "add");
}

/**
 * Remove a batch of subscribers from the blocklist via `manageBlocklist`
 * with `action: "remove"`. The action is fixed; callers cannot override
 * it. Respects the shared bulk options.
 */
export async function unblocklistSubscribers(
	ctx: SubscriberOperationContext,
	input: z.output<typeof subscriberBulkUnblocklistInputSchema>,
): Promise<BulkOperationOutput> {
	return applyBlocklistAction(ctx, input, "remove");
}

export const getSubscribersOperation = defineOperation({
	id: "subscribers.list",
	title: "List subscribers",
	description: "Get subscribers from Listmonk",
	inputSchema: subscriberListInputSchema,
	outputSchema: subscriberListOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_subscribers",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersListOperationSpec(),
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
	spec: bindSubscribersGetOperationSpec(),
	execute: getSubscriber,
});

export const createSubscriberOperation = defineOperation({
	id: "subscribers.create",
	title: "Create subscriber",
	description: "Create a subscriber in Listmonk",
	inputSchema: createSubscriberInputSchema,
	outputSchema: subscriberCreateOutputSchema,
	safety: { ...createResourceSafety, idempotentHint: true },
	mcp: {
		name: "listmonk_create_subscriber",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersCreateOperationSpec(),
	execute: createSubscriber,
});

export const updateSubscriberOperation = defineOperation({
	id: "subscribers.update",
	title: "Update subscriber",
	description: "Update a subscriber in Listmonk",
	inputSchema: updateSubscriberInputSchema,
	outputSchema: subscriberSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_update_subscriber",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersUpdateOperationSpec(),
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
	spec: bindSubscribersDeleteOperationSpec(),
	execute: deleteSubscriber,
});

export const addSubscribersToListsOperation = defineOperation({
	id: "subscribers.add-to-lists",
	title: "Add subscribers to lists",
	description:
		"Add a batch of subscribers to one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
	inputSchema: subscriberBulkListsInputSchema,
	outputSchema: bulkOperationOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_add_subscribers_to_lists",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersAddToListsOperationSpec(),
	execute: addSubscribersToLists,
});

export const removeSubscribersFromListsOperation = defineOperation({
	id: "subscribers.remove-from-lists",
	title: "Remove subscribers from lists",
	description:
		"Remove a batch of subscribers from one or more lists. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because re-adding subscribers does not guarantee their previous per-list subscription state is reconstructed.",
	inputSchema: subscriberBulkListsInputSchema,
	outputSchema: bulkOperationOutputSchema,
	safety: deliverySuppressionSafety,
	mcp: {
		name: "listmonk_remove_subscribers_from_lists",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersRemoveFromListsOperationSpec(),
	execute: removeSubscribersFromLists,
});

export const blocklistSubscribersOperation = defineOperation({
	id: "subscribers.blocklist",
	title: "Blocklist subscribers",
	description:
		"Add a batch of subscribers to the blocklist (action: add). Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error. Destructive because blocklisting suppresses mail delivery for the entire batch.",
	inputSchema: subscriberBulkBlocklistInputSchema,
	outputSchema: bulkOperationOutputSchema,
	safety: deliverySuppressionSafety,
	mcp: {
		name: "listmonk_blocklist_subscribers",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscriberBlocklistOperationSpec(),
	execute: blocklistSubscribers,
});

export const unblocklistSubscribersOperation = defineOperation({
	id: "subscribers.unblocklist",
	title: "Unblocklist subscribers",
	description:
		"Remove a batch of subscribers from the blocklist. Processes subscribers in chunks and supports dry-run, max-items cap, and continue-on-error.",
	inputSchema: subscriberBulkUnblocklistInputSchema,
	outputSchema: bulkOperationOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_unblocklist_subscribers",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersUnblocklistOperationSpec(),
	execute: unblocklistSubscribers,
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
): Promise<z.output<typeof subscriberCreateOutputSchema>> {
	const parsedInput = parseOperationInput(
		createSubscriberOperation.inputSchema,
		input,
	);
	let output: z.output<typeof subscriberCreateOutputSchema>;
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

export async function invokeAddSubscribersToListsOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<BulkOperationOutput> {
	const parsedInput = parseOperationInput(
		addSubscribersToListsOperation.inputSchema,
		input,
	);
	let output: BulkOperationOutput;
	try {
		output = await addSubscribersToLists(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			addSubscribersToListsOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		addSubscribersToListsOperation.id,
		bulkOperationOutputSchema,
		output,
	);
}

export async function invokeRemoveSubscribersFromListsOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<BulkOperationOutput> {
	const parsedInput = parseOperationInput(
		removeSubscribersFromListsOperation.inputSchema,
		input,
	);
	let output: BulkOperationOutput;
	try {
		output = await removeSubscribersFromLists(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			removeSubscribersFromListsOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		removeSubscribersFromListsOperation.id,
		bulkOperationOutputSchema,
		output,
	);
}

export async function invokeBlocklistSubscribersOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<BulkOperationOutput> {
	const parsedInput = parseOperationInput(
		blocklistSubscribersOperation.inputSchema,
		input,
	);
	let output: BulkOperationOutput;
	try {
		output = await blocklistSubscribers(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			blocklistSubscribersOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		blocklistSubscribersOperation.id,
		bulkOperationOutputSchema,
		output,
	);
}

export async function invokeUnblocklistSubscribersOperation(
	context: SubscriberOperationContext,
	input: unknown,
): Promise<BulkOperationOutput> {
	const parsedInput = parseOperationInput(
		unblocklistSubscribersOperation.inputSchema,
		input,
	);
	let output: BulkOperationOutput;
	try {
		output = await unblocklistSubscribers(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			unblocklistSubscribersOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		unblocklistSubscribersOperation.id,
		bulkOperationOutputSchema,
		output,
	);
}

const subscriberImportStartInputSchema = z
	.object({
		mode: z.enum(["subscribe", "blocklist"]),
		delim: z.string().min(1).max(1),
		// Target lists only carry meaning for subscribe-mode imports.
		lists: z
			.array(resourceIdSchema)
			.max(MAX_SUBSCRIBER_IMPORT_LISTS)
			.optional(),
		overwrite: z.boolean(),
		subscription_status: z
			.enum(["pending", "confirmed", "unsubscribed"])
			.optional(),
		// Validate the UTF-8 byte length, not UTF-16 code units, so the
		// cap bounds the wire payload the multipart File will carry.
		csv: z
			.string()
			.min(1)
			.refine(
				(value) =>
					new TextEncoder().encode(value).byteLength <=
					MAX_SUBSCRIBER_IMPORT_CSV_BYTES,
				{
					message: `CSV payload must be at most ${MAX_SUBSCRIBER_IMPORT_CSV_BYTES} bytes`,
				},
			),
	})
	.superRefine((value, ctx) => {
		if (value.mode === "subscribe" && (value.lists?.length ?? 0) < 1) {
			ctx.addIssue({
				code: "custom",
				path: ["lists"],
				message:
					"At least one list is required for subscribe-mode imports",
			});
		}
	});

const subscriberImportStatusSchema = z.looseObject({
	name: z.string().optional(),
	total: z.number().optional(),
	imported: z.number().optional(),
	status: z.string().optional(),
});

export type SubscriberImportStatus = z.output<typeof subscriberImportStatusSchema>;

/**
 * Upload the CSV and start the asynchronous import. The observed 6.2
 * endpoint takes a multipart form whose `params` field carries the JSON
 * options and whose `file` field carries the CSV; the wrapper builds
 * that form. The importer upserts rows by email, so repeating an
 * identical CSV converges — poll subscribers.import.status for progress.
 */
export async function startSubscriberImport(
	{ client }: SubscriberImportOperationContext,
	input: z.output<typeof subscriberImportStartInputSchema>,
): Promise<SubscriberImportStatus> {
	const response = await client.import.start({
		mode: input.mode,
		delim: input.delim,
		...(input.lists !== undefined && { lists: input.lists }),
		overwrite: input.overwrite,
		...(input.subscription_status !== undefined && {
			subscription_status: input.subscription_status,
		}),
		file: new File([input.csv], "import.csv", { type: "text/csv" }),
	});
	return unwrapResourceResponse(
		response,
		"Failed to start subscriber import",
	) as SubscriberImportStatus;
}

export async function readSubscriberImportStatus({
	client,
}: SubscriberImportOperationContext): Promise<SubscriberImportStatus> {
	const response = await client.import.get();
	return unwrapResourceResponse(
		response,
		"Failed to read subscriber import status",
	) as SubscriberImportStatus;
}

export async function stopSubscriberImport({
	client,
}: SubscriberImportOperationContext): Promise<SubscriberImportStatus> {
	const response = await client.import.stop();
	return unwrapResourceResponse(
		response,
		"Failed to stop subscriber import",
	) as SubscriberImportStatus;
}

export const startSubscriberImportOperation = defineOperation({
	id: "subscribers.import.start",
	title: "Start a subscriber CSV import",
	description:
		"Upload a CSV and start an asynchronous subscriber import. The importer upserts rows by email, so a repeated identical import converges; poll subscribers.import.status for progress.",
	inputSchema: subscriberImportStartInputSchema,
	outputSchema: subscriberImportStatusSchema,
	// The importer upserts by email so an identical repeat converges, but
	// the hint stays conservative: most retries will not be provably
	// identical to the first attempt.
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_start_subscriber_import",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersImportStartOperationSpec(),
	execute: startSubscriberImport,
});

export const getSubscriberImportStatusOperation = defineOperation({
	id: "subscribers.import.status",
	title: "Read subscriber import status",
	description:
		"Read the current asynchronous subscriber-import session status, including progress counters.",
	inputSchema: z.object({}),
	outputSchema: subscriberImportStatusSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_subscriber_import_status",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersImportStatusOperationSpec(),
	execute: readSubscriberImportStatus,
});

export const stopSubscriberImportOperation = defineOperation({
	id: "subscribers.import.stop",
	title: "Stop the subscriber import",
	description:
		"Send the stop signal to the running subscriber importer and read the reset session status.",
	inputSchema: z.object({}),
	outputSchema: subscriberImportStatusSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_stop_subscriber_import",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSubscribersImportStopOperationSpec(),
	execute: stopSubscriberImport,
});

export async function invokeStartSubscriberImportOperation(
	context: SubscriberImportOperationContext,
	input: unknown,
): Promise<SubscriberImportStatus> {
	const parsedInput = parseOperationInput(
		startSubscriberImportOperation.inputSchema,
		input,
	);
	let output: SubscriberImportStatus;
	try {
		output = await startSubscriberImport(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			startSubscriberImportOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		startSubscriberImportOperation.id,
		startSubscriberImportOperation.outputSchema,
		output,
	);
}

export async function invokeGetSubscriberImportStatusOperation(
	context: SubscriberImportOperationContext,
	input: unknown,
): Promise<SubscriberImportStatus> {
	const parsedInput = parseOperationInput(
		getSubscriberImportStatusOperation.inputSchema,
		input,
	);
	let output: SubscriberImportStatus;
	try {
		output = await readSubscriberImportStatus(context);
	} catch (error) {
		throw normalizeOperationExecutionError(
			getSubscriberImportStatusOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		getSubscriberImportStatusOperation.id,
		getSubscriberImportStatusOperation.outputSchema,
		output,
	);
}

export async function invokeStopSubscriberImportOperation(
	context: SubscriberImportOperationContext,
	input: unknown,
): Promise<SubscriberImportStatus> {
	const parsedInput = parseOperationInput(
		stopSubscriberImportOperation.inputSchema,
		input,
	);
	let output: SubscriberImportStatus;
	try {
		output = await stopSubscriberImport(context);
	} catch (error) {
		throw normalizeOperationExecutionError(
			stopSubscriberImportOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		stopSubscriberImportOperation.id,
		stopSubscriberImportOperation.outputSchema,
		output,
	);
}

export const subscriberOperations = [
	getSubscribersOperation,
	getSubscriberOperation,
	createSubscriberOperation,
	updateSubscriberOperation,
	deleteSubscriberOperation,
	addSubscribersToListsOperation,
	removeSubscribersFromListsOperation,
	blocklistSubscribersOperation,
	unblocklistSubscribersOperation,
	startSubscriberImportOperation,
	getSubscriberImportStatusOperation,
	stopSubscriberImportOperation,
] as const;

export const subscriberOperationCatalog = defineOperationCatalog({
	id: "subscribers",
	title: "Subscribers",
	operations: subscriberOperations,
	specMigrationExemptions: [],
});

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
	context: SubscriberOperationContext & SubscriberImportOperationContext,
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
		case addSubscribersToListsOperation.mcp.name:
			return {
				operation: addSubscribersToListsOperation,
				output: await invokeAddSubscribersToListsOperation(context, input),
			};
		case removeSubscribersFromListsOperation.mcp.name:
			return {
				operation: removeSubscribersFromListsOperation,
				output: await invokeRemoveSubscribersFromListsOperation(context, input),
			};
		case blocklistSubscribersOperation.mcp.name:
			return {
				operation: blocklistSubscribersOperation,
				output: await invokeBlocklistSubscribersOperation(context, input),
			};
		case startSubscriberImportOperation.mcp.name:
			return {
				operation: startSubscriberImportOperation,
				output: await invokeStartSubscriberImportOperation(context, input),
			};
		case getSubscriberImportStatusOperation.mcp.name:
			return {
				operation: getSubscriberImportStatusOperation,
				output: await invokeGetSubscriberImportStatusOperation(context, input),
			};
		case stopSubscriberImportOperation.mcp.name:
			return {
				operation: stopSubscriberImportOperation,
				output: await invokeStopSubscriberImportOperation(context, input),
			};
		case unblocklistSubscribersOperation.mcp.name:
			return {
				operation: unblocklistSubscribersOperation,
				output: await invokeUnblocklistSubscribersOperation(context, input),
			};
		default:
			return undefined;
	}
}
