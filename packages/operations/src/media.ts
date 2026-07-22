import type { ListmonkClient } from "@listmonk-ops/openapi";
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
	readResourceSafety,
	resourceIdSchema,
	unwrapResourceResponse,
} from "./resource-helpers";

export interface MediaOperationContext {
	client: Pick<ListmonkClient, "media">;
}

const mediaFileSchema = z.looseObject({
	id: z.number().int().positive().optional(),
	uuid: z.string().optional(),
	filename: z.string().optional(),
	content_type: z.string().optional(),
	created_at: z.string().optional(),
	thumb_url: z.string().optional(),
	thumb_uri: z.string().optional(),
	provider: z.string().optional(),
	meta: z.looseObject({}).optional(),
	url: z.string().optional(),
	uri: z.string().optional(),
});

const mediaListInputSchema = z.object({
	page: z.coerce.number().int().positive().default(1).describe("Page number"),
	per_page: z.coerce
		.number()
		.int()
		.positive()
		.default(20)
		.describe("Items per page"),
});

const mediaListOutputSchema = z.object({
	results: z.array(mediaFileSchema),
	total: z.number(),
	per_page: z.number(),
	page: z.number(),
});

const mediaIdInputSchema = z.object({
	id: resourceIdSchema,
});

const deleteMediaOutputSchema = z.object({
	id: z.number().int().positive(),
	deleted: z.boolean(),
});

export type MediaFile = z.output<typeof mediaFileSchema>;
export type MediaListPage = z.output<typeof mediaListOutputSchema>;

function asMediaFile(value: unknown): MediaFile {
	return value as MediaFile;
}

/**
 * Listmonk's media endpoint returns its complete collection rather than
 * accepting pagination query parameters. Keep that boundary detail here and
 * expose the same predictable page contract as the other shared resources.
 */
export async function listMedia(
	{ client }: MediaOperationContext,
	input: z.output<typeof mediaListInputSchema>,
): Promise<MediaListPage> {
	const response = await client.media.list();
	const data = unwrapResourceResponse(response, "Failed to fetch media");
	const normalized = normalizeResourceList(data, {
		page: 1,
		per_page: data.results?.length ?? 0,
	});
	const start = (input.page - 1) * input.per_page;

	return {
		results: normalized.results
			.slice(start, start + input.per_page)
			.map(asMediaFile),
		total: normalized.total,
		per_page: input.per_page,
		page: input.page,
	};
}

export async function getMediaFile(
	{ client }: MediaOperationContext,
	input: z.output<typeof mediaIdInputSchema>,
): Promise<MediaFile> {
	const response = await client.media.getById({ path: { id: input.id } });
	return asMediaFile(
		unwrapResourceResponse(response, "Failed to fetch media file"),
	);
}

export async function deleteMediaFile(
	{ client }: MediaOperationContext,
	input: z.output<typeof mediaIdInputSchema>,
): Promise<z.output<typeof deleteMediaOutputSchema>> {
	const response = await client.media.deleteById({ path: { id: input.id } });
	return {
		id: input.id,
		deleted: unwrapResourceResponse(response, "Failed to delete media file"),
	};
}

export const getMediaOperation = defineOperation({
	id: "media.list",
	title: "List media",
	description: "Get uploaded media files from Listmonk",
	inputSchema: mediaListInputSchema,
	outputSchema: mediaListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_media", legacySuccessText: jsonResourceValue },
	execute: listMedia,
});

export const getMediaFileOperation = defineOperation({
	id: "media.get",
	title: "Get media file",
	description: "Get an uploaded media file by ID",
	inputSchema: mediaIdInputSchema,
	outputSchema: mediaFileSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_media_file",
		legacySuccessText: jsonResourceValue,
	},
	execute: getMediaFile,
});

export const deleteMediaOperation = defineOperation({
	id: "media.delete",
	title: "Delete media file",
	description: "Delete an uploaded media file from Listmonk",
	inputSchema: mediaIdInputSchema,
	outputSchema: deleteMediaOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_delete_media",
		legacySuccessText: "Media file deleted successfully",
	},
	execute: deleteMediaFile,
});

export async function invokeGetMediaOperation(
	context: MediaOperationContext,
	input: unknown,
): Promise<MediaListPage> {
	const parsedInput = parseOperationInput(getMediaOperation.inputSchema, input);
	let output: MediaListPage;
	try {
		output = await listMedia(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getMediaOperation.id, error);
	}
	return parseOperationOutput(
		getMediaOperation.id,
		getMediaOperation.outputSchema,
		output,
	);
}

export async function invokeGetMediaFileOperation(
	context: MediaOperationContext,
	input: unknown,
): Promise<MediaFile> {
	const parsedInput = parseOperationInput(
		getMediaFileOperation.inputSchema,
		input,
	);
	let output: MediaFile;
	try {
		output = await getMediaFile(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(getMediaFileOperation.id, error);
	}
	return parseOperationOutput(
		getMediaFileOperation.id,
		getMediaFileOperation.outputSchema,
		output,
	);
}

export async function invokeDeleteMediaOperation(
	context: MediaOperationContext,
	input: unknown,
): Promise<z.output<typeof deleteMediaOutputSchema>> {
	const parsedInput = parseOperationInput(
		deleteMediaOperation.inputSchema,
		input,
	);
	let output: z.output<typeof deleteMediaOutputSchema>;
	try {
		output = await deleteMediaFile(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(deleteMediaOperation.id, error);
	}
	return parseOperationOutput(
		deleteMediaOperation.id,
		deleteMediaOperation.outputSchema,
		output,
	);
}

export const mediaOperations = [
	getMediaOperation,
	getMediaFileOperation,
	deleteMediaOperation,
] as const;

export const mediaOperationCatalog = defineOperationCatalog({
	id: "media",
	title: "Media",
	operations: mediaOperations,
});

export type MediaOperation = (typeof mediaOperations)[number];

const mediaOperationsByMcpName = new Map<string, MediaOperation>(
	mediaOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getMediaOperationByMcpName(
	name: string,
): MediaOperation | undefined {
	return mediaOperationsByMcpName.get(name);
}

export interface MediaOperationInvocation {
	operation: MediaOperation;
	output: Record<string, unknown>;
}

export async function invokeMediaOperationByMcpName(
	context: MediaOperationContext,
	name: string,
	input: unknown,
): Promise<MediaOperationInvocation | undefined> {
	switch (name) {
		case getMediaOperation.mcp.name:
			return {
				operation: getMediaOperation,
				output: await invokeGetMediaOperation(context, input),
			};
		case getMediaFileOperation.mcp.name:
			return {
				operation: getMediaFileOperation,
				output: await invokeGetMediaFileOperation(context, input),
			};
		case deleteMediaOperation.mcp.name:
			return {
				operation: deleteMediaOperation,
				output: await invokeDeleteMediaOperation(context, input),
			};
		default:
			return undefined;
	}
}
