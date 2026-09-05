import {
	createFileBackedResourceCreateIdempotencyStore,
	type OutputUtils,
	type ResourceCreateIdempotencyStore,
} from "@listmonk-ops/common";
import { createHash } from "node:crypto";
import { getOutput } from "../lib/output";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeCancelCampaignOperation,
	invokeCloneCampaignOperation,
	invokeCreateCampaignOperation,
	invokeDeleteCampaignOperation,
	invokeGetCampaignOperation,
	invokeGetCampaignsOperation,
	invokeArchiveCampaignOperation,
	invokeGetCampaignAnalyticsOperation,
	invokeGetCampaignStatsOperation,
	CAMPAIGN_ANALYTICS_DATE_PATTERN_SOURCE,
	MAX_CAMPAIGN_ANALYTICS_IDS,
	invokePreviewCampaignOperation,
	invokeTestCampaignOperation,
	invokePauseCampaignOperation,
	invokeScheduleCampaignOperation,
	invokeStartCampaignOperation,
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
	parseCsvNumbersStrict,
	parseJson,
	toErrorMessage,
} from "../lib/command-utils";
import { getListmonkClient, resolveListmonkSession } from "../lib/listmonk";

type CampaignsOutput = Pick<
	typeof OutputUtils,
	"info" | "json" | "success" | "table"
>;

function hashCreatePayload(serialized: string): string {
	return createHash("sha256").update(serialized).digest("hex");
}

export interface CampaignsCliContext {
	client: Pick<ListmonkClient, "campaign">;
	output: CampaignsOutput;
	createIdempotencyStore?: ResourceCreateIdempotencyStore;
	hashCreatePayload?: (serialized: string) => string;
	target?: { baseUrl?: string; username?: string };
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

export interface CampaignLifecycleInput {
	id: number;
	expected_updated_at?: string;
}

export interface ScheduleCampaignInput extends CampaignLifecycleInput {
	send_at: string;
}

export interface CreateCampaignInput {
	name: string;
	idempotency_key?: string;
	subject: string;
	from_email: string;
	body: string;
	body_source?: string | null;
	altbody?: string;
	type?: "regular" | "optin";
	template_id: number | null | undefined;
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
	const result = await invokeCreateCampaignOperation(context, input);
	context.output.success(
		result.created
			? `Campaign created: ${result.campaign.id ?? input.name}`
			: `Campaign already created: ${result.campaign.id ?? input.name}`,
	);
	context.output.json(result);
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

export async function renderScheduleCampaign(
	context: CampaignsCliContext,
	input: ScheduleCampaignInput,
) {
	const result = await invokeScheduleCampaignOperation(context, input);
	context.output.success(`Campaign ${input.id} scheduled for ${input.send_at}`);
	context.output.json(result);
	return result;
}

export async function renderStartCampaign(
	context: CampaignsCliContext,
	input: CampaignLifecycleInput,
) {
	const result = await invokeStartCampaignOperation(context, input);
	context.output.success(`Campaign ${input.id} started`);
	context.output.json(result);
	return result;
}

export async function renderPauseCampaign(
	context: CampaignsCliContext,
	input: CampaignLifecycleInput,
) {
	const result = await invokePauseCampaignOperation(context, input);
	context.output.success(`Campaign ${input.id} paused`);
	context.output.json(result);
	return result;
}

export async function renderCancelCampaign(
	context: CampaignsCliContext,
	input: CampaignLifecycleInput,
) {
	const result = await invokeCancelCampaignOperation(context, input);
	context.output.success(`Campaign ${input.id} cancelled`);
	context.output.json(result);
	return result;
}

export async function renderCloneCampaign(
	context: CampaignsCliContext,
	input: { id: number; idempotency_key?: string; name: string },
): Promise<void> {
	const result = await invokeCloneCampaignOperation(context, input);
	context.output.success(
		result.created
			? `Campaign ${input.id} cloned as '${input.name}'`
			: `Campaign ${input.id} already cloned as '${input.name}'`,
	);
	context.output.json(result);
}

export async function renderGetCampaignStats(
	context: CampaignsCliContext,
	input: { id: number },
): Promise<void> {
	const stats = await invokeGetCampaignStatsOperation(context, input);
	context.output.success(`Campaign ${input.id} stats`);
	context.output.json(stats);
}

type CampaignAnalyticsFacet = "views" | "clicks" | "links" | "bounces";

const CAMPAIGN_ANALYTICS_DATE = new RegExp(
	CAMPAIGN_ANALYTICS_DATE_PATTERN_SOURCE,
);

export async function renderArchiveCampaign(
	context: CampaignsCliContext,
	input: { id: number; archive: boolean },
): Promise<void> {
	const result = await invokeArchiveCampaignOperation(context, input);
	context.output.success(
		`Campaign ${input.id} archive ${input.archive ? "enabled" : "disabled"}`,
	);
	context.output.json(result);
}

export async function handleArchiveCampaignCommand({
	flags,
	...args
}: HandlerArgs<{ id: number; archive: boolean }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderArchiveCampaign(
			{ client, output: getOutput() },
			{
				id: flags.id,
				archive: flags.archive,
			},
		);
	} catch (error) {
		throw createCampaignCommandError(
			"Failed to toggle campaign archive",
			error,
		);
	}
}

export async function renderCampaignAnalytics(
	context: CampaignsCliContext,
	input: {
		type: CampaignAnalyticsFacet;
		from: string;
		to: string;
		campaign_ids: number[];
	},
): Promise<void> {
	const analytics = await invokeGetCampaignAnalyticsOperation(context, input);
	context.output.success(
		`Campaign analytics (${analytics.type}) for ${analytics.campaign_ids.join(", ")}: ${analytics.results.length} row(s)`,
	);
	context.output.json(analytics);
}

export async function renderPreviewCampaign(
	context: CampaignsCliContext,
	input: { id: number },
): Promise<void> {
	const preview = await invokePreviewCampaignOperation(context, input);
	context.output.success(
		`Campaign ${input.id} rendered preview (${preview.html.length} characters)`,
	);
	context.output.json(preview);
}

export async function renderTestCampaign(
	context: CampaignsCliContext,
	input: {
		id: number;
		subscribers: string[];
		subject?: string;
		template_id?: number;
		body?: string;
		messenger?: string;
		from_email?: string;
	},
): Promise<void> {
	const result = await invokeTestCampaignOperation(context, input);
	context.output.success(
		`Campaign ${input.id} test message sent to ${result.subscribers.join(", ")}`,
	);
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
			{ client, output: getOutput() },
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
			{ client, output: getOutput() },
			{ id: flags.id, no_body: flags["no-body"] },
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to get campaign", error);
	}
}

function parseTemplateIdFlag(value: string | undefined): number | null | undefined {
	if (value === undefined) return undefined;
	if (value === "null") return null;
	const num = Number(value);
	if (!Number.isFinite(num) || num <= 0) {
		throw new Error(
			`Invalid template ID '${value}': expected a positive integer or 'null'`,
		);
	}
	return num;
}

type CreateCommandFlags = {
	name: string;
	"idempotency-key"?: string;
	subject: string;
	"from-email": string;
	body: string;
	"body-source"?: string;
	altbody?: string;
	type: "regular" | "optin";
	"template-id": string;
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
		const session = await resolveListmonkSession(args, {
			requireAuth: true,
		});
		if (!session.client) {
			throw new Error("Listmonk client is not available");
		}
		const client = session.client;
		await renderCreateCampaign(
			{
				client,
				output: getOutput(),
				createIdempotencyStore:
					createFileBackedResourceCreateIdempotencyStore(),
				hashCreatePayload,
				target: { baseUrl: session.baseUrl, username: session.username },
			},
			{
				name: flags.name,
				idempotency_key: flags["idempotency-key"],
				subject: flags.subject,
				from_email: flags["from-email"],
				body: flags.body,
				body_source: flags["body-source"],
				altbody: flags.altbody,
				type: flags.type,
				template_id: parseTemplateIdFlag(flags["template-id"]),
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
					? parseJson<Record<string, unknown>>(
							flags["archive-meta"],
							"archive-meta",
						)
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
	"body-source"?: string;
	type?: "regular" | "optin";
	"template-id"?: string;
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
			{ client, output: getOutput() },
			{
				id: flags.id,
				name: flags.name,
				subject: flags.subject,
				from_email: flags["from-email"],
				body: flags.body,
				body_source: flags["body-source"],
				altbody: flags.altbody,
				type: flags.type,
				template_id: parseTemplateIdFlag(flags["template-id"]),
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
					? parseJson<Record<string, unknown>>(
							flags["archive-meta"],
							"archive-meta",
						)
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
			{ client, output: getOutput() },
			{ id: flags.id },
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to delete campaign", error);
	}
}

export async function handleScheduleCampaignCommand({
	flags,
	...args
}: HandlerArgs<{
	id: number;
	"send-at": string;
	"expected-updated-at"?: string;
}>) {
	try {
		const client = await getListmonkClient(args);
		return await renderScheduleCampaign(
			{ client, output: getOutput() },
			{
				id: flags.id,
				send_at: flags["send-at"],
				expected_updated_at: flags["expected-updated-at"],
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to schedule campaign", error);
	}
}

export async function handleStartCampaignCommand({
	flags,
	...args
}: HandlerArgs<{ id: number; "expected-updated-at"?: string }>) {
	try {
		const client = await getListmonkClient(args);
		return await renderStartCampaign(
			{ client, output: getOutput() },
			{
				id: flags.id,
				expected_updated_at: flags["expected-updated-at"],
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to start campaign", error);
	}
}

export async function handlePauseCampaignCommand({
	flags,
	...args
}: HandlerArgs<{ id: number; "expected-updated-at"?: string }>) {
	try {
		const client = await getListmonkClient(args);
		return await renderPauseCampaign(
			{ client, output: getOutput() },
			{
				id: flags.id,
				expected_updated_at: flags["expected-updated-at"],
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to pause campaign", error);
	}
}

export async function handleCancelCampaignCommand({
	flags,
	...args
}: HandlerArgs<{ id: number; "expected-updated-at"?: string }>) {
	try {
		const client = await getListmonkClient(args);
		return await renderCancelCampaign(
			{ client, output: getOutput() },
			{
				id: flags.id,
				expected_updated_at: flags["expected-updated-at"],
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to cancel campaign", error);
	}
}

export async function handleCampaignAnalyticsCommand({
	flags,
	...args
}: HandlerArgs<{
	type: CampaignAnalyticsFacet;
	from: string;
	to: string;
	"campaign-ids": string;
}>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderCampaignAnalytics(
			{ client, output: getOutput() },
			{
				type: flags.type,
				from: flags.from,
				to: flags.to,
				campaign_ids: parseCsvNumbersStrict(
					flags["campaign-ids"],
					"campaign IDs",
				),
			},
		);
	} catch (error) {
		throw createCampaignCommandError(
			"Failed to read campaign analytics",
			error,
		);
	}
}

export async function handlePreviewCampaignCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderPreviewCampaign(
			{ client, output: getOutput() },
			{
				id: flags.id,
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to preview campaign", error);
	}
}

export async function handleTestCampaignCommand({
	flags,
	...args
}: HandlerArgs<{
	id: number;
	subscribers: string;
	subject?: string;
	"template-id"?: number;
	body?: string;
	messenger?: string;
	"from-email"?: string;
}>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderTestCampaign(
			{ client, output: getOutput() },
			{
				id: flags.id,
				subscribers: parseCsvStrings(flags.subscribers) ?? [],
				subject: flags.subject,
				template_id: flags["template-id"],
				body: flags.body,
				messenger: flags.messenger,
				from_email: flags["from-email"],
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to send campaign test", error);
	}
}

export async function handleCloneCampaignCommand({
	flags,
	...args
}: HandlerArgs<{ id: number; "idempotency-key"?: string; name: string }>): Promise<void> {
	try {
		const session = await resolveListmonkSession(args, {
			requireAuth: true,
		});
		if (!session.client) {
			throw new Error("Listmonk client is not available");
		}
		const client = session.client;
		await renderCloneCampaign(
			{
				client,
				output: getOutput(),
				createIdempotencyStore:
					createFileBackedResourceCreateIdempotencyStore(),
				hashCreatePayload,
				target: { baseUrl: session.baseUrl, username: session.username },
			},
			{
				id: flags.id,
				idempotency_key: flags["idempotency-key"],
				name: flags.name,
			},
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to clone campaign", error);
	}
}

export async function handleGetCampaignStatsCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderGetCampaignStats(
			{ client, output: getOutput() },
			{ id: flags.id },
		);
	} catch (error) {
		throw createCampaignCommandError("Failed to read campaign stats", error);
	}
}

const campaignTypeOption = z.enum(["regular", "optin"]).default("regular");
const contentTypeOption = z
	.enum(["richtext", "html", "markdown", "plain", "visual"])
	.default("html");

function expectedUpdatedAtOption() {
	return option(z.string().trim().min(1).optional(), {
		description:
			"Campaign updated_at copied from the approving inspection or preflight",
	});
}

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
				status: option(z.string().trim().optional(), {
					description: "Status filter",
				}),
				query: option(z.string().trim().optional(), {
					description: "Search query",
				}),
				tags: option(z.string().trim().optional(), {
					description: "Comma-separated tags",
				}),
				order: option(z.enum(["ASC", "DESC"]).optional(), {
					description: "Sort order",
				}),
				"order-by": option(
					z.enum(["name", "status", "created_at", "updated_at"]).optional(),
					{ description: "Sort field" },
				),
				"no-body": option(z.boolean().optional(), {
					description: "Omit campaign body",
				}),
			},
			handler: handleListCampaignsCommand,
		}),
		defineCommand({
			name: "get",
			operationId: "campaigns.get",
			description: "Get campaign details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				"no-body": option(z.boolean().optional(), {
					description: "Omit campaign body",
				}),
			},
			handler: handleGetCampaignCommand,
		}),
		defineCommand({
			name: "create",
			operationId: "campaigns.create",
			description: "Create a campaign",
			options: {
				name: option(z.string().trim().min(1), { description: "Campaign name" }),
				"idempotency-key": option(
					z.string().trim().min(1).max(200).optional(),
					{
						description:
							"Caller-scoped create key; an identical retry with the same key replays the originally created campaign",
					},
				),
				subject: option(z.string().trim().min(1), {
					description: "Email subject",
				}),
				"from-email": option(z.string().trim().min(1), {
					description: "From email address",
				}),
				body: option(z.string().min(1), { description: "Campaign body" }),
				"body-source": option(z.string().optional(), {
					description:
						"Visual-editor source (JSON). Preserved so visual campaigns stay editable in the builder.",
				}),
				altbody: option(z.string().optional(), {
					description: "Plain-text alternative",
				}),
				type: option(campaignTypeOption, { description: "Campaign type" }),
				"template-id": option(z.union([z.literal("null"), z.string().regex(/^[1-9][0-9]*$/)]), {
					description:
						"Template ID (positive integer), or 'null' for template-less campaigns",
				}),
				lists: option(z.string().trim().min(1), {
					description: "Comma-separated list IDs",
				}),
				tags: option(z.string().trim().optional(), {
					description: "Comma-separated tags",
				}),
				messenger: option(z.string().trim().default("email"), {
					description: "Messenger",
				}),
				"content-type": option(contentTypeOption, {
					description: "Campaign content type",
				}),
				"send-at": option(z.string().optional(), {
					description: "Scheduled send time",
				}),
				headers: option(z.string().optional(), { description: "Headers JSON" }),
				attribs: option(z.string().optional(), {
					description: "Attributes JSON",
				}),
				archive: option(z.boolean().optional(), {
					description: "Archive campaign",
				}),
				"archive-slug": option(z.string().optional(), {
					description: "Archive slug",
				}),
				"archive-template-id": option(
					z.coerce.number().int().positive().optional(),
					{ description: "Archive template ID" },
				),
				"archive-meta": option(z.string().optional(), {
					description: "Archive metadata JSON",
				}),
				media: option(z.string().optional(), {
					description: "Comma-separated media IDs",
				}),
				subscribers: option(z.string().optional(), {
					description: "Comma-separated recipient emails",
				}),
			},
			handler: handleCreateCampaignCommand,
		}),
		defineCommand({
			name: "update",
			operationId: "campaigns.update",
			description: "Update a campaign",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				name: option(z.string().trim().min(1).optional(), {
					description: "Campaign name",
				}),
				subject: option(z.string().trim().min(1).optional(), {
					description: "Email subject",
				}),
				"from-email": option(z.string().trim().min(1).optional(), {
					description: "From email address",
				}),
				body: option(z.string().min(1).optional(), {
					description: "Campaign body",
				}),
				"body-source": option(z.string().optional(), {
					description:
						"Visual-editor source (JSON). Preserved so visual campaigns stay editable in the builder.",
				}),
				altbody: option(z.string().optional(), {
					description: "Plain-text alternative",
				}),
				type: option(z.enum(["regular", "optin"]).optional(), {
					description: "Campaign type",
				}),
				"template-id": option(z.union([z.literal("null"), z.string().regex(/^[1-9][0-9]*$/)]).optional(), {
					description:
						"Template ID (positive integer), or 'null' for template-less campaigns",
				}),
				lists: option(z.string().trim().optional(), {
					description: "Comma-separated list IDs",
				}),
				tags: option(z.string().trim().optional(), {
					description: "Comma-separated tags",
				}),
				messenger: option(z.string().trim().min(1).optional(), {
					description: "Messenger",
				}),
				"content-type": option(
					z.enum(["richtext", "html", "markdown", "plain", "visual"]).optional(),
					{ description: "Campaign content type" },
				),
				"send-at": option(z.string().optional(), {
					description: "Scheduled send time",
				}),
				headers: option(z.string().optional(), { description: "Headers JSON" }),
				attribs: option(z.string().optional(), {
					description: "Attributes JSON",
				}),
				archive: option(z.boolean().optional(), {
					description: "Archive campaign",
				}),
				"archive-slug": option(z.string().optional(), {
					description: "Archive slug",
				}),
				"archive-template-id": option(
					z.coerce.number().int().positive().optional(),
					{ description: "Archive template ID" },
				),
				"archive-meta": option(z.string().optional(), {
					description: "Archive metadata JSON",
				}),
				media: option(z.string().optional(), {
					description: "Comma-separated media IDs",
				}),
				subscribers: option(z.string().optional(), {
					description: "Comma-separated recipient emails",
				}),
			},
			handler: handleUpdateCampaignCommand,
		}),
		defineCommand({
			name: "delete",
			operationId: "campaigns.delete",
			description: "Delete a campaign",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
			},
			handler: handleDeleteCampaignCommand,
		}),
		defineCommand({
			name: "schedule",
			operationId: "campaigns.schedule",
			description: "Schedule a campaign to send at a specific time",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				"send-at": option(z.string().trim().min(1), {
					description:
						"ISO 8601 (or Listmonk-compatible) scheduled send timestamp",
				}),
				"expected-updated-at": expectedUpdatedAtOption(),
			},
			handler: handleScheduleCampaignCommand,
		}),
		defineCommand({
			name: "start",
			operationId: "campaigns.start",
			description: "Start a campaign (transition to running)",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				"expected-updated-at": expectedUpdatedAtOption(),
			},
			handler: handleStartCampaignCommand,
		}),
		defineCommand({
			name: "pause",
			operationId: "campaigns.pause",
			description: "Pause a running campaign",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				"expected-updated-at": expectedUpdatedAtOption(),
			},
			handler: handlePauseCampaignCommand,
		}),
		defineCommand({
			name: "cancel",
			operationId: "campaigns.cancel",
			description: "Cancel a campaign (terminal transition)",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				"expected-updated-at": expectedUpdatedAtOption(),
			},
			handler: handleCancelCampaignCommand,
		}),
		defineCommand({
			name: "clone",
			operationId: "campaigns.clone",
			description: "Clone an existing campaign under a new name",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Source campaign ID",
				}),
				name: option(z.string().trim().min(1), {
					description: "Name for the cloned campaign",
				}),
				"idempotency-key": option(
					z.string().trim().min(1).max(200).optional(),
					{
						description:
							"Caller-scoped clone key; an identical retry with the same key replays the originally cloned campaign",
					},
				),
			},
			handler: handleCloneCampaignCommand,
		}),
		defineCommand({
			name: "archive",
			operationId: "campaigns.archive",
			description:
				"Enable or disable the campaign's public archive page",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				archive: option(z.coerce.boolean(), {
					description: "Archive page state (true to enable)",
				}),
			},
			handler: handleArchiveCampaignCommand,
		}),
		defineCommand({
			name: "analytics",
			operationId: "campaigns.analytics",
			description:
				"Read view, click, link, or bounce analytics for campaigns over a date range",
			options: {
				type: option(
					z.enum(["views", "clicks", "links", "bounces"]),
					{ description: "Analytics facet to read" },
				),
				from: option(z.string().regex(CAMPAIGN_ANALYTICS_DATE), {
					description: "Range start (YYYY-MM-DD)",
				}),
				to: option(z.string().regex(CAMPAIGN_ANALYTICS_DATE), {
					description: "Range end (YYYY-MM-DD)",
				}),
				"campaign-ids": option(z.string().trim().min(1), {
					description: `Comma-separated campaign ids to aggregate (at most ${MAX_CAMPAIGN_ANALYTICS_IDS})`,
				}),
			},
			handler: handleCampaignAnalyticsCommand,
		}),
		defineCommand({
			name: "preview",
			operationId: "campaigns.preview",
			description: "Render the stored campaign body to HTML without sending",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
			},
			handler: handlePreviewCampaignCommand,
		}),
		defineCommand({
			name: "test",
			operationId: "campaigns.test",
			description:
				"Send the campaign as a test message to existing-subscriber emails",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
				subscribers: option(z.string().trim().min(3), {
					description:
						"Comma-separated emails of existing subscribers who receive the test message",
				}),
				subject: option(z.string().trim().min(1).optional(), {
					description: "Subject override for the test message",
				}),
				"template-id": option(z.coerce.number().int().positive().optional(), {
					description: "Template override for the test message",
				}),
				body: option(z.string().min(1).optional(), {
					description: "Body override for the test message",
				}),
				messenger: option(z.string().trim().min(1).optional(), {
					description: "Messenger override (defaults to the campaign's)",
				}),
				"from-email": option(z.string().trim().min(3).optional(), {
					description: "From address override for the test message",
				}),
			},
			handler: handleTestCampaignCommand,
		}),
		defineCommand({
			name: "stats",
			operationId: "campaigns.stats",
			description: "Read delivery stats for a campaign",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
			},
			handler: handleGetCampaignStatsCommand,
		}),
	],
});
