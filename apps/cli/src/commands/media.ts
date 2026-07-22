import { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeDeleteMediaOperation,
	invokeGetMediaFileOperation,
	invokeGetMediaOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type MediaOutput = Pick<typeof OutputUtils, "info" | "json" | "success" | "table">;

export interface MediaCliContext {
	client: Pick<ListmonkClient, "media">;
	output: MediaOutput;
}

export interface ListMediaInput {
	page?: number;
	per_page?: number;
}

export function createMediaCommandError(context: string, error: unknown): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderMedia(
	context: MediaCliContext,
	input: ListMediaInput,
): Promise<void> {
	const page = await invokeGetMediaOperation(context, input);
	if (page.results.length === 0) {
		context.output.info("No media files found");
		return;
	}
	context.output.table(page.results as Record<string, unknown>[]);
}

export async function renderMediaFile(
	context: MediaCliContext,
	input: { id: number },
): Promise<void> {
	context.output.json(await invokeGetMediaFileOperation(context, input));
}

export async function renderDeleteMedia(
	context: MediaCliContext,
	input: { id: number },
): Promise<void> {
	const result = await invokeDeleteMediaOperation(context, input);
	context.output.success(`Media file deleted: ${input.id}`);
	context.output.json(result);
}

type ListMediaCommandFlags = { page?: number; "per-page"?: number };

export async function handleListMediaCommand({
	flags,
	...args
}: HandlerArgs<ListMediaCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderMedia(
			{ client, output: OutputUtils },
			{ page: flags.page, per_page: flags["per-page"] },
		);
	} catch (error) {
		throw createMediaCommandError("Failed to list media", error);
	}
}

export async function handleGetMediaFileCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderMediaFile({ client, output: OutputUtils }, { id: flags.id });
	} catch (error) {
		throw createMediaCommandError("Failed to get media file", error);
	}
}

export async function handleDeleteMediaCommand({
	flags,
	...args
}: HandlerArgs<{ id: number }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderDeleteMedia({ client, output: OutputUtils }, { id: flags.id });
	} catch (error) {
		throw createMediaCommandError("Failed to delete media file", error);
	}
}

export default defineGroup({
	name: "media",
	description: "Manage uploaded media files",
	commands: [
		defineCommand({
			name: "list",
			operationId: "media.list",
			description: "List uploaded media files",
			options: {
				page: option(z.coerce.number().int().positive().optional(), {
					description: "Page number",
				}),
				"per-page": option(z.coerce.number().int().positive().optional(), {
					description: "Items per page",
				}),
			},
			handler: handleListMediaCommand,
		}),
		defineCommand({
			name: "get",
			operationId: "media.get",
			description: "Get uploaded media file details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Media file ID",
				}),
			},
			handler: handleGetMediaFileCommand,
		}),
		defineCommand({
			name: "delete",
			operationId: "media.delete",
			description: "Delete an uploaded media file",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Media file ID",
				}),
			},
			handler: handleDeleteMediaCommand,
		}),
	],
});
