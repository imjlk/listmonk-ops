import { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeCreateCampaignOperation,
	invokeDeleteCampaignOperation,
	invokeGetCampaignOperation,
	invokeGetCampaignsOperation,
	invokeUpdateCampaignOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import {
	parseCsvNumbers,
	parseJson,
	toErrorMessage,
} from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type CampaignsOutput = Pick<
	typeof OutputUtils,
	"info" | "json" | "success" | "table"
>;

export interface CampaignsCliContext {
	client: Pick<ListmonkClient, "campaign">;
	output: CampaignsOutput;
}

export interface ListCampaignsInput {
	page?: number;
	per_page?: number;
	status?: string;
	query?: string;
	tags?: string[];
	order?: "ASC" | "DESC";
	order_by?: "name" | "status" | "created_at" | "updated_at";
	no_body?: boolean;
}

export interface GetCampaignInput {
	id: number;
	no_body?: boolean;
}

export interface CreateCampaignInput {
	name: string;
	subject: string;
	from_email: string;
	body: string;
	altbody?: string;
	type?: "regular" | "optin";
	template_id: number;
	lists: number[];
	tags?: string[];
	messenger?: string;
	content_type?: "richtext" | "html" | "markdown" | "plain" | "visual";
	send_at?: string | null;
	headers?: Array<Record<string, string>>;
	attribs?: Record<string, unknown>;
	archive?: boolean;
	archive_slug?: string | null;
	archive_template_id?: number | null;
	archive_meta?: Record<string, unknown>;
	media?: number[];
	subscribers?: string[];
}

export type UpdateCampaignInput = Partial<Omit<CreateCampaignInput, "template_id" | "lists">> & {
	id: number;
	template_id?: number | null;
	lists?: number[];
};

export function createCampaignCommandError(context: string, error: unknown): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

function parseCsvStrings(value: string | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	return value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

export async function renderCampaigns(
	context: CampaignsCliContext,
	input: ListCampaignsInput,
): Promise<void> {
	const page = await invokeGetCampaignsOperation(context, input);
	if (page.results.length === 0) {
		context.output.info("No campaigns found");
		return;
	}
	context.output.table(page.results as Record<string, unknown>[]);
}

export async function renderCampaign(
	context: CampaignsCliContext,
	input: GetCampaignInput,
): Promise<void> {
	context.output.json(await invokeGetCampaignOperation(context, input));
}

export async function renderCreateCampaign(
	context: CampaignsCliContext,
	input: CreateCampaignInput,
): Promise<void> {
	const campaign = await invokeCreateCampaignOperation(context, input);
	context.output.success(`Campaign created: ${campaign.id ?? input.name}`);
	context.output.json(campaign);
}

export async function renderUpdateCampaign(
	context: CampaignsCliContext,
	input: UpdateCampaignInput,
): Promise<void> {
	const campaign = await invokeUpdateCampaignOperation(context, input);
	context.output.success(`Campaign updated: ${input.id}`);
	context.output.json(campaign);
}

export async function renderDeleteCampaign(
	context: CampaignsCliContext,
	input: { id: number },
): Promise<void> {
	const result = await invokeDeleteCampaignOperation(context, input);
	context.output.success(`Campaign deleted: ${input.id}`);
	context.output.json(result);
}

type ListCommandFlags = {
	page?: number;
	"per-page"?: number;
	status?: string;
	query?: string;
	tags?: string;
	order?: "ASC" | "DESC";
	"order-by"?: "name" | "status" | "created_at" | "updated_at";
	"no-body"?: boolean;
};

export async function handleListCampaignsCommand({
	flags,
	...args
}: HandlerArgs<ListCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderCampaigns(
			{ client, output: OutputUtils },
			{
				page: flags.page,
				per_page: flags["per-page"],
				status: flags.status,
				query: flags.query,
				tags: parseCsvStrings(flags.tags),
				order: flags.order,
				order_by: flags["order-by"],
				no_body: flags["no-body"],
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to list campaigns", error);
	}
}

type GetCommandFlags = { id: number; "no-body"?: boolean };

export async function handleGetCampaignCommand({
	flags,
	...args
}: HandlerArgs<GetCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderCampaign(
			{ client, output: OutputUtils },
			{ id: flags.id, no_body: flags["no-body"] },
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to get campaign", error);
	}
}

type CreateCommandFlags = {
	name: string;
	subject: string;
	"from-email": string;
	body: string;
	altbody?: string;
	type: "regular" | "optin";
	"template-id": number;
	lists: string;
	tags?: string;
	messenger: string;
	"content-type": "richtext" | "html" | "markdown" | "plain" | "visual";
	"send-at"?: string;
	headers?: string;
	attribs?: string;
	archive?: boolean;
	"archive-slug"?: string;
	"archive-template-id"?: number;
	"archive-meta"?: string;
	media?: string;
	subscribers?: string;
};

export async function handleCreateCampaignCommand({
	flags,
	...args
}: HandlerArgs<CreateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderCreateCampaign(
			{ client, output: OutputUtils },
			{
				name: flags.name,
				subject: flags.subject,
				from_email: flags["from-email"],
				body: flags.body,
				altbody: flags.altbody,
				type: flags.type,
				template_id: flags["template-id"],
				lists: parseCsvNumbers(flags.lists),
				tags: parseCsvStrings(flags.tags),
				messenger: flags.messenger,
				content_type: flags["content-type"],
				send_at: flags["send-at"],
				headers: flags.headers
					? parseJson<Array<Record<string, string>>>(flags.headers, "headers")
					: undefined,
				attribs: flags.attribs
					? parseJson<Record<string, unknown>>(flags.attribs, "attribs")
					: undefined,
				archive: flags.archive,
				archive_slug: flags["archive-slug"],
				archive_template_id: flags["archive-template-id"],
				archive_meta: flags["archive-meta"]
					? parseJson<Record<string, unknown>>(flags["archive-meta"], "archive-meta")
					: undefined,
				media: flags.media ? parseCsvNumbers(flags.media) : undefined,
				subscribers: parseCsvStrings(flags.subscribers),
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to create campaign", error);
	}
}

type UpdateCommandFlags = Omit<CreateCommandFlags, "name" | "subject" | "from-email" | "body" | "type" | "template-id" | "lists" | "messenger" | "content-type"> & {
	id: number;
	name?: string;
	subject?: string;
	"from-email"?: string;
	body?: string;
	type?: "regular" | "optin";
	"template-id"?: number;
	lists?: string;
	messenger?: string;
	"content-type"?: "richtext" | "html" | "markdown" | "plain" | "visual";
};

export async function handleUpdateCampaignCommand({
	flags,
	...args
}: HandlerArgs<UpdateCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderUpdateCampaign(
			{ client, output: OutputUtils },
			{
				id: flags.id,
				name: flags.name,
				subject: flags.subject,
				from_email: flags["from-email"],
				body: flags.body,
				altbody: flags.altbody,
				type: flags.type,
				template_id: flags["template-id"],
				lists: flags.lists ? parseCsvNumbers(flags.lists) : undefined,
				tags: parseCsvStrings(flags.tags),
				messenger: flags.messenger,
				content_type: flags["content-type"],
				send_at: flags["send-at"],
				headers: flags.headers
					? parseJson<Array<Record<string, string>>>(flags.headers, "headers")
					: undefined,
				attribs: flags.attribs
					? parseJson<Record<string, unknown>>(flags.attribs, "attribs")
					: undefined,
				archive: flags.archive,
				archive_slug: flags["archive-slug"],
				archive_template_id: flags["archive-template-id"],
				archive_meta: flags["archive-meta"]
					? parseJson<Record<string, unknown>>(flags["archive-meta"], "archive-meta")
					: undefined,
				media: flags.media ? parseCsvNumbers(flags.media) : undefined,
				subscribers: parseCsvStrings(flags.subscribers),
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to update campaign", error);
	}
}

export async function handleDeleteCampaignCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDeleteCampaign(
			{ client, output: OutputUtils },
			{ id: flags.id },
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to delete campaign", error);
	}
}

const campaignTypeOption = z.enum(["regular", "optin"]).default("regular");
const contentTypeOption = z
	.enum(["richtext", "html", "markdown", "plain", "visual"])
	.default("html");

export default defineGroup({
	name: "campaigns",
	description: "Manage campaigns",
	commands: [
		defineCommand({
			name: "list",
			operationId: "campaigns.list",
			description: "List campaigns",
			options: {
				page: option(z.coerce.number().int().positive().optional(), {
					description: "Page number",
				}),
				"per-page": option(z.coerce.number().int().positive().optional(), {
					description: "Items per page",
				}),
				status: option(z.string().trim().optional(), { description: "Status filter" }),
				query: option(z.string().trim().optional(), { description: "Search query" }),
				tags: option(z.string().trim().optional(), { description: "Comma-separated tags" }),
				order: option(z.enum(["ASC", "DESC"]).optional(), { description: "Sort order" }),
				"order-by": option(z.enum(["name", "status", "created_at", "updated_at"]).optional(), { description: "Sort field" }),
				"no-body": option(z.boolean().optional(), { description: "Omit campaign body" }),
			},
			handler: handleListCampaignsCommand,
		}),
		defineCommand({
			name: "get",
			operationId: "campaigns.get",
			description: "Get campaign details",
			options: {
				id: option(z.coerce.number().int().positive(), { description: "Campaign ID" }),
				"no-body": option(z.boolean().optional(), { description: "Omit campaign body" }),
			},
			handler: handleGetCampaignCommand,
		}),
		defineCommand({
			name: "create",
			operationId: "campaigns.create",
			description: "Create a campaign",
			options: {
				name: option(z.string().trim().min(1), { description: "Campaign name" }),
				subject: option(z.string().trim().min(1), { description: "Email subject" }),
				"from-email": option(z.string().trim().min(1), { description: "From email address" }),
				body: option(z.string().min(1), { description: "Campaign body" }),
				altbody: option(z.string().optional(), { description: "Plain-text alternative" }),
				type: option(campaignTypeOption, { description: "Campaign type" }),
				"template-id": option(z.coerce.number().int().positive(), { description: "Template ID" }),
				lists: option(z.string().trim().min(1), { description: "Comma-separated list IDs" }),
				tags: option(z.string().trim().optional(), { description: "Comma-separated tags" }),
				messenger: option(z.string().trim().default("email"), { description: "Messenger" }),
				"content-type": option(contentTypeOption, { description: "Campaign content type" }),
				"send-at": option(z.string().optional(), { description: "Scheduled send time" }),
				headers: option(z.string().optional(), { description: "Headers JSON" }),
				attribs: option(z.string().optional(), { description: "Attributes JSON" }),
				archive: option(z.boolean().optional(), { description: "Archive campaign" }),
				"archive-slug": option(z.string().optional(), { description: "Archive slug" }),
				"archive-template-id": option(z.coerce.number().int().positive().optional(), { description: "Archive template ID" }),
				"archive-meta": option(z.string().optional(), { description: "Archive metadata JSON" }),
				media: option(z.string().optional(), { description: "Comma-separated media IDs" }),
				subscribers: option(z.string().optional(), { description: "Comma-separated recipient emails" }),
			},
			handler: handleCreateCampaignCommand,
		}),
		defineCommand({
			name: "update",
			operationId: "campaigns.update",
			description: "Update a campaign",
			options: {
				id: option(z.coerce.number().int().positive(), { description: "Campaign ID" }),
				name: option(z.string().trim().min(1).optional(), { description: "Campaign name" }),
				subject: option(z.string().trim().min(1).optional(), { description: "Email subject" }),
				"from-email": option(z.string().trim().min(1).optional(), { description: "From email address" }),
				body: option(z.string().min(1).optional(), { description: "Campaign body" }),
				altbody: option(z.string().optional(), { description: "Plain-text alternative" }),
				type: option(z.enum(["regular", "optin"]).optional(), { description: "Campaign type" }),
				"template-id": option(z.coerce.number().int().positive().optional(), { description: "Template ID" }),
				lists: option(z.string().trim().optional(), { description: "Comma-separated list IDs" }),
				tags: option(z.string().trim().optional(), { description: "Comma-separated tags" }),
				messenger: option(z.string().trim().min(1).optional(), { description: "Messenger" }),
				"content-type": option(z.enum(["richtext", "html", "markdown", "plain", "visual"]).optional(), { description: "Campaign content type" }),
				"send-at": option(z.string().optional(), { description: "Scheduled send time" }),
				headers: option(z.string().optional(), { description: "Headers JSON" }),
				attribs: option(z.string().optional(), { description: "Attributes JSON" }),
				archive: option(z.boolean().optional(), { description: "Archive campaign" }),
				"archive-slug": option(z.string().optional(), { description: "Archive slug" }),
				"archive-template-id": option(z.coerce.number().int().positive().optional(), { description: "Archive template ID" }),
				"archive-meta": option(z.string().optional(), { description: "Archive metadata JSON" }),
				media: option(z.string().optional(), { description: "Comma-separated media IDs" }),
				subscribers: option(z.string().optional(), { description: "Comma-separated recipient emails" }),
			},
			handler: handleUpdateCampaignCommand,
		}),
		defineCommand({
			name: "delete",
			operationId: "campaigns.delete",
			description: "Delete a campaign",
			options: {
				id: option(z.coerce.number().int().positive(), { description: "Campaign ID" }),
			},
			handler: handleDeleteCampaignCommand,
		}),
	],
});
