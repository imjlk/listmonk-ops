import type { ResourceCreateIdempotencyStore } from "@listmonk-ops/common";
import type { Campaign, ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindCampaignCancelOperationSpec,
	bindCampaignGetOperationSpec,
	bindCampaignScheduleOperationSpec,
	bindCampaignStartOperationSpec,
	bindCampaignsCloneOperationSpec,
	bindCampaignsCreateOperationSpec,
	bindCampaignsDeleteOperationSpec,
	bindCampaignsListOperationSpec,
	bindCampaignsPauseOperationSpec,
	bindCampaignsStatsOperationSpec,
	bindCampaignsUpdateOperationSpec,
} from "./specs";
import { z } from "zod";
import {
	createResourceSafety,
	deleteResourceSafety,
	deliveryTransitionSafety,
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
	assertCampaignTransition,
	type CampaignLifecycleTarget,
} from "./campaign-lifecycle";
import { executeKeyedCreate } from "./keyed-create";
import { isDefinitivePreDispatchError } from "./transactional-idempotency";
import { CAMPAIGN_SEND_AT_PATTERN } from "./campaign-send-at";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

export interface CampaignOperationContext {
	client: Pick<ListmonkClient, "campaign">;
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

const campaignTypeSchema = z.enum(["regular", "optin"]);
const campaignStatusSchema = z.enum([
	"draft",
	"scheduled",
	"running",
	"paused",
	"finished",
	"cancelled",
]);
const campaignContentTypeSchema = z.enum([
	"richtext",
	"html",
	"markdown",
	"plain",
	"visual",
]);
const campaignOrderBySchema = z.enum([
	"name",
	"status",
	"created_at",
	"updated_at",
]);
const campaignOrderSchema = z.enum(["ASC", "DESC"]);

const campaignSchema = z.looseObject({
	id: z.number().int().positive().optional(),
	created_at: z.string().optional(),
	updated_at: z.string().optional(),
	uuid: z.string().optional(),
	name: z.string().optional(),
	subject: z.string().optional(),
	from_email: z.string().optional(),
	body: z.string().optional(),
	body_source: z.string().nullable().optional(),
	altbody: z.string().nullable().optional(),
	send_at: z.string().nullable().optional(),
	status: z.string().optional(),
	type: campaignTypeSchema.optional(),
	content_type: campaignContentTypeSchema.optional(),
	tags: z.array(z.string()).optional(),
	template_id: z.number().int().positive().nullable().optional(),
	messenger: z.string().optional(),
	lists: z.array(z.looseObject({})).optional(),
	archive: z.boolean().optional(),
	media: z.array(z.looseObject({})).optional(),
	// Delivery stats. Listmonk returns these on `GET /campaigns/{id}` for any
	// campaign that has started or finished sending. They are typed here so
	// lifecycle callers can read them without unsafe casts; absent on drafts.
	views: z.number().nullable().optional(),
	clicks: z.number().nullable().optional(),
	bounces: z.number().nullable().optional(),
	to_send: z.number().nullable().optional(),
	sent: z.number().nullable().optional(),
	started_at: z.string().nullable().optional(),
});

const campaignListOutputSchema = z.object({
	results: z.array(campaignSchema),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

const campaignIdInputSchema = z.object({
	id: resourceIdSchema,
});

const campaignListInputSchema = z.object({
	page: z.coerce.number().int().positive().default(1),
	per_page: z.union([z.coerce.number().int().positive(), z.literal("all")]).default(20),
	status: z
		.preprocess(
			(value) =>
				value === undefined
					? undefined
					: Array.isArray(value)
						? value
						: [value],
			z.array(campaignStatusSchema).optional(),
		)
		.optional(),
	no_body: z.boolean().optional(),
	query: z.string().trim().optional(),
	tags: z.array(z.string()).optional(),
	order: campaignOrderSchema.optional(),
	order_by: campaignOrderBySchema.optional(),
});

const campaignBodyFields = {
	name: z.string().trim().min(1),
	subject: z.string().trim().min(1),
	from_email: z.string().trim().min(1),
	body: z.string().min(1),
	// Visual-editor source. Listmonk stores this on `visual` campaigns so
	// they can be reopened in the visual builder; cloning must preserve it
	// or the clone loses its editability. Nullable to allow non-visual
	// campaigns (which have no source) to omit it.
	body_source: z.string().nullable().optional(),
	altbody: z.string().optional(),
	type: campaignTypeSchema.default("regular"),
	template_id: resourceIdSchema.nullable(),
	lists: z.array(resourceIdSchema).min(1),
	tags: z.array(z.string()).default([]),
	messenger: z.string().trim().min(1).default("email"),
	content_type: campaignContentTypeSchema.default("html"),
	send_at: z.string().nullable().optional(),
	headers: z.array(z.record(z.string(), z.string())).optional(),
	attribs: z.record(z.string(), z.unknown()).optional(),
	archive: z.boolean().optional(),
	archive_slug: z.string().nullable().optional(),
	archive_template_id: resourceIdSchema.nullable().optional(),
	archive_meta: z.record(z.string(), z.unknown()).optional(),
	media: z.array(resourceIdSchema).optional(),
	subscribers: z.array(z.string()).optional(),
};

const idempotencyKeySchema = z
	.string()
	.trim()
	.min(1)
	.max(200)
	.optional()
	.describe(
		"Caller-scoped create key; an identical retry with the same key replays the originally created campaign instead of creating a duplicate",
	);

const createCampaignInputSchema = z.object({
	...campaignBodyFields,
	idempotency_key: idempotencyKeySchema,
});

const campaignCreateOutputSchema = z.object({
	campaign: campaignSchema,
	created: z.boolean(),
});

const updateCampaignInputSchema = z
	.object({
		id: resourceIdSchema,
		name: campaignBodyFields.name.optional(),
		subject: campaignBodyFields.subject.optional(),
		from_email: campaignBodyFields.from_email.optional(),
		body: campaignBodyFields.body.optional(),
		body_source: campaignBodyFields.body_source.optional(),
		altbody: z.string().optional(),
		type: campaignTypeSchema.optional(),
		template_id: resourceIdSchema.nullable().optional(),
		lists: z.array(resourceIdSchema).min(1).optional(),
		tags: z.array(z.string()).optional(),
		messenger: z.string().trim().min(1).optional(),
		content_type: campaignContentTypeSchema.optional(),
		send_at: z.string().nullable().optional(),
		headers: z.array(z.record(z.string(), z.string())).optional(),
		attribs: z.record(z.string(), z.unknown()).optional(),
		archive: z.boolean().optional(),
		archive_slug: z.string().nullable().optional(),
		archive_template_id: resourceIdSchema.nullable().optional(),
		archive_meta: z.record(z.string(), z.unknown()).optional(),
		media: z.array(resourceIdSchema).optional(),
		subscribers: z.array(z.string()).optional(),
	})
	.refine(
		({ id: _id, ...changes }) =>
			Object.values(changes).some((value) => value !== undefined),
		{
			message: "At least one campaign field must be provided for update",
			path: ["id"],
		},
	);

const deleteCampaignOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

export type CampaignListPage = z.output<typeof campaignListOutputSchema>;

type CampaignCreateBody = NonNullable<
	Parameters<ListmonkClient["campaign"]["create"]>[0]["body"]
>;
type CampaignUpdateBody = NonNullable<
	Parameters<ListmonkClient["campaign"]["update"]>[0]["body"]
>;
type CampaignListOptions = Parameters<
	ListmonkClient["campaign"]["list"]
>[0];

function asCampaign(value: Campaign): z.output<typeof campaignSchema> {
	return value as z.output<typeof campaignSchema>;
}

export async function listCampaigns(
	{ client }: CampaignOperationContext,
	input: z.output<typeof campaignListInputSchema>,
): Promise<CampaignListPage> {
	const query: Record<string, unknown> = {
		page: input.page,
		per_page: input.per_page,
	};
	if (input.status) query.status = input.status;
	if (input.no_body !== undefined) query.no_body = input.no_body;
	if (input.query) query.query = input.query;
	if (input.tags) query.tags = input.tags;
	if (input.order) query.order = input.order;
	if (input.order_by) query.order_by = input.order_by;

	const response = await client.campaign.list({
		query,
	} as CampaignListOptions);
	const data = unwrapResourceResponse(response, "Failed to fetch campaigns");
	return normalizeResourceList(data, {
		page: input.page,
		per_page: input.per_page === "all"
			? (data.results?.length ?? 0)
			: input.per_page,
	});
}

export async function getCampaign(
	{ client }: CampaignOperationContext,
	input: z.output<typeof campaignIdInputSchema> & { no_body?: boolean },
): Promise<z.output<typeof campaignSchema>> {
	const response = await client.campaign.getById({
		path: { id: input.id },
		...(input.no_body === undefined ? {} : { query: { no_body: input.no_body } }),
	});
	return asCampaign(
		unwrapResourceResponse(response, "Failed to fetch campaign"),
	);
}

/**
 * Iterate every page of campaigns and yield each result to `visitor`.
 * Stops early when `visitor` returns `true`. Centralises the pagination
 * logic shared by {@link findCreatedCampaign},
 * {@link collectCampaignIdsByName}, and {@link findCreatedCampaignNotInSet}
 * so the page-size, error message, and page-count arithmetic live in one
 * place.
 */
async function scanCampaignPages(
	client: Pick<ListmonkClient, "campaign">,
	visitor: (campaign: Campaign) => boolean,
	errorContext = "Failed to resolve created campaign",
): Promise<void> {
	const pageSize = 100;
	const firstResponse = await client.campaign.list({
		query: { page: 1, per_page: pageSize },
	});
	const firstPage = unwrapResourceResponse(firstResponse, errorContext);
	for (const campaign of firstPage.results ?? []) {
		if (visitor(campaign)) return;
	}
	const pageCount = Math.max(1, Math.ceil((firstPage.total ?? 0) / pageSize));
	for (let page = 2; page <= pageCount; page += 1) {
		const response = await client.campaign.list({
			query: { page, per_page: pageSize },
		});
		const pageData = unwrapResourceResponse(response, errorContext);
		for (const campaign of pageData.results ?? []) {
			if (visitor(campaign)) return;
		}
	}
}

/**
 * Scan campaign pages for the first campaign whose name matches `name`.
 * Used by createCampaign/cloneCampaign to resolve a record when Listmonk
 * accepts the create but returns no body.
 */
async function findCreatedCampaign(
	client: Pick<ListmonkClient, "campaign">,
	name: string,
): Promise<Campaign | undefined> {
	let found: Campaign | undefined;
	await scanCampaignPages(client, (campaign) => {
		if (campaign.name === name) {
			found = campaign;
			return true;
		}
		return false;
	});
	return found;
}

/**
 * Collect the ids of every campaign whose name matches `name`. Used by
 * cloneCampaign to snapshot pre-existing same-name campaigns before the
 * create call, so the post-create fallback can identify the new record as
 * "a campaign with this name whose id was not in the snapshot".
 */
async function collectCampaignIdsByName(
	client: Pick<ListmonkClient, "campaign">,
	name: string,
): Promise<Set<number>> {
	const ids = new Set<number>();
	await scanCampaignPages(
		client,
		(campaign) => {
			if (campaign.name === name && typeof campaign.id === "number") {
				ids.add(campaign.id);
			}
			return false;
		},
		"Failed to snapshot existing campaigns before clone",
	);
	return ids;
}

/**
 * Scan campaign pages for the first campaign whose name matches `name` and
 * whose id is NOT in `excludeIds`. Used by cloneCampaign to resolve the
 * newly created record when Listmonk returns no body, by excluding every
 * same-name campaign that existed before the create.
 */
async function findCreatedCampaignNotInSet(
	client: Pick<ListmonkClient, "campaign">,
	name: string,
	excludeIds: Set<number>,
): Promise<Campaign | undefined> {
	const candidates: Campaign[] = [];
	await scanCampaignPages(client, (campaign) => {
		// Collect ALL same-name campaigns not in the pre-create snapshot.
		// If exactly one candidate exists we can return it; if there are
		// zero or more than one the result is ambiguous (e.g. concurrent
		// clones with the same name) and the caller must resolve manually.
		if (
			campaign.name === name &&
			typeof campaign.id === "number" &&
			!excludeIds.has(campaign.id)
		) {
			candidates.push(campaign);
		}
		return false;
	});
	if (candidates.length === 1) return candidates[0];
	return undefined;
}

/**
 * Correlate an accepted keyed create that came back without a usable id to
 * the campaign it produced. A name match is never proof — names are not
 * unique and another caller may have created a same-named campaign — so
 * binding is authorized only by immutable identity: the created record's
 * `uuid` from the create response matching exactly one campaign.
 */
async function findCampaignByUuid(
	client: Pick<ListmonkClient, "campaign">,
	createdUuid: string,
): Promise<Campaign | undefined> {
	let found: Campaign | undefined;
	await scanCampaignPages(client, (campaign) => {
		if (campaign.uuid === createdUuid && campaign.id !== undefined) {
			found = campaign;
			return true;
		}
		return false;
	});
	return found;
}

function canonicalCampaignCreatePayload(
	input: z.output<typeof createCampaignInputSchema>,
): Record<string, unknown> {
	return {
		name: input.name,
		subject: input.subject,
		from_email: input.from_email,
		body: input.body,
		body_source: input.body_source ?? null,
		altbody: input.altbody ?? "",
		type: input.type,
		template_id: input.template_id,
		lists: [...input.lists].sort((a, b) => a - b),
		tags: [...input.tags].sort(),
		messenger: input.messenger,
		content_type: input.content_type,
		send_at: input.send_at ?? null,
		// Array order is preserved — the contract accepts an ordered array
		// and does not declare header order insignificant — while each
		// entry's keys are canonicalized by the executor's recursive sort.
		headers: input.headers ?? [],
		attribs: input.attribs ?? {},
		archive: input.archive ?? false,
		archive_slug: input.archive_slug ?? null,
		archive_template_id: input.archive_template_id ?? null,
		archive_meta: input.archive_meta ?? {},
		media: [...(input.media ?? [])].sort((a, b) => a - b),
		subscribers: [...(input.subscribers ?? [])].sort(),
	};
}

export interface CampaignCreateResult {
	campaign: z.output<typeof campaignSchema>;
	created: boolean;
}

async function createCampaignUnkeyed(
	client: Pick<ListmonkClient, "campaign">,
	body: CampaignCreateBody,
	name: string,
): Promise<CampaignCreateResult> {
	const response = await client.campaign.create({ body });
	if ("error" in response && response.error !== undefined) {
		throw new Error(
			`Failed to create campaign: ${toResourceErrorMessage(response.error)}`,
		);
	}
	if (response.data !== undefined) {
		return { campaign: asCampaign(response.data), created: true };
	}

	const created = await findCreatedCampaign(client, name);
	if (!created) {
		throw new Error(
			"Campaign was created but the created record could not be resolved",
		);
	}
	return { campaign: asCampaign(created), created: true };
}

export async function createCampaign(
	{
		client,
		createIdempotencyStore,
		hashCreatePayload,
		target,
	}: CampaignOperationContext,
	input: z.output<typeof createCampaignInputSchema>,
): Promise<CampaignCreateResult> {
	const { idempotency_key, ...bodyFields } = input;
	const body = bodyFields as CampaignCreateBody;
	if (idempotency_key === undefined) {
		return createCampaignUnkeyed(client, body, input.name);
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

	const result = await executeKeyedCreate<Campaign>({
		store: createIdempotencyStore,
		hashCreatePayload,
		target: { baseUrl: target.baseUrl, username: target.username },
		key: idempotency_key,
		resourceKind: "campaign",
		resourceLabel: "campaign",
		canonicalPayload: canonicalCampaignCreatePayload(input),
		resourceIdOf: (campaign) =>
			campaign.id !== undefined ? String(campaign.id) : undefined,
		describeResource: (campaign) =>
			`id ${String(campaign.id ?? campaign.name ?? "?")}`,
		replay: async (resourceId) => {
			const response = await client.campaign.getById({
				path: { id: Number(resourceId) },
			});
			try {
				return unwrapResourceResponse(
					response,
					`Failed to replay campaign ${resourceId}`,
				);
			} catch (error) {
				throw new Error(
					`Idempotency replay could not load campaign ${resourceId}: ${toResourceErrorMessage(error)}`,
					{ cause: error },
				);
			}
		},
		issue: async () => {
			let response: Awaited<ReturnType<typeof client.campaign.create>>;
			try {
				response = await client.campaign.create({ body });
			} catch (error) {
				return {
					failure: {
						error,
						// Proven pre-dispatch failures never reached Listmonk;
						// everything else is ambiguous.
						definitive: isDefinitivePreDispatchError(error),
					},
				};
			}
			if ("error" in response && response.error !== undefined) {
				const status =
					typeof response.response?.status === "number"
						? response.response.status
						: undefined;
				return {
					failure: {
						error: new Error(
							`Failed to create campaign: ${toResourceErrorMessage(response.error)}`,
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
			// record's uuid, when the response supplied one.
			if (response.data?.uuid !== undefined) {
				try {
					const correlated = await findCampaignByUuid(
						client,
						response.data.uuid,
					);
					if (correlated !== undefined) {
						return { resource: correlated };
					}
				} catch (error) {
					return {
						failure: {
							error: new Error(
								`Keyed campaign create was accepted but the created record could not be re-read: ${toResourceErrorMessage(error)}`,
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
	return { campaign: asCampaign(result.resource), created: result.created };
}

export async function updateCampaign(
	{ client }: CampaignOperationContext,
	input: z.output<typeof updateCampaignInputSchema>,
): Promise<z.output<typeof campaignSchema>> {
	const { id, ...body } = input;
	const response = await client.campaign.update({
		path: { id },
		body: body as CampaignUpdateBody,
	});
	return asCampaign(
		unwrapResourceResponse(response, "Failed to update campaign"),
	);
}

export async function deleteCampaign(
	{ client }: CampaignOperationContext,
	input: z.output<typeof campaignIdInputSchema>,
): Promise<z.output<typeof deleteCampaignOutputSchema>> {
	const response = await client.campaign.delete({ path: { id: input.id } });
	return {
		id: input.id,
		deleted: unwrapResourceResponse(response, "Failed to delete campaign"),
	};
}

const scheduleCampaignInputSchema = z
	.object({
		id: resourceIdSchema,
		// Listmonk stores send_at verbatim and uses it when the campaign
		// moves into `scheduled` status. Listmonk accepts ISO 8601 (e.g.
		// `2026-08-01T09:00:00Z`) and its own `YYYY-MM-DD HH:MM:SS` form.
		// We reject obvious garbage up front because a malformed value only
		// fails at the second step (status transition), after `send_at` has
		// already been written — leaving the campaign in a partial state.
		send_at: z
			.string()
			.trim()
			.regex(
				CAMPAIGN_SEND_AT_PATTERN,
				"send_at must be an ISO 8601 timestamp (e.g. '2026-08-01T09:00:00Z') or a Listmonk-compatible 'YYYY-MM-DD HH:MM:SS' string",
			)
			.describe("ISO 8601 (or Listmonk-compatible) scheduled send timestamp"),
		expected_updated_at: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe(
				"Campaign updated_at observed by the preflight that approved this send",
			),
	});

const campaignLifecycleInputSchema = z.object({
	id: resourceIdSchema,
	expected_updated_at: z
		.string()
		.trim()
		.min(1)
		.optional()
		.describe(
			"Campaign updated_at observed by the preflight that approved this transition",
		),
});

const cloneCampaignInputSchema = z.object({
	id: resourceIdSchema,
	idempotency_key: idempotencyKeySchema.describe(
		"Caller-scoped clone key; an identical retry with the same key replays the originally cloned campaign instead of cloning again",
	),
	name: z
		.string()
		.trim()
		.min(1)
		.describe("Name to assign to the cloned campaign"),
});

const campaignStatsInputSchema = z.object({
	id: resourceIdSchema,
});

const campaignStatsOutputSchema = z.object({
	id: z.number().int().positive(),
	status: z.string().optional(),
	views: z.number().nullable().optional(),
	clicks: z.number().nullable().optional(),
	bounces: z.number().nullable().optional(),
	to_send: z.number().nullable().optional(),
	sent: z.number().nullable().optional(),
	started_at: z.string().nullable().optional(),
});

const campaignLifecycleOutputSchema = z.object({
	id: z.number().int().positive(),
	status: z.string(),
});

export type CampaignStatsOutput = z.output<typeof campaignStatsOutputSchema>;
export type CampaignLifecycleOutput = z.output<
	typeof campaignLifecycleOutputSchema
>;

/**
 * Load the current campaign and assert that the requested transition is
 * allowed. When the campaign is already in the target status, the loader
 * returns it as a successful idempotent match (no API write needed),
 * aligning with the idempotentHint in the safety metadata and supporting
 * safe retries after timeouts.
 *
 * Returns the campaign's `send_at` so `scheduleCampaign` can detect
 * whether a reschedule is needed without a redundant `getById` call.
 */
async function loadCampaignForTransitionForTarget(
	client: Pick<ListmonkClient, "campaign">,
	id: number,
	target: CampaignLifecycleTarget,
): Promise<{
	id: number;
	status: string;
	send_at: string | null | undefined;
	updated_at: string | undefined;
}> {
	const response = await client.campaign.getById({ path: { id } });
	const campaign = asCampaign(
		unwrapResourceResponse(response, "Failed to load campaign for transition"),
	);
	const currentStatus = campaign.status ?? "<unknown>";
	// Allow same-status as idempotent no-op
	if (currentStatus !== target) {
		assertCampaignTransition(currentStatus, target);
	}
	return {
		id,
		status: currentStatus,
		send_at: campaign.send_at,
		updated_at: campaign.updated_at,
	};
}

function assertExpectedCampaignRevision(
	id: number,
	actualUpdatedAt: string | undefined,
	expectedUpdatedAt: string | undefined,
): void {
	// This comparison narrows the race window after inspection; it is not an
	// atomic lock because Listmonk's following status write has no ETag-style
	// conditional request.
	if (expectedUpdatedAt === undefined) return;
	if (actualUpdatedAt !== expectedUpdatedAt) {
		throw new Error(
			`Campaign ${id} changed after preflight (expected updated_at ${expectedUpdatedAt}, current ${actualUpdatedAt ?? "<missing>"}); inspect and preflight the campaign again`,
		);
	}
}

const CAMPAIGN_LIFECYCLE_VERBS: Readonly<Record<CampaignLifecycleTarget, string>> = {
	scheduled: "schedule",
	running: "start",
	paused: "pause",
	cancelled: "cancel",
};

async function transitionCampaign(
	ctx: CampaignOperationContext,
	input: z.output<typeof campaignLifecycleInputSchema>,
	target: CampaignLifecycleTarget,
): Promise<{ id: number; status: string }> {
	// loadCampaignForTransitionForTarget reads the current campaign and asserts the
	// transition is legal. When the campaign is already in the target
	// status, treat it as a successful no-op (idempotent) instead of
	// rejecting it — this aligns with the idempotentHint in the safety
	// metadata and allows safe client retries after timeouts.
	const loaded = await loadCampaignForTransitionForTarget(
		ctx.client,
		input.id,
		target,
	);
	if (loaded.status === target) {
		return { id: input.id, status: target };
	}
	assertExpectedCampaignRevision(
		input.id,
		loaded.updated_at,
		input.expected_updated_at,
	);
	const response = await ctx.client.campaign.updateStatus({
		path: { id: input.id },
		body: { status: target },
	});
	const verb = CAMPAIGN_LIFECYCLE_VERBS[target] ?? target;
	requireAcknowledgement(response, `Failed to ${verb} campaign ${input.id}`);
	return { id: input.id, status: target };
}

export async function scheduleCampaign(
	ctx: CampaignOperationContext,
	input: z.output<typeof scheduleCampaignInputSchema>,
): Promise<z.output<typeof campaignLifecycleOutputSchema>> {
	// Scheduling needs `send_at` set before the status transition, otherwise
	// Listmonk rejects `scheduled` as premature. Update first, then
	// transition.
	//
	// We intentionally do NOT auto-reset `send_at` on transition failure.
	// The transition step can fail for ambiguous reasons (timeouts, 5xx)
	// where Listmonk may actually have applied the new status, and a blind
	// compensating update could corrupt a campaign that already entered the
	// scheduled state. Instead we surface a distinct error that tells the
	// operator exactly what partial state the campaign is in and let them
	// decide how to reconcile it (re-run schedule, or start, or update
	// send_at back to null explicitly).
	const loaded = await loadCampaignForTransitionForTarget(
		ctx.client,
		input.id,
		"scheduled",
	);
	// Exact target-state retries are successful no-ops even when the original
	// response was lost and Listmonk advanced updated_at. The revision guard
	// still runs before every new mutation or re-schedule.
	if (loaded.status === "scheduled" && loaded.send_at === input.send_at) {
		return { id: input.id, status: "scheduled" };
	}
	assertExpectedCampaignRevision(
		input.id,
		loaded.updated_at,
		input.expected_updated_at,
	);
	// When the campaign is already scheduled with a different send_at,
	// only the update call is needed — the status is already "scheduled"
	// and calling updateStatus(scheduled→scheduled) would be rejected by
	// the server. Only call updateStatus when transitioning from a
	// non-scheduled status (e.g. draft).
	const updateResponse = await ctx.client.campaign.update({
		path: { id: input.id },
		body: { send_at: input.send_at } as CampaignUpdateBody,
	});
	asCampaign(
		unwrapResourceResponse(updateResponse, "Failed to set campaign send_at"),
	);
	if (loaded.status === "scheduled") {
		// Re-scheduling an already-scheduled campaign: send_at was updated
		// above, no status transition needed.
		return { id: input.id, status: "scheduled" };
	}
	try {
		const statusResponse = await ctx.client.campaign.updateStatus({
			path: { id: input.id },
			body: { status: "scheduled" },
		});
		requireAcknowledgement(
			statusResponse,
			`Failed to schedule campaign ${input.id}`,
		);
	} catch (error) {
		// Note: we deliberately do not interpolate the underlying error
		// message into the user-facing string. The original error is
		// attached as `cause` so callers with structured logging can still
		// inspect it; the user-facing message stays generic to avoid
		// leaking Listmonk transport details.
		throw new Error(
			`Campaign ${input.id} send_at was updated to ${input.send_at} but the status transition to scheduled failed. The campaign may be left with send_at set and the prior status — verify with 'campaigns get' before retrying.`,
			{ cause: error },
		);
	}
	return { id: input.id, status: "scheduled" };
}

/**
 * Transition a campaign into the `running` status. Reads the current
 * campaign first and rejects the transition if the state machine does not
 * permit it. Returns the campaign id and the new status.
 */
export async function startCampaign(
	ctx: CampaignOperationContext,
	input: z.output<typeof campaignLifecycleInputSchema>,
): Promise<z.output<typeof campaignLifecycleOutputSchema>> {
	return transitionCampaign(ctx, input, "running");
}

/**
 * Transition a campaign into the `paused` status. Reads the current
 * campaign first and rejects the transition if the state machine does not
 * permit it. Returns the campaign id and the new status.
 */
export async function pauseCampaign(
	ctx: CampaignOperationContext,
	input: z.output<typeof campaignLifecycleInputSchema>,
): Promise<z.output<typeof campaignLifecycleOutputSchema>> {
	return transitionCampaign(ctx, input, "paused");
}

/**
 * Transition a campaign into the terminal `cancelled` status. Reads the
 * current campaign first and rejects the transition if the state machine
 * does not permit it. Cancelled campaigns cannot transition further.
 */
export async function cancelCampaign(
	ctx: CampaignOperationContext,
	input: z.output<typeof campaignLifecycleInputSchema>,
): Promise<z.output<typeof campaignLifecycleOutputSchema>> {
	return transitionCampaign(ctx, input, "cancelled");
}

export async function cloneCampaign(
	ctx: CampaignOperationContext,
	input: z.output<typeof cloneCampaignInputSchema>,
): Promise<CampaignCreateResult> {
	if (input.idempotency_key === undefined) {
		return cloneCampaignUnkeyed(ctx, input);
	}
	const { createIdempotencyStore, hashCreatePayload, target } = ctx;
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

	const result = await executeKeyedCreate<Campaign>({
		store: createIdempotencyStore,
		hashCreatePayload,
		target: { baseUrl: target.baseUrl, username: target.username },
		key: input.idempotency_key,
		resourceKind: "campaign",
		resourceLabel: "campaign clone",
		// The clone is identified by its source campaign and target name;
		// the derived create body follows from them.
		canonicalPayload: { source_id: input.id, name: input.name },
		resourceIdOf: (campaign) =>
			campaign.id !== undefined ? String(campaign.id) : undefined,
		describeResource: (campaign) =>
			`id ${String(campaign.id ?? campaign.name ?? "?")}`,
		replay: async (resourceId) => {
			const response = await ctx.client.campaign.getById({
				path: { id: Number(resourceId) },
			});
			try {
				return unwrapResourceResponse(
					response,
					`Failed to replay campaign ${resourceId}`,
				);
			} catch (error) {
				throw new Error(
					`Idempotency replay could not load campaign ${resourceId}: ${toResourceErrorMessage(error)}`,
					{ cause: error },
				);
			}
		},
		issue: async () => {
			const issued = await issueCloneCreate(ctx.client, input);
			if (issued.campaign !== undefined) {
				return { resource: issued.campaign };
			}
			return { failure: issued.failure };
		},
	});
	return { campaign: asCampaign(result.resource), created: result.created };
}

interface CloneIssueOutcome {
	campaign?: Campaign;
	failure?: { error: unknown; definitive: boolean };
}

/**
 * Build the create body for a clone from its source campaign. Shared by
 * the keyed and unkeyed paths; throws on load/parse failures.
 */
async function buildCloneCreateBody(
	client: Pick<ListmonkClient, "campaign">,
	input: { id: number; name: string },
): Promise<CampaignCreateBody> {
	const sourceResponse = await client.campaign.getById({
		path: { id: input.id },
	});
	const source = asCampaign(
		unwrapResourceResponse(
			sourceResponse,
			`Failed to load campaign ${input.id} for clone`,
		),
	);
	const sourceLists = (source.lists ?? []).map((entry, index) => {
		const listId = (entry as { id?: unknown }).id;
		if (typeof listId !== "number" || !Number.isFinite(listId)) {
			throw new Error(
				`Campaign ${input.id} cannot be cloned: list entry at index ${index} is missing a numeric id`,
			);
		}
		return listId;
	});
	const sourceMediaIds = (source.media ?? []).map((entry, index) => {
		const mediaId = (entry as { id?: unknown }).id;
		if (typeof mediaId !== "number" || !Number.isFinite(mediaId)) {
			throw new Error(
				`Campaign ${input.id} cannot be cloned: media entry at index ${index} is missing a numeric id`,
			);
		}
		return mediaId;
	});
	return parseOperationInput(createCampaignInputSchema, {
		name: input.name,
		subject: source.subject,
		from_email: source.from_email,
		body: source.body,
		body_source: source.body_source ?? undefined,
		altbody: source.altbody ?? undefined,
		type: source.type,
		content_type: source.content_type,
		messenger: source.messenger,
		tags: source.tags,
		template_id: source.template_id ?? null,
		lists: sourceLists,
		headers: source.headers,
		attribs: source.attribs,
		archive: source.archive,
		archive_slug: source.archive_slug ?? undefined,
		archive_template_id: source.archive_template_id ?? undefined,
		archive_meta: source.archive_meta,
		media: sourceMediaIds,
		send_at: null,
	}) as CampaignCreateBody;
}

/**
 * Perform the clone POST and classify its outcome for the keyed executor:
 * bind through the created record's id, correlate an id-less record
 * through its immutable uuid, and otherwise leave the key unbound — the
 * pre-existing name-snapshot fallback is deliberately NOT used for keyed
 * clones, because it cannot prove ownership.
 */
async function issueCloneCreate(
	client: Pick<ListmonkClient, "campaign">,
	input: z.output<typeof cloneCampaignInputSchema>,
): Promise<CloneIssueOutcome> {
	let body: CampaignCreateBody;
	try {
		body = await buildCloneCreateBody(client, input);
	} catch (error) {
		// Building the body only reads and validates the source campaign —
		// no create has been issued — so the claim can be released for a
		// fresh retry regardless of why the preparation failed.
		return { failure: { error, definitive: true } };
	}
	let createResponse: Awaited<ReturnType<typeof client.campaign.create>>;
	try {
		createResponse = await client.campaign.create({ body });
	} catch (error) {
		return {
			failure: { error, definitive: isDefinitivePreDispatchError(error) },
		};
	}
	if ("error" in createResponse && createResponse.error !== undefined) {
		const status =
			typeof createResponse.response?.status === "number"
				? createResponse.response.status
				: undefined;
		return {
			failure: {
				error: new Error(
					`Failed to clone campaign: ${toResourceErrorMessage(createResponse.error)}`,
				),
				definitive: status !== undefined && status >= 400 && status < 500,
			},
		};
	}
	if (createResponse.data?.id !== undefined) {
		return { campaign: createResponse.data };
	}
	if (createResponse.data?.uuid !== undefined) {
		try {
			const correlated = await findCampaignByUuid(
				client,
				createResponse.data.uuid,
			);
			if (correlated !== undefined) {
				return { campaign: correlated };
			}
		} catch (error) {
			return {
				failure: {
					error: new Error(
						`Keyed campaign clone was accepted but the cloned record could not be re-read: ${toResourceErrorMessage(error)}`,
						{ cause: error },
					),
					definitive: false,
				},
			};
		}
	}
	return {};
}

async function cloneCampaignUnkeyed(
	ctx: CampaignOperationContext,
	input: z.output<typeof cloneCampaignInputSchema>,
): Promise<CampaignCreateResult> {
	// Snapshot the IDs of campaigns that already share the clone's name
	// BEFORE we create the clone. Names are not unique, so after the create
	// the only reliable way to identify the new record (when Listmonk
	// returns no body) is "a campaign with this name whose id was not in
	// the pre-create snapshot".
	const preExistingIds = await collectCampaignIdsByName(ctx.client, input.name);
	const body = await buildCloneCreateBody(ctx.client, input);
	const createResponse = await ctx.client.campaign.create({ body });
	if ("error" in createResponse && createResponse.error !== undefined) {
		throw new Error(
			`Failed to clone campaign: ${toResourceErrorMessage(createResponse.error)}`,
		);
	}
	if (createResponse.data !== undefined) {
		return { campaign: asCampaign(createResponse.data), created: true };
	}
	// Listmonk occasionally accepts the create but returns no body. The
	// clone is identifiable as the campaign with this name whose id was
	// not in the pre-create snapshot.
	const candidate = await findCreatedCampaignNotInSet(
		ctx.client,
		input.name,
		preExistingIds,
	);
	if (!candidate) {
		throw new Error(
			"Campaign was cloned but the created record could not be resolved unambiguously. Run `campaigns list --query` to locate it.",
		);
	}
	return { campaign: asCampaign(candidate), created: true };
}

/**
 * Read delivery stats (views, clicks, bounces, to_send, sent, started_at)
 * for a campaign by id. Reads the full campaign object via `getById` and
 * extracts the stats fields; returns null for any field Listmonk left
 * unset.
 */
export async function getCampaignStats(
	ctx: CampaignOperationContext,
	input: z.output<typeof campaignStatsInputSchema>,
): Promise<z.output<typeof campaignStatsOutputSchema>> {
	const response = await ctx.client.campaign.getById({
		path: { id: input.id },
	});
	const campaign = asCampaign(
		unwrapResourceResponse(
			response,
			`Failed to load campaign ${input.id} for stats`,
		),
	);
	return {
		id: input.id,
		status: campaign.status,
		views: campaign.views ?? null,
		clicks: campaign.clicks ?? null,
		bounces: campaign.bounces ?? null,
		to_send: campaign.to_send ?? null,
		sent: campaign.sent ?? null,
		started_at: campaign.started_at ?? null,
	};
}

export const getCampaignsOperation = defineOperation({
	id: "campaigns.list",
	title: "List campaigns",
	description: "Get campaigns from Listmonk",
	inputSchema: campaignListInputSchema,
	outputSchema: campaignListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_campaigns", legacySuccessText: jsonResourceValue },
	spec: bindCampaignsListOperationSpec(),
	execute: listCampaigns,
});

export const getCampaignOperation = defineOperation({
	id: "campaigns.get",
	title: "Get campaign",
	description: "Get a campaign by ID",
	inputSchema: campaignIdInputSchema.extend({ no_body: z.boolean().optional() }),
	outputSchema: campaignSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_campaign", legacySuccessText: jsonResourceValue },
	spec: bindCampaignGetOperationSpec(),
	execute: getCampaign,
});

export const createCampaignOperation = defineOperation({
	id: "campaigns.create",
	title: "Create campaign",
	description: "Create a campaign in Listmonk",
	inputSchema: createCampaignInputSchema,
	outputSchema: campaignCreateOutputSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_create_campaign",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignsCreateOperationSpec(),
	execute: createCampaign,
});

export const updateCampaignOperation = defineOperation({
	id: "campaigns.update",
	title: "Update campaign",
	description: "Update a campaign in Listmonk",
	inputSchema: updateCampaignInputSchema,
	outputSchema: campaignSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_update_campaign",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignsUpdateOperationSpec(),
	execute: updateCampaign,
});

export const deleteCampaignOperation = defineOperation({
	id: "campaigns.delete",
	title: "Delete campaign",
	description: "Delete a campaign from Listmonk",
	inputSchema: campaignIdInputSchema,
	outputSchema: deleteCampaignOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_delete_campaign",
		legacySuccessText: "Campaign deleted successfully",
	},
	spec: bindCampaignsDeleteOperationSpec(),
	execute: deleteCampaign,
});

export const scheduleCampaignOperation = defineOperation({
	id: "campaigns.schedule",
	title: "Schedule campaign",
	description:
		"Schedule a campaign to send at a specific time. Validates the current status allows the transition. Destructive because a scheduled campaign will begin mass delivery at the configured time.",
	inputSchema: scheduleCampaignInputSchema,
	outputSchema: campaignLifecycleOutputSchema,
	safety: deliveryTransitionSafety,
	mcp: {
		name: "listmonk_schedule_campaign",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignScheduleOperationSpec(),
	execute: scheduleCampaign,
});

export const startCampaignOperation = defineOperation({
	id: "campaigns.start",
	title: "Start campaign",
	description:
		"Transition a campaign into the running status. Validates the current status allows the transition. Destructive because this begins mass delivery immediately.",
	inputSchema: campaignLifecycleInputSchema,
	outputSchema: campaignLifecycleOutputSchema,
	safety: deliveryTransitionSafety,
	mcp: {
		name: "listmonk_start_campaign",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignStartOperationSpec(),
	execute: startCampaign,
});

export const pauseCampaignOperation = defineOperation({
	id: "campaigns.pause",
	title: "Pause campaign",
	description:
		"Transition a campaign into the paused status. Validates the current status allows the transition.",
	inputSchema: campaignLifecycleInputSchema,
	outputSchema: campaignLifecycleOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_pause_campaign",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignsPauseOperationSpec(),
	execute: pauseCampaign,
});

export const cancelCampaignOperation = defineOperation({
	id: "campaigns.cancel",
	title: "Cancel campaign",
	description:
		"Transition a campaign into the cancelled status. Validates the current status allows the transition. Destructive because the cancellation is irreversible.",
	inputSchema: campaignLifecycleInputSchema,
	outputSchema: campaignLifecycleOutputSchema,
	safety: deliveryTransitionSafety,
	mcp: {
		name: "listmonk_cancel_campaign",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignCancelOperationSpec(),
	execute: cancelCampaign,
});

export const cloneCampaignOperation = defineOperation({
	id: "campaigns.clone",
	title: "Clone campaign",
	description:
		"Create a new campaign by copying the body, lists, template, and metadata of an existing campaign under a new name. The clone starts in draft status.",
	inputSchema: cloneCampaignInputSchema,
	outputSchema: campaignCreateOutputSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_clone_campaign",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignsCloneOperationSpec(),
	execute: cloneCampaign,
});

export const getCampaignStatsOperation = defineOperation({
	id: "campaigns.stats",
	title: "Get campaign stats",
	description:
		"Read delivery stats (views, clicks, bounces, to_send, sent, started_at) for a campaign from Listmonk.",
	inputSchema: campaignStatsInputSchema,
	outputSchema: campaignStatsOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_campaign_stats",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindCampaignsStatsOperationSpec(),
	execute: getCampaignStats,
});

export async function invokeGetCampaignsOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<CampaignListPage> {
	const parsedInput = parseOperationInput(
		getCampaignsOperation.inputSchema,
		input,
	);
	let output: CampaignListPage;
	try {
		output = await listCampaigns(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getCampaignsOperation.id, error);
	}
	return parseOperationOutput(
		getCampaignsOperation.id,
		getCampaignsOperation.outputSchema,
		output,
	);
}

export async function invokeGetCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<z.output<typeof campaignSchema>> {
	const parsedInput = parseOperationInput(
		getCampaignOperation.inputSchema,
		input,
	);
	let output: z.output<typeof campaignSchema>;
	try {
		output = await getCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getCampaignOperation.id, error);
	}
	return parseOperationOutput(
		getCampaignOperation.id,
		getCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeCreateCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<z.output<typeof campaignCreateOutputSchema>> {
	const parsedInput = parseOperationInput(
		createCampaignOperation.inputSchema,
		input,
	);
	let output: CampaignCreateResult;
	try {
		output = await createCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(createCampaignOperation.id, error);
	}
	return parseOperationOutput(
		createCampaignOperation.id,
		createCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeUpdateCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<z.output<typeof campaignSchema>> {
	const parsedInput = parseOperationInput(
		updateCampaignOperation.inputSchema,
		input,
	);
	let output: z.output<typeof campaignSchema>;
	try {
		output = await updateCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(updateCampaignOperation.id, error);
	}
	return parseOperationOutput(
		updateCampaignOperation.id,
		updateCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeDeleteCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<z.output<typeof deleteCampaignOutputSchema>> {
	const parsedInput = parseOperationInput(
		deleteCampaignOperation.inputSchema,
		input,
	);
	let output: z.output<typeof deleteCampaignOutputSchema>;
	try {
		output = await deleteCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(deleteCampaignOperation.id, error);
	}
	return parseOperationOutput(
		deleteCampaignOperation.id,
		deleteCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeScheduleCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<CampaignLifecycleOutput> {
	const parsedInput = parseOperationInput(
		scheduleCampaignOperation.inputSchema,
		input,
	);
	let output: CampaignLifecycleOutput;
	try {
		output = await scheduleCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(scheduleCampaignOperation.id, error);
	}
	return parseOperationOutput(
		scheduleCampaignOperation.id,
		scheduleCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeStartCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<CampaignLifecycleOutput> {
	const parsedInput = parseOperationInput(
		startCampaignOperation.inputSchema,
		input,
	);
	let output: CampaignLifecycleOutput;
	try {
		output = await startCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(startCampaignOperation.id, error);
	}
	return parseOperationOutput(
		startCampaignOperation.id,
		startCampaignOperation.outputSchema,
		output,
	);
}

export async function invokePauseCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<CampaignLifecycleOutput> {
	const parsedInput = parseOperationInput(
		pauseCampaignOperation.inputSchema,
		input,
	);
	let output: CampaignLifecycleOutput;
	try {
		output = await pauseCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(pauseCampaignOperation.id, error);
	}
	return parseOperationOutput(
		pauseCampaignOperation.id,
		pauseCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeCancelCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<CampaignLifecycleOutput> {
	const parsedInput = parseOperationInput(
		cancelCampaignOperation.inputSchema,
		input,
	);
	let output: CampaignLifecycleOutput;
	try {
		output = await cancelCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(cancelCampaignOperation.id, error);
	}
	return parseOperationOutput(
		cancelCampaignOperation.id,
		cancelCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeCloneCampaignOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<z.output<typeof campaignCreateOutputSchema>> {
	const parsedInput = parseOperationInput(
		cloneCampaignOperation.inputSchema,
		input,
	);
	let output: CampaignCreateResult;
	try {
		output = await cloneCampaign(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(cloneCampaignOperation.id, error);
	}
	return parseOperationOutput(
		cloneCampaignOperation.id,
		cloneCampaignOperation.outputSchema,
		output,
	);
}

export async function invokeGetCampaignStatsOperation(
	context: CampaignOperationContext,
	input: unknown,
): Promise<CampaignStatsOutput> {
	const parsedInput = parseOperationInput(
		getCampaignStatsOperation.inputSchema,
		input,
	);
	let output: CampaignStatsOutput;
	try {
		output = await getCampaignStats(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getCampaignStatsOperation.id, error);
	}
	return parseOperationOutput(
		getCampaignStatsOperation.id,
		getCampaignStatsOperation.outputSchema,
		output,
	);
}

export const campaignOperations = [
	getCampaignsOperation,
	getCampaignOperation,
	createCampaignOperation,
	updateCampaignOperation,
	deleteCampaignOperation,
	scheduleCampaignOperation,
	startCampaignOperation,
	pauseCampaignOperation,
	cancelCampaignOperation,
	cloneCampaignOperation,
	getCampaignStatsOperation,
] as const;

export const campaignOperationCatalog = defineOperationCatalog({
	id: "campaigns",
	title: "Campaigns",
	operations: campaignOperations,
	specMigrationExemptions: [],
});

export type CampaignOperation = (typeof campaignOperations)[number];

const campaignOperationsByMcpName = new Map<string, CampaignOperation>(
	campaignOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getCampaignOperationByMcpName(
	name: string,
): CampaignOperation | undefined {
	return campaignOperationsByMcpName.get(name);
}

export interface CampaignOperationInvocation {
	operation: CampaignOperation;
	output: Record<string, unknown>;
}

export async function invokeCampaignOperationByMcpName(
	context: CampaignOperationContext,
	name: string,
	input: unknown,
): Promise<CampaignOperationInvocation | undefined> {
	switch (name) {
		case getCampaignsOperation.mcp.name:
			return {
				operation: getCampaignsOperation,
				output: await invokeGetCampaignsOperation(context, input),
			};
		case getCampaignOperation.mcp.name:
			return {
				operation: getCampaignOperation,
				output: await invokeGetCampaignOperation(context, input),
			};
		case createCampaignOperation.mcp.name:
			return {
				operation: createCampaignOperation,
				output: await invokeCreateCampaignOperation(context, input),
			};
		case updateCampaignOperation.mcp.name:
			return {
				operation: updateCampaignOperation,
				output: await invokeUpdateCampaignOperation(context, input),
			};
		case deleteCampaignOperation.mcp.name:
			return {
				operation: deleteCampaignOperation,
				output: await invokeDeleteCampaignOperation(context, input),
			};
		case scheduleCampaignOperation.mcp.name:
			return {
				operation: scheduleCampaignOperation,
				output: await invokeScheduleCampaignOperation(context, input),
			};
		case startCampaignOperation.mcp.name:
			return {
				operation: startCampaignOperation,
				output: await invokeStartCampaignOperation(context, input),
			};
		case pauseCampaignOperation.mcp.name:
			return {
				operation: pauseCampaignOperation,
				output: await invokePauseCampaignOperation(context, input),
			};
		case cancelCampaignOperation.mcp.name:
			return {
				operation: cancelCampaignOperation,
				output: await invokeCancelCampaignOperation(context, input),
			};
		case cloneCampaignOperation.mcp.name:
			return {
				operation: cloneCampaignOperation,
				output: await invokeCloneCampaignOperation(context, input),
			};
		case getCampaignStatsOperation.mcp.name:
			return {
				operation: getCampaignStatsOperation,
				output: await invokeGetCampaignStatsOperation(context, input),
			};
		default:
			return undefined;
	}
}
