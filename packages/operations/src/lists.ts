import type {
	ResourceCreateClaimResult,
	ResourceCreateIdempotencyStore,
	StoredResourceCreateRecord,
} from "@listmonk-ops/common";
import type { List, ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindListsCreateOperationSpec,
	bindListsDeleteOperationSpec,
	bindListsGetOperationSpec,
	bindListsListOperationSpec,
	bindListsUpdateOperationSpec,
} from "./specs";
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

/** Bounded wait for a live same-key create to finish before giving up. */
const KEYED_CREATE_PENDING_WAIT_MS = 10_000;
const KEYED_CREATE_PENDING_POLL_MS = 200;
/**
 * Wall-clock tolerance between the locally persisted claim time and
 * Listmonk's server-side `created_at` when proving a list was produced by
 * the claimed attempt.
 */
const CREATE_TIME_SKEW_MS = 60_000;

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

type SettledKeyedClaim =
	| {
			kind: "new";
			claimToken: string;
			/** Claim time of the attempt this POST belongs to. */
			claimedAt: string;
	  }
	| { kind: "replay"; record: StoredResourceCreateRecord };

/**
 * Claim a keyed create, waiting out a live concurrent same-key claim for a
 * bounded window. Conflicts (different payload, target, or resource kind)
 * and a still-in-flight claim after the wait budget surface as explicit
 * errors instead of a second POST.
 */
async function claimKeyedListCreate(
	store: ResourceCreateIdempotencyStore,
	options: { key: string; payloadHash: string; targetHash: string },
): Promise<SettledKeyedClaim> {
	const deadline = Date.now() + KEYED_CREATE_PENDING_WAIT_MS;
	while (true) {
		const claim: ResourceCreateClaimResult = await store.claim({
			key: options.key,
			payloadHash: options.payloadHash,
			targetHash: options.targetHash,
			resourceKind: "list",
		});
		if (claim.kind === "conflict") {
			if (claim.reason === "payload") {
				throw new Error(
					`Idempotency key already used by a different create request: ${options.key}`,
				);
			}
			if (claim.reason === "target") {
				throw new Error(
					`Idempotency key already used against a different Listmonk target: ${options.key}`,
				);
			}
			throw new Error(
				`Idempotency key is bound to a ${claim.existing.resourceKind} resource: ${options.key}`,
			);
		}
		if (claim.kind === "replay") {
			return { kind: "replay", record: claim.record };
		}
		if (claim.kind === "new") {
			return {
				kind: "new",
				claimToken: claim.claimToken,
				claimedAt: claim.record.createdAt,
			};
		}
		if (claim.kind === "unresolved") {
			throw new Error(
				`Idempotency key '${options.key}' has an unresolved previous attempt (status ${claim.record.status}); its create outcome cannot be determined automatically — a list can even have been renamed after creation. Inspect the Listmonk lists for the intended result, reconcile manually, and use a new idempotency key.`,
			);
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`Another create with idempotency key ${options.key} is still in flight; retry after it completes to replay its result`,
			);
		}
		await delay(KEYED_CREATE_PENDING_POLL_MS);
	}
}

async function replayRecordedList(
	client: Pick<ListmonkClient, "list">,
	record: StoredResourceCreateRecord,
): Promise<ListCreateResult> {
	try {
		const list = await getSubscriberList(
			{ client },
			{ id: Number(record.resourceId) },
		);
		return { list, created: false };
	} catch (error) {
		throw new Error(
			`Idempotency replay could not load list ${record.resourceId}: ${toErrorMessage(error)}`,
			{ cause: error },
		);
	}
}

/**
 * A name-matched list can only be the product of the requested create when
 * the server-stable enum attributes agree. `description` and `tags` are
 * excluded because Listmonk may normalize them in stored records.
 */
function matchesRequestedCreate(
	list: List,
	input: z.output<typeof createListInputSchema>,
): boolean {
	return (
		(list.type === undefined || list.type === input.type) &&
		(list.optin === undefined || list.optin === input.optin)
	);
}

/**
 * Prove from Listmonk's server-side `created_at` that the list was created
 * during the claimed attempt. Returns undefined when either timestamp is
 * absent or unparsable and the outcome is unprovable either way.
 */
function createdDuringAttempt(
	list: List,
	attemptClaimedAt: string,
): boolean | undefined {
	const listCreatedMs = list.created_at !== undefined
		? new Date(list.created_at).getTime()
		: Number.NaN;
	const claimedMs = new Date(attemptClaimedAt).getTime();
	if (Number.isNaN(listCreatedMs) || Number.isNaN(claimedMs)) {
		return undefined;
	}
	return listCreatedMs >= claimedMs - CREATE_TIME_SKEW_MS;
}

/**
 * Resolve an accepted-but-unidentified keyed create by exact list name.
 * Refuses ambiguous, attribute-mismatched, or creation-time-disproven
 * matches: this call's create definitely landed, so a same-named list the
 * request would not — or could not — have produced cannot be identified as
 * the created one, and the key must stay pending for manual reconciliation.
 */
async function resolveCreatedListByName(
	client: Pick<ListmonkClient, "list">,
	input: z.output<typeof createListInputSchema>,
	claimedAt: string,
): Promise<List | undefined> {
	const matches = await findListsByName(client, input.name, { maxMatches: 2 });
	if (matches.length > 1) {
		throw new Error(
			`Keyed list create found multiple lists named "${input.name}"; the created list is ambiguous and the idempotency key was not bound`,
		);
	}
	const match = matches[0];
	if (match === undefined) {
		return undefined;
	}
	if (!matchesRequestedCreate(match, input)) {
		throw new Error(
			`Keyed list create could not identify a list named "${input.name}" matching the requested create; the idempotency key was not bound`,
		);
	}
	const createdDuring = createdDuringAttempt(match, claimedAt);
	if (createdDuring !== undefined && !createdDuring) {
		throw new Error(
			`Keyed list create could not identify a list named "${input.name}" matching the requested create (the match predates the request); the idempotency key was not bound`,
		);
	}
	return match;
}

/**
 * Best-effort release of a definitively failed claim: a persistence failure
 * leaves the pending claim in place, which still blocks a duplicate POST
 * until staleness recovery reconciles it.
 */
async function releaseKeyedListClaim(
	store: ResourceCreateIdempotencyStore,
	options: { key: string; claimToken: string },
): Promise<void> {
	try {
		await store.release(options);
	} catch (error) {
		console.warn(
			`Failed to release resource-create idempotency claim for key '${options.key}': ${toErrorMessage(error)}`,
		);
	}
}

/**
 * Best-effort transition of an unfinished claim to unknown: the attempt is
 * over without a definitive outcome, so later retries must recover it
 * immediately instead of waiting on a live owner that will never finish.
 */
async function markKeyedClaimUnknown(
	store: ResourceCreateIdempotencyStore,
	options: { key: string; claimToken: string },
): Promise<void> {
	try {
		await store.markUnknown(options);
	} catch (error) {
		console.warn(
			`Failed to mark resource-create idempotency claim unknown for key '${options.key}': ${toErrorMessage(error)}`,
		);
	}
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

	const payloadHash = hashCreatePayload(
		JSON.stringify(canonicalListCreatePayload(input)),
	);
	const targetHash = hashCreatePayload(
		JSON.stringify([target.baseUrl, target.username]),
	);
	const claim = await claimKeyedListCreate(createIdempotencyStore, {
		key: input.idempotency_key,
		payloadHash,
		targetHash,
	});

	if (claim.kind === "replay") {
		return replayRecordedList(client, claim.record);
	}

	// claim.kind === "new" — this call owns the key from here on. An
	// unresolved previous attempt never reaches this point: the claim fails
	// fast instead, because no name-based reconciliation can prove the
	// crashed create did not land (a list can even have been renamed).

	let created: List | undefined;
	let failure: { error: Error; definitive: boolean } | undefined;
	try {
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
			const status =
				typeof response.response?.status === "number"
					? response.response.status
					: undefined;
			failure = {
				error: new Error(
					`Failed to create list: ${toErrorMessage(response.error)}`,
				),
				// A 4xx answer rejected the request outright; a 5xx or a
				// statusless error may have partially processed it.
				definitive: status !== undefined && status >= 400 && status < 500,
			};
		} else if (response.data !== undefined) {
			created = response.data;
		}
	} catch (error) {
		failure = {
			error: error instanceof Error ? error : new Error(String(error)),
			// Proven pre-dispatch failures (ECONNREFUSED, ENOTFOUND, 4xx with
			// a status) never reached Listmonk; everything else is ambiguous.
			definitive: isDefinitivePreDispatchError(error),
		};
	}

	if (failure === undefined && created === undefined) {
		// The POST was accepted with an empty body; resolve the created list
		// by name. Any failure here happened after the create was accepted,
		// so the claim must stay for reconciliation — releasing it would let
		// a retry provision a duplicate.
		try {
			created = await resolveCreatedListByName(client, input, claim.claimedAt);
		} catch (error) {
			await markKeyedClaimUnknown(createIdempotencyStore, {
				key: input.idempotency_key,
				claimToken: claim.claimToken,
			});
			throw new Error(
				`Keyed list create was accepted but the created record could not be resolved: ${toErrorMessage(error)}`,
				{ cause: error },
			);
		}
	}

	if (failure !== undefined) {
		if (failure.definitive) {
			// No list was created, so the key can be released for a fresh
			// retry. Best effort: an unreleased claim still blocks a
			// duplicate until staleness recovery reconciles it.
			await releaseKeyedListClaim(createIdempotencyStore, {
				key: input.idempotency_key,
				claimToken: claim.claimToken,
			});
			throw failure.error;
		}
		// Ambiguous failures mark the claim unknown so an automatic retry
		// cannot POST a duplicate but recovers immediately (instead of
		// waiting on a live owner that will never finish) to reconcile.
		await markKeyedClaimUnknown(createIdempotencyStore, {
			key: input.idempotency_key,
			claimToken: claim.claimToken,
		});
		throw new Error(
			`Keyed list create failed ambiguously (${toErrorMessage(failure.error)}); the request may or may not have created a list. The idempotency key is marked unknown; a retry reconciles the outcome instead of creating again.`,
			{ cause: failure.error },
		);
	}

	if (created === undefined || created.id === undefined) {
		// The POST was accepted but the created id is not yet resolvable; a
		// same-name read-back gets one more chance to bind the key.
		try {
			const resolved = await resolveCreatedListByName(
				client,
				input,
				claim.claimedAt,
			);
			if (resolved?.id !== undefined) {
				created = resolved;
			}
		} catch (error) {
			await markKeyedClaimUnknown(createIdempotencyStore, {
				key: input.idempotency_key,
				claimToken: claim.claimToken,
			});
			throw new Error(
				`Keyed list create was accepted but the created record could not be re-read: ${toErrorMessage(error)}`,
				{ cause: error },
			);
		}
	}

	if (created === undefined || created.id === undefined) {
		// Mark the claim unknown so a retry reconciles by name instead of
		// silently issuing a second POST under the same key.
		await markKeyedClaimUnknown(createIdempotencyStore, {
			key: input.idempotency_key,
			claimToken: claim.claimToken,
		});
		throw new Error(
			`List was created but its id could not be resolved; the idempotency key was not bound and is marked unknown so a retry reconciles by list name "${input.name}" instead of creating again`,
		);
	}

	const resourceId = String(created.id);
	try {
		await createIdempotencyStore.commit({
			key: input.idempotency_key,
			claimToken: claim.claimToken,
			resourceId,
		});
	} catch (error) {
		// The create is the source of truth. The claim still blocks a
		// duplicate POST; marking it unknown lets a retry recover and
		// reconcile immediately instead of waiting on this live process.
		console.warn(
			`Failed to persist resource-create idempotency record for key '${input.idempotency_key}' (created list id ${resourceId}): ${toErrorMessage(error)}`,
		);
		await markKeyedClaimUnknown(createIdempotencyStore, {
			key: input.idempotency_key,
			claimToken: claim.claimToken,
		});
	}
	return { list: created, created: true };
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
