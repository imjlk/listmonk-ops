import type { ResourceCreateIdempotencyStore } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindMediaDeleteOperationSpec,
	bindMediaGetOperationSpec,
	bindMediaListOperationSpec,
	bindMediaUploadOperationSpec,
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
	createResourceSafety,
	deleteResourceSafety,
	jsonResourceValue,
	normalizeResourceList,
	readResourceSafety,
	resourceIdSchema,
	toResourceErrorMessage,
	unwrapResourceResponse,
} from "./resource-helpers";
import { executeKeyedCreate } from "./keyed-create";
import { isDefinitivePreDispatchError } from "./transactional-idempotency";

export interface MediaOperationContext {
	client: Pick<ListmonkClient, "media">;
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

/**
 * MIME types Listmonk accepts for media uploads. We allowlist image and
 * common document types that Listmonk can embed in campaigns. Anything
 * executable or otherwise dangerous is rejected before the bytes hit the
 * API so callers do not waste a multipart round-trip on a rejection.
 *
 * Note: SVG is deliberately excluded. SVG uploads can carry embedded
 * scripts and Listmonk serves media from the same origin, so accepting
 * them would introduce a stored-XSS vector.
 */
export const ALLOWED_MEDIA_CONTENT_TYPES: ReadonlySet<string> = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"image/bmp",
	"image/tiff",
	"image/x-icon",
	"application/pdf",
	"text/plain",
	"text/csv",
]);

/**
 * Maximum media upload size (10 MiB). Listmonk's own cap depends on the
 * storage backend and is not documented; we enforce a conservative cap on
 * the client side so a single oversized upload does not pin the bulk
 * transport. Callers who genuinely need a higher cap can stream directly
 * through the OpenAPI client.
 */
export const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Best-effort filename → MIME inference for the cases where the caller
 * omits an explicit `content_type`. The allowlist still applies to the
 * inferred value, so an unknown extension resolves to `undefined` and the
 * upload is rejected.
 */
const FILENAME_EXTENSION_TO_MIME: Readonly<Record<string, string>> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	tif: "image/tiff",
	tiff: "image/tiff",
	ico: "image/x-icon",
	pdf: "application/pdf",
	txt: "text/plain",
	csv: "text/csv",
};

function inferContentTypeFromFilename(filename: string): string | undefined {
	const dot = filename.lastIndexOf(".");
	if (dot < 0 || dot === filename.length - 1) return undefined;
	const ext = filename.slice(dot + 1).toLowerCase();
	return FILENAME_EXTENSION_TO_MIME[ext];
}

/**
 * RFC 4648 base64 alphabet (standard `+/` and URL-safe `-_`) plus optional
 * padding. Used to reject malformed input up front because `atob` (and
 * Node's `Buffer.from(..., "base64")`) silently ignore characters outside
 * the alphabet, which would let corrupted payloads pass size/MIME checks.
 *
 * The pattern accepts either alphabet and even mixed alphabets in a single
 * string. Mixing is not strictly RFC-conformant, but the decoder below
 * normalizes URL-safe characters to the standard alphabet before calling
 * `atob`, so mixed input still decodes predictably rather than silently
 * corrupting. Stricter callers can canonicalize upstream if they need to
 * enforce a single variant.
 */
const BASE64_ALPHABET_PATTERN =
	/^[A-Za-z0-9+/_-]*={0,2}$/;

/**
 * Strip the optional `data:` URL prefix and inner whitespace/newlines from
 * a base64 payload. Used by both the schema validator (for size estimates)
 * and the decoder so the two never disagree on what counts as "trimmed".
 */
function stripBase64Wrapper(value: string): string {
	return value
		.replace(/^data:.*?;base64,/, "")
		.replace(/\s+/g, "");
}

/**
 * Decode a base64 string into a `Uint8Array` using only runtime-neutral
 * web-platform APIs (`atob`). `packages/operations` must not depend on
 * Node/Bun globals like `Buffer` so the same code runs in browsers and
 * other neutral runtimes. Returns `null` when the input is not valid
 * canonical base64.
 *
 * Accepts both the standard (`+`/`/`) and URL-safe (`-`/`_`) RFC 4648
 * alphabets. The URL-safe alphabet is normalized to the standard one
 * before calling `atob`, because the web-standard `atob` does not
 * recognize `-`/`_` and would otherwise reject valid URL-safe inputs in
 * the browser runtime.
 */
function decodeBase64ToBytes(value: string): Uint8Array | null {
	// Strip optional data: URL prefix and inner whitespace/newlines so we
	// do not reject legitimately encoded payloads that were wrapped for
	// readability, but require the remaining characters to be canonical
	// base64 (standard or URL-safe alphabet).
	const trimmed = stripBase64Wrapper(value);
	if (!BASE64_ALPHABET_PATTERN.test(trimmed)) return null;
	// Normalize URL-safe alphabet to standard so `atob` accepts it on every
	// runtime (it does not recognize `-`/`_` in browsers).
	let standard = trimmed.replaceAll("-", "+").replaceAll("_", "/");
	// Re-pad to a 4-byte boundary so unpadded base64 (e.g. `YQ`, common
	// from base64url emitters) is accepted. Length mod 4 of 1 is invalid
	// for any base64 variant and is rejected.
	const remainder = standard.length % 4;
	if (remainder === 1) return null;
	if (remainder === 2) standard += "==";
	else if (remainder === 3) standard += "=";
	try {
		const binary = atob(standard);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes;
	} catch {
		return null;
	}
}

const uploadMediaInputSchema = z
	.object({
		base64: z
			.string()
			.min(1)
			.describe("Base64-encoded file contents (RFC 4648)"),
		idempotency_key: z
			.string()
			.trim()
			.min(1)
			.max(200)
			.optional()
			.describe(
				"Caller-scoped upload key; an identical retry with the same key replays the originally uploaded media file instead of uploading a duplicate",
			),
		filename: z
			.string()
			.trim()
			.min(1)
			.describe("Filename to register with Listmonk"),
		content_type: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe(
				"MIME content type. When omitted, the operation infers it from the filename and still applies the allowlist.",
			),
	})
	.superRefine((input, ctx) => {
		// Reject an excessive RAW payload before stripping so a hostile
		// request cannot bury a small valid payload inside hundreds of MB
		// of whitespace or data-URL metadata. The cap is the encoded form
		// of MAX_MEDIA_UPLOAD_BYTES plus generous slack for padding,
		// data-URL prefix, and conventional 76-char base64 wrapping
		// (which adds ~184K LF characters for a 10 MiB file).
		const rawCap = Math.ceil((MAX_MEDIA_UPLOAD_BYTES * 4) / 3) + 1_000_000;
		if (input.base64.length > rawCap) {
			ctx.addIssue({
				code: "custom",
				path: ["base64"],
				message: `media upload raw payload exceeds ${rawCap} characters (decoded cap is ${MAX_MEDIA_UPLOAD_BYTES} bytes)`,
			});
			return;
		}
		// Reject oversized uploads from the encoded length alone so we never
		// allocate a full Uint8Array for a hostile hundreds-of-MiB payload.
		// Base64 expands bytes by ~4/3, so the encoded length (minus padding)
		// gives the decoded size. We subtract the padding character count so
		// a file whose decoded size is exactly the cap is not falsely
		// rejected by rounding slack.
		const stripped = stripBase64Wrapper(input.base64);
		let paddingCount = 0;
		if (stripped.endsWith("==")) {
			paddingCount = 2;
		} else if (stripped.endsWith("=")) {
			paddingCount = 1;
		}
		const encodedLength = stripped.length - paddingCount;
		const maxDecodedLength = Math.floor((encodedLength * 3) / 4);
		if (maxDecodedLength > MAX_MEDIA_UPLOAD_BYTES) {
			ctx.addIssue({
				code: "custom",
				path: ["base64"],
				message: `media upload exceeds the ${MAX_MEDIA_UPLOAD_BYTES}-byte cap (encoded length suggests ~${maxDecodedLength} bytes)`,
			});
			return;
		}
		const bytes = decodeBase64ToBytes(input.base64);
		if (bytes === null) {
			ctx.addIssue({
				code: "custom",
				path: ["base64"],
				message:
					"base64 must be a valid RFC 4648 base64 string (standard or URL-safe alphabet, optional padding)",
			});
			return;
		}
		if (bytes.length === 0) {
			ctx.addIssue({
				code: "custom",
				path: ["base64"],
				message:
					"base64 must decode to at least one byte of file content",
			});
			return;
		}
		if (bytes.length > MAX_MEDIA_UPLOAD_BYTES) {
			ctx.addIssue({
				code: "custom",
				path: ["base64"],
				message: `media upload exceeds the ${MAX_MEDIA_UPLOAD_BYTES}-byte cap (got ${bytes.length} bytes)`,
			});
		}
		// Always resolve a MIME type so the allowlist applies even when the
		// caller omits content_type. We reject both disallowed explicit
		// values and filenames whose extension does not map to an allowlist
		// entry.
		const effectiveContentType =
			input.content_type ?? inferContentTypeFromFilename(input.filename);
		if (
			effectiveContentType === undefined ||
			!ALLOWED_MEDIA_CONTENT_TYPES.has(effectiveContentType.toLowerCase())
		) {
			ctx.addIssue({
				code: "custom",
				path: ["content_type"],
				message: input.content_type !== undefined
					? `content_type '${input.content_type}' is not in the allowed media MIME set`
					: `could not infer an allowed MIME type from filename '${input.filename}'`,
			});
		}
		// When both an explicit content_type and a filename extension are
		// provided, they must agree. This prevents bypassing the SVG /
		// executable exclusion by setting content_type: 'image/png' on a
		// payload named 'evil.svg'. A filename with an extension that does
		// NOT map to any allowlisted MIME type is always rejected, because
		// it signals a dangerous type (svg, exe, html, etc.) hiding behind
		// a spoofed content_type.
		if (input.content_type !== undefined) {
			const inferred = inferContentTypeFromFilename(input.filename);
			const dot = input.filename.lastIndexOf(".");
			const hasExtension = dot >= 0 && dot !== input.filename.length - 1;
			if (inferred !== undefined) {
				if (inferred.toLowerCase() !== input.content_type.toLowerCase()) {
					ctx.addIssue({
						code: "custom",
						path: ["content_type"],
						message: `content_type '${input.content_type}' does not match filename extension (expected '${inferred}')`,
					});
				}
			} else if (hasExtension) {
				ctx.addIssue({
					code: "custom",
					path: ["content_type"],
					message: `filename extension '.${input.filename.slice(dot + 1)}' is not in the allowed media set and cannot be overridden by content_type`,
				});
			}
		}
	});

export type UploadMediaInput = z.output<typeof uploadMediaInputSchema>;

const mediaUploadOutputSchema = z.object({
	media: mediaFileSchema,
	created: z.boolean(),
});

export interface MediaUploadResult {
	media: z.output<typeof mediaFileSchema>;
	created: boolean;
}

/**
 * Upload a media file to Listmonk from base64-encoded contents. Decodes
 * the base64 payload, resolves the effective MIME type (explicit value or
 * inferred from the filename), and constructs a `File` so Listmonk
 * registers the upload under the caller's filename.
 */
/**
 * Canonical upload payload for idempotency hashing: the filename, the
 * effective MIME type, and the base64 content in its normalized standard
 * padded form, so equivalent encodings (data-URL prefixes, whitespace
 * wrapping, URL-safe alphabet, missing padding) hash identically.
 */
function canonicalMediaUploadPayload(
	input: z.output<typeof uploadMediaInputSchema>,
): Record<string, unknown> {
	// Canonicalize by the DECODED bytes re-encoded through the web-platform
	// encoder: string normalization alone preserves non-zero pad bits
	// (e.g. `YQ==` vs `YR==` both decode to 0x61), which would hash
	// equivalent uploads differently.
	const bytes = decodeBase64ToBytes(input.base64);
	const canonical = bytes !== null ? encodeBytesToBase64(bytes) : input.base64;
	return {
		filename: input.filename,
		// The schema accepts content_type case-insensitively, so the hash
		// must normalize the casing or an equivalent retry would conflict.
		content_type: (
			input.content_type ?? inferContentTypeFromFilename(input.filename) ?? ""
		).toLowerCase(),
		base64: canonical,
	};
}

/** Runtime-neutral base64 encoder over `btoa` (no `Buffer` global). */
function encodeBytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunkSize = 8192;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		const chunk = bytes.subarray(offset, offset + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

/**
 * Normalize a base64 payload to its canonical standard-alphabet padded
 * form (the exact string `decodeBase64ToBytes` decodes). Returns null for
 * inputs that are not valid base64; the schema's superRefine has already
 * rejected those by the time this runs.
 */
function normalizeBase64Payload(value: string): string | null {
	const trimmed = stripBase64Wrapper(value);
	if (!BASE64_ALPHABET_PATTERN.test(trimmed)) return null;
	let standard = trimmed.replaceAll("-", "+").replaceAll("_", "/");
	const remainder = standard.length % 4;
	if (remainder === 1) return null;
	if (remainder === 2) standard += "==";
	else if (remainder === 3) standard += "=";
	return standard;
}

/**
 * Correlate an accepted keyed upload that came back without a usable id to
 * the media file it produced. Filenames are not unique in Listmonk, so
 * binding is authorized only by immutable identity: the uploaded record's
 * `uuid` from the upload response matching exactly one listed media file.
 */
async function findMediaByUuid(
	client: Pick<ListmonkClient, "media">,
	createdUuid: string,
): Promise<MediaFileRecord | undefined> {
	const response = await client.media.list();
	const files = unwrapResourceResponse(response, "Failed to list media files");
	const correlated = (files.results ?? []).filter(
		(file) => file.uuid === createdUuid && file.id !== undefined,
	);
	const candidate = correlated[0];
	if (correlated.length === 1 && candidate !== undefined) {
		return candidate;
	}
	return undefined;
}

type MediaFileRecord = z.output<typeof mediaFileSchema>;

async function uploadMediaUnkeyed(
	client: Pick<ListmonkClient, "media">,
	input: z.output<typeof uploadMediaInputSchema>,
): Promise<MediaUploadResult> {
	// The schema's superRefine guarantees decode succeeds; re-derive the
	// bytes here using the runtime-neutral decoder (no `Buffer` global).
	const bytes = decodeBase64ToBytes(input.base64);
	if (bytes === null) {
		// Defensive: schema validation should have caught this already.
		throw new Error("media upload payload is not valid base64");
	}
	// Resolve the effective MIME type for the upload. The schema's
	// superRefine already verified this resolves to an allowlist entry;
	// we re-derive it here so Listmonk receives a concrete Content-Type
	// even when the caller omitted it.
	const effectiveContentType =
		input.content_type ?? inferContentTypeFromFilename(input.filename);
	// `File` (not `Blob`) carries the filename so Listmonk registers the
	// upload under the caller's chosen name rather than a generated one.
	// Cast to BlobPart: TypeScript's lib defaults the underlying buffer to
	// ArrayBufferLike, which technically includes SharedArrayBuffer, but
	// our decoder always produces a fresh Uint8Array backed by an
	// ArrayBuffer.
	const file = new File([bytes as BlobPart], input.filename, {
		type: effectiveContentType,
	});
	const response = await client.media.upload({ body: file });
	const uploaded = unwrapResourceResponse(
		response,
		"Failed to upload media file",
	);
	return { media: uploaded as MediaFileRecord, created: true };
}

export async function uploadMediaFile(
	{
		client,
		createIdempotencyStore,
		hashCreatePayload,
		target,
	}: MediaOperationContext,
	input: z.output<typeof uploadMediaInputSchema>,
): Promise<MediaUploadResult> {
	if (input.idempotency_key === undefined) {
		return uploadMediaUnkeyed(client, input);
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

	const bytes = decodeBase64ToBytes(input.base64);
	if (bytes === null) {
		// Defensive: schema validation should have caught this already.
		throw new Error("media upload payload is not valid base64");
	}
	const effectiveContentType =
		input.content_type ?? inferContentTypeFromFilename(input.filename);
	const file = new File([bytes as BlobPart], input.filename, {
		type: effectiveContentType ?? "application/octet-stream",
	});

	const result = await executeKeyedCreate<MediaFileRecord>({
		store: createIdempotencyStore,
		hashCreatePayload,
		target: { baseUrl: target.baseUrl, username: target.username },
		key: input.idempotency_key,
		resourceKind: "media",
		resourceLabel: "media upload",
		canonicalPayload: canonicalMediaUploadPayload(input),
		resourceIdOf: (media) =>
			media.id !== undefined ? String(media.id) : undefined,
		describeResource: (media) =>
			`id ${String(media.id ?? media.filename ?? "?")}`,
		replay: async (resourceId) => {
			const response = await client.media.getById({
				path: { id: Number(resourceId) },
			});
			try {
				return unwrapResourceResponse(
					response,
					`Failed to replay media file ${resourceId}`,
				) as MediaFileRecord;
			} catch (error) {
				throw new Error(
					`Idempotency replay could not load media file ${resourceId}: ${toResourceErrorMessage(error)}`,
					{ cause: error },
				);
			}
		},
		issue: async () => {
			let response: Awaited<ReturnType<typeof client.media.upload>>;
			try {
				response = await client.media.upload({ body: file });
			} catch (error) {
				return {
					failure: {
						error,
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
							`Failed to upload media file: ${toResourceErrorMessage(response.error)}`,
						),
						definitive: status !== undefined && status >= 400 && status < 500,
					},
				};
			}
			if (response.data?.id !== undefined) {
				return { resource: response.data as MediaFileRecord };
			}
			// No usable id: only immutable correlation may bind the key — a
			// filename match alone is never proof — so correlate the uploaded
			// record's uuid, when the response supplied one.
			if (response.data?.uuid !== undefined) {
				try {
					const correlated = await findMediaByUuid(
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
								`Keyed media upload was accepted but the uploaded record could not be re-read: ${toResourceErrorMessage(error)}`,
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
	return { media: result.resource, created: result.created };
}

export const getMediaOperation = defineOperation({
	id: "media.list",
	title: "List media",
	description: "Get uploaded media files from Listmonk",
	inputSchema: mediaListInputSchema,
	outputSchema: mediaListOutputSchema,
	safety: readResourceSafety,
	mcp: { name: "listmonk_get_media", legacySuccessText: jsonResourceValue },
	spec: bindMediaListOperationSpec(),
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
	spec: bindMediaGetOperationSpec(),
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
	spec: bindMediaDeleteOperationSpec(),
	execute: deleteMediaFile,
});

export const uploadMediaOperation = defineOperation({
	id: "media.upload",
	title: "Upload media file",
	description:
		"Upload a media file to Listmonk from base64-encoded contents. Validates an allowlist of MIME types and a 10 MiB size cap before sending.",
	inputSchema: uploadMediaInputSchema,
	outputSchema: mediaUploadOutputSchema,
	safety: createResourceSafety,
	mcp: {
		name: "listmonk_upload_media",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindMediaUploadOperationSpec(),
	execute: uploadMediaFile,
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

export async function invokeUploadMediaOperation(
	context: MediaOperationContext,
	input: unknown,
): Promise<z.output<typeof mediaUploadOutputSchema>> {
	const parsedInput = parseOperationInput(
		uploadMediaOperation.inputSchema,
		input,
	);
	let output: MediaUploadResult;
	try {
		output = await uploadMediaFile(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(uploadMediaOperation.id, error);
	}
	return parseOperationOutput(
		uploadMediaOperation.id,
		uploadMediaOperation.outputSchema,
		output,
	);
}

export const mediaOperations = [
	getMediaOperation,
	getMediaFileOperation,
	deleteMediaOperation,
	uploadMediaOperation,
] as const;

export const mediaOperationCatalog = defineOperationCatalog({
	id: "media",
	title: "Media",
	operations: mediaOperations,
	specMigrationExemptions: [],
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
		case uploadMediaOperation.mcp.name:
			return {
				operation: uploadMediaOperation,
				output: await invokeUploadMediaOperation(context, input),
			};
		default:
			return undefined;
	}
}
