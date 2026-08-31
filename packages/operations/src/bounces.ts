import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindBouncesGetOperationSpec,
	bindBouncesListOperationSpec,
} from "./specs";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	jsonResourceValue,
	normalizeResourceList,
	readResourceSafety,
	resourceIdSchema,
	unwrapResourceResponse,
} from "./resource-helpers";

export interface BounceOperationContext {
	client: Pick<ListmonkClient, "bounce">;
}

const bounceCampaignSchema = z.looseObject({
	id: z.number().int().positive().optional(),
	name: z.string().optional(),
});

/**
 * A Listmonk bounce record as observed from the 6.2 API. The generated
 * upstream type misses `subscriber_status` and carries a stray `total`
 * inherited from the collection schema, so this schema follows observed
 * responses and stays loose for fields added by newer Listmonk releases.
 */
const bounceRecordSchema = z.looseObject({
	id: z.number().int().positive().optional(),
	type: z.string().optional(),
	source: z.string().optional(),
	meta: z.looseObject({}).optional(),
	created_at: z.string().optional(),
	email: z.string().optional(),
	subscriber_uuid: z.string().optional(),
	subscriber_id: z.number().int().positive().optional(),
	subscriber_status: z.string().optional(),
	campaign: bounceCampaignSchema.optional(),
});

const bounceListInputSchema = z.object({
	page: z.coerce.number().int().positive().default(1).describe("Page number"),
	per_page: z.coerce
		.number()
		.int()
		.positive()
		.default(20)
		.describe("Items per page"),
	campaign_id: resourceIdSchema
		.optional()
		.describe("Filter bounces by campaign ID"),
	source: z.string().trim().min(1).optional().describe("Filter by bounce source"),
	order_by: z
		.enum(["email", "campaign_name", "source", "created_at"])
		.optional()
		.describe("Sort field applied by Listmonk"),
	order: z.enum(["asc", "desc"]).optional().describe("Sort direction"),
});

const bounceListOutputSchema = z.object({
	results: z.array(bounceRecordSchema),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

const bounceIdInputSchema = z.object({
	id: resourceIdSchema,
});

export type BounceRecord = z.output<typeof bounceRecordSchema>;
export type BounceListPage = z.output<typeof bounceListOutputSchema>;
export type BounceListInput = z.output<typeof bounceListInputSchema>;

function asBounceRecord(value: unknown): BounceRecord {
	return value as BounceRecord;
}

/**
 * Normalize a single-bounce response payload. Observed Listmonk 6.2
 * responses return the record flat, while the upstream OpenAPI document
 * models the endpoint with the collection schema; tolerate both shapes at
 * this boundary instead of distorting the generated SDK types.
 */
function normalizeBounceRecordPayload(value: unknown, id: number): unknown {
	if (
		value !== null &&
		typeof value === "object" &&
		Array.isArray((value as { results?: unknown }).results)
	) {
		const first = (value as { results: unknown[] }).results[0];
		if (first === undefined) {
			throw new Error(`Bounce ${id} not found`);
		}
		return first;
	}
	return value;
}

/**
 * Listmonk paginates `/api/bounces` server-side and echoes the applied
 * page window back, so the shared contract forwards the caller's filters
 * verbatim and normalizes only the envelope.
 */
export async function listBounces(
	{ client }: BounceOperationContext,
	input: BounceListInput,
): Promise<BounceListPage> {
	const response = await client.bounce.list({
		page: input.page,
		per_page: input.per_page,
		...(input.campaign_id !== undefined && { campaign_id: input.campaign_id }),
		...(input.source !== undefined && { source: input.source }),
		...(input.order_by !== undefined && { order_by: input.order_by }),
		...(input.order !== undefined && { order: input.order }),
	});
	const data = unwrapResourceResponse(response, "Failed to fetch bounces");
	const normalized = normalizeResourceList(data, {
		page: 1,
		per_page: 20,
	});
	return {
		results: normalized.results.map(asBounceRecord),
		total: normalized.total,
		per_page: normalized.per_page,
		page: normalized.page,
	};
}

export async function getBounce(
	{ client }: BounceOperationContext,
	input: z.output<typeof bounceIdInputSchema>,
): Promise<BounceRecord> {
	const response = await client.bounce.getById({ path: { id: input.id } });
	const data = unwrapResourceResponse(response, "Failed to fetch bounce");
	return asBounceRecord(normalizeBounceRecordPayload(data, input.id));
}

export const listBouncesOperation = defineOperation({
	id: "bounces.list",
	title: "List bounces",
	description:
		"Get recorded bounce events from Listmonk with optional campaign, source, and ordering filters",
	inputSchema: bounceListInputSchema,
	outputSchema: bounceListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_bounces", legacySuccessText: jsonResourceValue },
	spec: bindBouncesListOperationSpec(),
	execute: listBounces,
});

export const getBounceOperation = defineOperation({
	id: "bounces.get",
	title: "Get bounce",
	description: "Get a recorded bounce event by its numeric ID",
	inputSchema: bounceIdInputSchema,
	outputSchema: bounceRecordSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_bounce", legacySuccessText: jsonResourceValue },
	spec: bindBouncesGetOperationSpec(),
	execute: getBounce,
});

export async function invokeListBouncesOperation(
	context: BounceOperationContext,
	input: unknown,
): Promise<BounceListPage> {
	const parsedInput = parseOperationInput(
		listBouncesOperation.inputSchema,
		input,
	);
	let output: BounceListPage;
	try {
		output = await listBounces(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(listBouncesOperation.id, error);
	}
	return parseOperationOutput(
		listBouncesOperation.id,
		listBouncesOperation.outputSchema,
		output,
	);
}

export async function invokeGetBounceOperation(
	context: BounceOperationContext,
	input: unknown,
): Promise<BounceRecord> {
	const parsedInput = parseOperationInput(
		getBounceOperation.inputSchema,
		input,
	);
	let output: BounceRecord;
	try {
		output = await getBounce(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getBounceOperation.id, error);
	}
	return parseOperationOutput(
		getBounceOperation.id,
		getBounceOperation.outputSchema,
		output,
	);
}

export const bouncesOperations = [
	listBouncesOperation,
	getBounceOperation,
] as const;

export const bouncesOperationCatalog = defineOperationCatalog({
	id: "bounces",
	title: "Bounces",
	operations: bouncesOperations,
	specMigrationExemptions: [],
});

export type BouncesOperation = (typeof bouncesOperations)[number];

const bouncesOperationsByMcpName = new Map<string, BouncesOperation>(
	bouncesOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getBouncesOperationByMcpName(
	name: string,
): BouncesOperation | undefined {
	return bouncesOperationsByMcpName.get(name);
}

export interface BouncesOperationInvocation {
	operation: BouncesOperation;
	output: Record<string, unknown>;
}

export async function invokeBouncesOperationByMcpName(
	context: BounceOperationContext,
	name: string,
	input: unknown,
): Promise<BouncesOperationInvocation | undefined> {
	switch (name) {
		case listBouncesOperation.mcp.name:
			return {
				operation: listBouncesOperation,
				output: await invokeListBouncesOperation(context, input),
			};
		case getBounceOperation.mcp.name:
			return {
				operation: getBounceOperation,
				output: await invokeGetBounceOperation(context, input),
			};
		default:
			return undefined;
	}
}
