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
		per_page: input.per_page === "all" ? (data.results?.length ?? 0) : input.per_page,
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
	mcp: { name: "listmonk_create_campaign", legacySuccessText: jsonResourceValue },
	execute: createCampaign,
});

export const updateCampaignOperation = defineOperation({
	id: "campaigns.update",
	title: "Update campaign",
	description: "Update a campaign in Listmonk",
	inputSchema: updateCampaignInputSchema,
	outputSchema: campaignSchema,
	safety: updateResourceSafety,
	mcp: { name: "listmonk_update_campaign", legacySuccessText: jsonResourceValue },
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

export const campaignOperations = [
	getCampaignsOperation,
	getCampaignOperation,
	createCampaignOperation,
	updateCampaignOperation,
	deleteCampaignOperation,
] as const;

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
		default:
			return undefined;
	}
}
