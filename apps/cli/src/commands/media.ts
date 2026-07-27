import type { OutputUtils } from "@listmonk-ops/common";
import { getOutput } from "../lib/output";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeDeleteMediaOperation,
	invokeGetMediaFileOperation,
	invokeGetMediaOperation,
	invokeUploadMediaOperation,
	MAX_MEDIA_UPLOAD_BYTES,
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

export async function renderUploadMedia(
	context: MediaCliContext,
	input: {
		base64: string;
		filename: string;
		content_type?: string;
	},
): Promise<void> {
	const uploaded = await invokeUploadMediaOperation(context, input);
	context.output.success(
		`Media file uploaded: ${uploaded.filename ?? input.filename}`,
	);
	context.output.json(uploaded);
}

type ListMediaCommandFlags = { page?: number; "per-page"?: number };

export async function handleListMediaCommand({
	flags,
	...args
}: HandlerArgs<ListMediaCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderMedia(
			{ client, output: getOutput() },
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
		await renderMediaFile({ client, output: getOutput() }, { id: flags.id });
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
		await renderDeleteMedia({ client, output: getOutput() }, { id: flags.id });
	} catch (error) {
		throw createMediaCommandError("Failed to delete media file", error);
	}
}

export async function handleUploadMediaCommand({
	flags,
	...args
}: HandlerArgs<{ file: string; "content-type"?: string }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		const file = Bun.file(flags.file);
		// Bun.file() does not throw when the path is missing — it returns a
		// File whose later reads fail. Probe existence explicitly so we can
		// surface a clear "not found" message before size checks.
		if (!(await file.exists())) {
			throw new Error(`File not found: ${flags.file}`);
		}
		// Bun.file exposes size lazily without reading the file, so we can
		// reject oversized uploads before pulling the bytes into memory.
		if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
			const capMiB =
				Math.round((MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024)) * 10) / 10;
			throw new Error(
				`File ${flags.file} is ${file.size} bytes, which exceeds the ${capMiB} MiB media upload cap`,
			);
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		const base64 = Buffer.from(bytes).toString("base64");
		// Use the basename only — Bun.file().name returns the path as given
		// on the command line, which may include directories that Listmonk
		// would reject as part of a filename. Fall back to a literal
		// 'upload' when the path is a bare separator.
		const basename = flags.file.split(/[\\/]/).pop();
		const filename = basename && basename.length > 0 ? basename : "upload";
		await renderUploadMedia(
				{ client, output: getOutput() },
				{
					base64,
					filename,
					// Strip MIME parameters (e.g. `text/plain;charset=utf-8`
					// from Bun.file) so the shared operation's allowlist and
					// extension-consistency check see a bare MIME type.
					content_type:
						(flags["content-type"] || file.type || undefined)?.split(";")[0],
			},
		);
	} catch (error) {
		throw createMediaCommandError("Failed to upload media file", error);
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
		defineCommand({
			name: "upload",
			operationId: "media.upload",
			description: "Upload a media file from a local path",
			options: {
				file: option(z.string().trim().min(1), {
					description: "Path to the media file to upload",
					fileType: "path",
				}),
				"content-type": option(z.string().trim().min(1).optional(), {
					description:
						"MIME content type override (inferred from the file when omitted)",
				}),
			},
			handler: handleUploadMediaCommand,
		}),
	],
});
