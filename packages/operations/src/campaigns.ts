import type { Campaign, ListmonkClient } from "@listmonk-ops/openapi";
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
import { defineOperationCatalog } from "./catalog";
import {
	assertCampaignTransition,
	isParseableCampaignSendAt,
	type CampaignLifecycleTarget,
} from "./campaign-lifecycle";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

export interface CampaignOperationContext {
	client: Pick<ListmonkClient, "campaign">;
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
	altbody: z.string().optional(),
	type: campaignTypeSchema.default("regular"),
	template_id: resourceIdSchema,
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

const createCampaignInputSchema = z.object(campaignBodyFields);

const updateCampaignInputSchema = z
	.object({
		id: resourceIdSchema,
		name: campaignBodyFields.name.optional(),
		subject: campaignBodyFields.subject.optional(),
		from_email: campaignBodyFields.from_email.optional(),
		body: campaignBodyFields.body.optional(),
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

async function findCreatedCampaign(
	client: Pick<ListmonkClient, "campaign">,
	name: string,
): Promise<Campaign | undefined> {
	const pageSize = 100;
	const firstResponse = await client.campaign.list({
		query: { page: 1, per_page: pageSize },
	});
	const firstPage = unwrapResourceResponse(
		firstResponse,
		"Failed to resolve created campaign",
	);
	const firstMatch = firstPage.results?.find(
		(campaign) => campaign.name === name,
	);
	if (firstMatch) return firstMatch;

	const pageCount = Math.max(1, Math.ceil((firstPage.total ?? 0) / pageSize));
	for (let page = 2; page <= pageCount; page += 1) {
		const response = await client.campaign.list({
			query: { page, per_page: pageSize },
		});
		const pageData = unwrapResourceResponse(
			response,
			"Failed to resolve created campaign",
		);
		const match = pageData.results?.find((campaign) => campaign.name === name);
		if (match) return match;
	}
	return undefined;
}

export async function createCampaign(
	{ client }: CampaignOperationContext,
	input: z.output<typeof createCampaignInputSchema>,
): Promise<z.output<typeof campaignSchema>> {
	const body = input as CampaignCreateBody;
	const response = await client.campaign.create({ body });
	if ("error" in response && response.error !== undefined) {
		throw new Error(
			`Failed to create campaign: ${toResourceErrorMessage(response.error)}`,
		);
	}
	if (response.data !== undefined) return asCampaign(response.data);

	const created = await findCreatedCampaign(client, input.name);
	if (!created) {
		throw new Error(
			"Campaign was created but the created record could not be resolved",
		);
	}
	return asCampaign(created);
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
			.min(1)
			.describe("ISO 8601 (or Listmonk-compatible) scheduled send timestamp"),
	})
	.refine(
		(input) => isParseableCampaignSendAt(input.send_at),
		{
			message:
				"send_at must be an ISO 8601 timestamp (e.g. '2026-08-01T09:00:00Z') or a Listmonk-compatible 'YYYY-MM-DD HH:MM:SS' string",
			path: ["send_at"],
		},
	);

const campaignLifecycleInputSchema = z.object({
	id: resourceIdSchema,
});

const cloneCampaignInputSchema = z.object({
	id: resourceIdSchema,
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
 * allowed. Lifecycle operations always read-then-write so that the state
 * machine can reject obviously invalid transitions (e.g. `cancelled ->
 * running`) before hitting the Listmonk API.
 */
async function loadCampaignForTransition(
	client: Pick<ListmonkClient, "campaign">,
	id: number,
	target: CampaignLifecycleTarget,
): Promise<{ id: number; status: string }> {
	const response = await client.campaign.getById({ path: { id } });
	const campaign = asCampaign(
		unwrapResourceResponse(response, "Failed to load campaign for transition"),
	);
	const currentStatus = campaign.status;
	assertCampaignTransition(currentStatus, target);
	return { id, status: currentStatus ?? "<unknown>" };
}

const CAMPAIGN_LIFECYCLE_VERBS: Readonly<Record<CampaignLifecycleTarget, string>> = {
	scheduled: "schedule",
	running: "start",
	paused: "pause",
	cancelled: "cancel",
};

async function transitionCampaign(
	ctx: CampaignOperationContext,
	id: number,
	target: CampaignLifecycleTarget,
): Promise<{ id: number; status: string }> {
	// loadCampaignForTransition reads the current campaign and asserts the
	// transition is legal. We don't use its return value here: we report
	// the requested target status back to the caller, which matches what
	// Listmonk accepts on a successful `updateStatus` call.
	await loadCampaignForTransition(ctx.client, id, target);
	const response = await ctx.client.campaign.updateStatus({
		path: { id },
		body: { status: target },
	});
	const verb = CAMPAIGN_LIFECYCLE_VERBS[target] ?? target;
	unwrapResourceResponse(response, `Failed to ${verb} campaign ${id}`);
	return { id, status: target };
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
	await loadCampaignForTransition(ctx.client, input.id, "scheduled");
	const updateResponse = await ctx.client.campaign.update({
		path: { id: input.id },
		body: { send_at: input.send_at } as CampaignUpdateBody,
	});
	asCampaign(
		unwrapResourceResponse(updateResponse, "Failed to set campaign send_at"),
	);
	try {
		const statusResponse = await ctx.client.campaign.updateStatus({
			path: { id: input.id },
			body: { status: "scheduled" },
		});
		unwrapResourceResponse(
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
	return transitionCampaign(ctx, input.id, "running");
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
	return transitionCampaign(ctx, input.id, "paused");
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
	return transitionCampaign(ctx, input.id, "cancelled");
}

export async function cloneCampaign(
	ctx: CampaignOperationContext,
	input: z.output<typeof cloneCampaignInputSchema>,
): Promise<z.output<typeof campaignSchema>> {
	const sourceResponse = await ctx.client.campaign.getById({
		path: { id: input.id },
	});
	const source = asCampaign(
		unwrapResourceResponse(
			sourceResponse,
			`Failed to load campaign ${input.id} for clone`,
		),
	);
	// Pick only the create-compatible fields from the source, then validate
	// the resulting body through createCampaignInputSchema. This catches
	// drafts that are missing required create fields (subject, from_email,
	// body, lists) before they reach the API, and it fills in defaults
	// (type=regular, messenger=email, content_type=html) consistently with
	// the regular create flow. Identity, runtime, and stats fields are
	// deliberately omitted so the clone starts in a clean draft state.
	// `send_at` is reset so the clone does not inherit the source schedule.
	//
	// `source.lists` is typed as `Array<looseObject>` because the schema
	// only asserts the entries are objects. Listmonk returns each list as
	// `{ id, name }`, but we read the id defensively and surface a clear
	// error if a single entry does not match that shape. If the source has
	// no lists, parseOperationInput will reject the body against
	// createCampaignInputSchema (which requires `lists.min(1)`) with a
	// standard validation message.
	const sourceLists = (source.lists ?? []).map((entry, index) => {
		const listId = (entry as { id?: unknown }).id;
		if (typeof listId !== "number" || !Number.isFinite(listId)) {
			throw new Error(
				`Campaign ${input.id} cannot be cloned: list entry at index ${index} is missing a numeric id`,
			);
		}
		return listId;
	});
	// `source.media` is also typed as an array of loose objects (Listmonk
	// returns `{ id, filename, ... }`), but createCampaignInputSchema needs
	// numeric IDs. Map defensively, mirroring the lists extraction above.
	const sourceMediaIds = (source.media ?? []).map((entry, index) => {
		const mediaId = (entry as { id?: unknown }).id;
		if (typeof mediaId !== "number" || !Number.isFinite(mediaId)) {
			throw new Error(
				`Campaign ${input.id} cannot be cloned: media entry at index ${index} is missing a numeric id`,
			);
		}
		return mediaId;
	});
	const body = parseOperationInput(createCampaignInputSchema, {
		name: input.name,
		subject: source.subject,
		from_email: source.from_email,
		body: source.body,
		altbody: source.altbody ?? undefined,
		type: source.type,
		content_type: source.content_type,
		messenger: source.messenger,
		tags: source.tags,
		template_id: source.template_id ?? undefined,
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
	const createResponse = await ctx.client.campaign.create({ body });
	if ("error" in createResponse && createResponse.error !== undefined) {
		throw new Error(
			`Failed to clone campaign: ${toResourceErrorMessage(createResponse.error)}`,
		);
	}
	if (createResponse.data !== undefined) return asCampaign(createResponse.data);
	const created = await findCreatedCampaign(ctx.client, input.name);
	if (!created) {
		throw new Error(
			"Campaign was cloned but the created record could not be resolved",
		);
	}
	return asCampaign(created);
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
	execute: getCampaign,
});

export const createCampaignOperation = defineOperation({
	id: "campaigns.create",
	title: "Create campaign",
	description: "Create a campaign in Listmonk",
	inputSchema: createCampaignInputSchema,
	outputSchema: campaignSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_create_campaign",
		legacySuccessText: jsonResourceValue,
	},
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
	execute: deleteCampaign,
});

export const scheduleCampaignOperation = defineOperation({
	id: "campaigns.schedule",
	title: "Schedule campaign",
	description:
		"Schedule a campaign to send at a specific time. Validates the current status allows the transition.",
	inputSchema: scheduleCampaignInputSchema,
	outputSchema: campaignLifecycleOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_schedule_campaign",
		legacySuccessText: jsonResourceValue,
	},
	execute: scheduleCampaign,
});

export const startCampaignOperation = defineOperation({
	id: "campaigns.start",
	title: "Start campaign",
	description:
		"Transition a campaign into the running status. Validates the current status allows the transition.",
	inputSchema: campaignLifecycleInputSchema,
	outputSchema: campaignLifecycleOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_start_campaign",
		legacySuccessText: jsonResourceValue,
	},
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
	execute: pauseCampaign,
});

export const cancelCampaignOperation = defineOperation({
	id: "campaigns.cancel",
	title: "Cancel campaign",
	description:
		"Transition a campaign into the cancelled status. Validates the current status allows the transition.",
	inputSchema: campaignLifecycleInputSchema,
	outputSchema: campaignLifecycleOutputSchema,
	safety: updateResourceSafety,
	mcp: {
		name: "listmonk_cancel_campaign",
		legacySuccessText: jsonResourceValue,
	},
	execute: cancelCampaign,
});

export const cloneCampaignOperation = defineOperation({
	id: "campaigns.clone",
	title: "Clone campaign",
	description:
		"Create a new campaign by copying the body, lists, template, and metadata of an existing campaign under a new name. The clone starts in draft status.",
	inputSchema: cloneCampaignInputSchema,
	outputSchema: campaignSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_clone_campaign",
		legacySuccessText: jsonResourceValue,
	},
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
): Promise<z.output<typeof campaignSchema>> {
	const parsedInput = parseOperationInput(
		createCampaignOperation.inputSchema,
		input,
	);
	let output: z.output<typeof campaignSchema>;
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
): Promise<z.output<typeof campaignSchema>> {
	const parsedInput = parseOperationInput(
		cloneCampaignOperation.inputSchema,
		input,
	);
	let output: z.output<typeof campaignSchema>;
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
