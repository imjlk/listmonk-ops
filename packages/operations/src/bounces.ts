import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindBouncesDeleteOperationSpec,
	bindBouncesGetOperationSpec,
	bindBouncesListOperationSpec,
	bindBouncesPruneOperationSpec,
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
	deleteResourceSafety,
	jsonResourceValue,
	normalizeResourceList,
	optionalBooleanSchema,
	readResourceSafety,
	requireAcknowledgement,
	ResourceResponseError,
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

const bounceDeleteOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

/**
 * Cap on the echoed id set a destructive prune accepts. Mirrors the shared
 * dispatch limit: one bounded, previewed batch per confirmed run.
 */
export const MAX_BOUNCE_PRUNE_IDS = 100;

const bouncePruneSelectionSchema = z.object({
	page: z.coerce.number().int().positive().default(1).describe("Page number"),
	per_page: z.coerce
		.number()
		.int()
		.positive()
		.max(MAX_BOUNCE_PRUNE_IDS)
		.default(MAX_BOUNCE_PRUNE_IDS)
		.describe("Selection window size (at most 100)"),
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

const bouncePruneInputSchema = bouncePruneSelectionSchema
	.extend({
		dry_run: optionalBooleanSchema
			.default(true)
			.describe(
				"Preview the deletion instead of performing it (defaults to true)",
			),
		bounce_ids: z
			.array(resourceIdSchema)
			.min(1)
			.max(MAX_BOUNCE_PRUNE_IDS)
			.optional()
			.describe(
				"The exact bounce ids a dry run reported; required for a destructive run so the confirmed deletion never drifts from the previewed set",
			),
	})
	.superRefine((input, ctx) => {
		if (input.dry_run) return;
		if (input.bounce_ids === undefined || input.bounce_ids.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["bounce_ids"],
				message:
					"bounce_ids is required for a destructive prune; echo the ids a dry run reported",
			});
		}
	});

const bouncePruneOutputSchema = z.object({
	dry_run: z.boolean(),
	bounce_ids: z.array(z.number().int().positive()),
	/** Selection-window metadata; present on dry-run previews. */
	total: z.number().nonnegative().optional(),
	page: z.number().optional(),
	per_page: z.number().optional(),
	/** Per-id acknowledgement count; present on destructive runs. */
	acknowledged: z.number().int().nonnegative().optional(),
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
			// Classify like a transport-level missing resource so direct
			// callers can use isResourceMissingError on both paths.
			throw new ResourceResponseError(`Bounce ${id} not found`, {
				status: 404,
			});
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
		page: input.page,
		per_page: input.per_page,
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

/**
 * Listmonk acknowledges a single-bounce delete with a bare boolean and
 * answers an already-deleted ID with the same success, so the output
 * reports the acknowledgement. The confirmation that a record is really
 * gone comes from a follow-up bounces.list read.
 */
export async function deleteBounce(
	{ client }: BounceOperationContext,
	input: z.output<typeof bounceIdInputSchema>,
): Promise<z.output<typeof bounceDeleteOutputSchema>> {
	const response = await client.bounce.deleteById({ path: { id: input.id } });
	requireAcknowledgement(response, "Failed to delete bounce");
	return { id: input.id, deleted: true };
}

/**
 * Preview or delete one bounded batch of bounce records. The dry run
 * reports the exact ids of its selection window; a destructive run echoes
 * that set as `bounce_ids`. Because Listmonk's bulk endpoint rejects any
 * request naming a missing id (deleting nothing), the destructive run is
 * issued as per-id deletes whose missing-id acknowledgement is the same
 * success — so an echoed retry converges instead of failing the whole
 * batch. Acknowledgements are not existence proofs: verify the surviving
 * set with bounces.list.
 */
export async function pruneBounces(
	{ client }: BounceOperationContext,
	input: z.output<typeof bouncePruneInputSchema>,
): Promise<z.output<typeof bouncePruneOutputSchema>> {
	if (input.dry_run) {
		const page = await listBounces(
			{ client },
			{
				page: input.page,
				per_page: input.per_page,
				campaign_id: input.campaign_id,
				source: input.source,
				order_by: input.order_by,
				order: input.order,
			},
		);
		return {
			dry_run: true,
			bounce_ids: page.results
				.map((bounce) => bounce.id)
				.filter((id): id is number => id !== undefined),
			total: page.total,
			page: page.page,
			per_page: page.per_page,
		};
	}

	const bounceIds = [...new Set(input.bounce_ids ?? [])].sort((a, b) => a - b);
	for (const id of bounceIds) {
		const response = await client.bounce.deleteById({ path: { id } });
		requireAcknowledgement(response, `Failed to delete bounce ${id}`);
	}
	return {
		dry_run: false,
		bounce_ids: bounceIds,
		acknowledged: bounceIds.length,
	};
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

export const deleteBounceOperation = defineOperation({
	id: "bounces.delete",
	title: "Delete bounce",
	description: "Delete a recorded bounce event by its numeric ID",
	inputSchema: bounceIdInputSchema,
	outputSchema: bounceDeleteOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_delete_bounce",
		legacySuccessText: "Bounce deleted successfully",
	},
	spec: bindBouncesDeleteOperationSpec(),
	execute: deleteBounce,
});

export const pruneBouncesOperation = defineOperation({
	id: "bounces.prune",
	title: "Prune bounce records",
	description:
		"Preview or delete a bounded selection of bounce records. Destructive runs echo the exact bounce ids a dry run reported, so a retry deletes nothing new.",
	inputSchema: bouncePruneInputSchema,
	outputSchema: bouncePruneOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_prune_bounces", legacySuccessText: jsonResourceValue },
	spec: bindBouncesPruneOperationSpec(),
	execute: pruneBounces,
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

export async function invokeDeleteBounceOperation(
	context: BounceOperationContext,
	input: unknown,
): Promise<z.output<typeof bounceDeleteOutputSchema>> {
	const parsedInput = parseOperationInput(
		deleteBounceOperation.inputSchema,
		input,
	);
	let output: z.output<typeof bounceDeleteOutputSchema>;
	try {
		output = await deleteBounce(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(deleteBounceOperation.id, error);
	}
	return parseOperationOutput(
		deleteBounceOperation.id,
		deleteBounceOperation.outputSchema,
		output,
	);
}

export async function invokePruneBouncesOperation(
	context: BounceOperationContext,
	input: unknown,
): Promise<z.output<typeof bouncePruneOutputSchema>> {
	const parsedInput = parseOperationInput(
		pruneBouncesOperation.inputSchema,
		input,
	);
	let output: z.output<typeof bouncePruneOutputSchema>;
	try {
		output = await pruneBounces(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(pruneBouncesOperation.id, error);
	}
	return parseOperationOutput(
		pruneBouncesOperation.id,
		pruneBouncesOperation.outputSchema,
		output,
	);
}

export const bouncesOperations = [
	listBouncesOperation,
	getBounceOperation,
	deleteBounceOperation,
	pruneBouncesOperation,
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
		case deleteBounceOperation.mcp.name:
			return {
				operation: deleteBounceOperation,
				output: await invokeDeleteBounceOperation(context, input),
			};
		case pruneBouncesOperation.mcp.name:
			return {
				operation: pruneBouncesOperation,
				output: await invokePruneBouncesOperation(context, input),
			};
		default:
			return undefined;
	}
}
