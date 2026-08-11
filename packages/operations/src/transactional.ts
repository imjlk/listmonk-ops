import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindTransactionalSendOperationSpec,
	operationSpecMigrationExemptionsByFamily,
} from "./specs";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	OperationInputError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	computeTransactionalTargetHash,
	isDefinitivePreDispatchError,
	serializeTransactionalPayload,
	TransactionalReconcileError,
	type TransactionalIdempotencyStore,
	type TransactionalSendRecord,
} from "./transactional-idempotency";

export interface TransactionalOperationContext {
	client: Pick<ListmonkClient, "transactional">;
	/**
	 * Adapter-supplied idempotency store. When absent, `idempotency_key` is
	 * rejected as unsupported on this surface. CLI and MCP inject a
	 * file-backed implementation; other consumers can inject an in-memory
	 * one for tests.
	 */
	idempotencyStore?: TransactionalIdempotencyStore;
	/**
	 * Hash function the adapter uses to derive a stable payload digest
	 * (e.g. SHA-256 via `node:crypto`). Paired with `idempotencyStore` so
	 * the operations package itself stays runtime-neutral.
	 */
	hashPayload?: (serialized: string) => string;
	/**
	 * Optional Listmonk target identity used to namespace idempotency records.
	 * Adapters must pass the resolved baseUrl + username so records scoped to
	 * staging cannot replay against production.
	 */
	target?: {
		baseUrl?: string;
		username?: string;
	};
}

type DataResponse<T> = {
	data?: T;
	error?: unknown;
	// OpenAPI client includes the underlying Response on error envelopes so
	// callers can inspect the HTTP status (e.g. 401/403/404) without it
	// being reduced to a plain Error message.
	response?: { status?: number };
};

/**
 * Error raised when Listmonk returns a non-2xx response. Carries the HTTP
 * status so the idempotency wrapper can distinguish a definitive
 * pre-dispatch rejection (4xx — credentials, routing, validation) from an
 * ambiguous transport failure (5xx, parse error) without relying on the
 * error message text.
 */
class TransactionalDispatchError extends Error {
	public readonly httpStatus: number | undefined;
	public constructor(
		message: string,
		httpStatus?: number,
		cause?: unknown,
	) {
		super(message, cause !== undefined ? { cause } : undefined);
		this.name = "TransactionalDispatchError";
		this.httpStatus = httpStatus;
	}
}

const positiveIdSchema = z.number().int().positive();
const positiveIdInputSchema = z.codec(
	z.union([positiveIdSchema, z.string().regex(/^[1-9][0-9]*$/)]),
	positiveIdSchema,
	{
		decode: (value) => Number(value),
		encode: (value) => value,
	},
);

/**
 * Header names that Listmonk or the SMTP transport sets on every message.
 * Callers cannot override these through the transactional `headers` field.
 */
const PROTECTED_HEADER_NAMES = new Set([
	"from",
	"to",
	"cc",
	"bcc",
	"reply-to",
	"subject",
	"content-type",
	"content-length",
	"content-transfer-encoding",
	"mime-version",
	"date",
	"message-id",
]);

/**
 * Intentionally restrictive allowlist for custom header field-names.
 * Uses the RFC 5322 §3.2.3 `atext` character set (originally defined for
 * email local-parts) plus `.`, which together cover all common custom
 * header conventions (e.g. `X-Mailer`, `X-MyApp.Version`). This is stricter
 * than RFC 5322 `ftext` (which allows most printable ASCII), but the
 * tighter surface reduces the risk of injection through obscure characters.
 */
const HEADER_NAME_PATTERN = /^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/;
const HEADER_CONTROL_CHAR_PATTERN = /[\0\x01-\x1f\x7f]/;

export const transactionalSubjectSchema = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) => !HEADER_CONTROL_CHAR_PATTERN.test(value),
		"Subject must not contain ASCII control characters (including CR, LF, and NUL)",
	);

interface HeaderIssue {
	path: Array<string | number>;
	message: string;
}

function collectHeaderIssues(
	headers: Array<Record<string, string>>,
): HeaderIssue[] {
	const issues: HeaderIssue[] = [];
	for (const [entryIndex, entry] of headers.entries()) {
		for (const [rawName, rawValue] of Object.entries(entry)) {
			const name = rawName.trim();
			const path: Array<string | number> = ["headers", entryIndex, name];
			// Reject non-canonical raw names up front. Without this check the
			// validated `name` would diverge from the `rawName` we forward
			// to Listmonk, and a smuggled value like `"\r\nX-Trace"` would
			// pass validation as `X-Trace` while the transport still saw the
			// malformed key.
			if (rawName !== name) {
				issues.push({
					path,
					message:
						"Header names must not contain leading or trailing whitespace",
				});
				continue;
			}
			if (name.length === 0) {
				issues.push({ path, message: "Header name must not be empty" });
				continue;
			}
			if (!HEADER_NAME_PATTERN.test(name)) {
				issues.push({
					path,
					message: `Header name '${name}' must contain only RFC 5322 atext characters (letters, digits, and .!#$%&'*+-/=?^_\`{|}~)`,
				});
				continue;
			}
			if (PROTECTED_HEADER_NAMES.has(name.toLowerCase())) {
				issues.push({
					path,
					message: `Header '${name}' is reserved and cannot be set through the transactional headers field`,
				});
				continue;
			}
			if (HEADER_CONTROL_CHAR_PATTERN.test(rawValue)) {
				issues.push({
					path,
					message: `Header '${name}' value must not contain ASCII control characters (including CR, LF, and NUL)`,
				});
			}
		}
	}
	return issues;
}

/**
 * Allowlist for `idempotency_key`. Conservative printable subset that is
 * safe to use as both a JSON object key and a filename fragment if the
 * store path is ever derived from the key. Matches common client-side
 * idempotency conventions (Stripe-style, UUID, slug).
 *
 * Exported so CLI/MCP adapters reuse the same contract instead of
 * re-declaring the pattern and drifting from the operation schema.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]+$/;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

const idempotencyKeyBaseSchema = z
	.string()
	.trim()
	.min(1)
	.max(IDEMPOTENCY_KEY_MAX_LENGTH)
	.regex(
		IDEMPOTENCY_KEY_PATTERN,
		"idempotency_key must contain only letters, digits, and . _ : - characters",
	);

export const idempotencyKeySchema = idempotencyKeyBaseSchema
	.optional()
	.describe(
		"Optional client-supplied idempotency key. When set, a retry with the same key and payload replays the original result instead of re-sending. Different payload with the same key is rejected as a conflict.",
	);

const sendTransactionalInputSchema = z
	.object({
		template_id: positiveIdInputSchema.describe("Transactional template ID"),
		subscriber_email: z
			.string()
			.trim()
			.email()
			.optional()
			.describe("Recipient subscriber email"),
		subscriber_id: positiveIdInputSchema
			.optional()
			.describe("Recipient subscriber ID"),
		from_email: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe("From email header value"),
		data: z
			.record(z.string(), z.unknown())
			.optional()
			.describe("Template variables"),
		headers: z
			.array(z.record(z.string(), z.string()))
			.optional()
			.describe("Additional email headers"),
		content_type: z
			.enum(["html", "markdown", "plain"])
			.optional()
			.describe("Message content type"),
		messenger: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe("Listmonk messenger name"),
		subject: transactionalSubjectSchema
			.optional()
			.describe("Message subject override"),
		altbody: z
			.string()
			.min(1)
			.optional()
			.describe("Plain-text alternative for multipart HTML email"),
		idempotency_key: idempotencyKeySchema,
	})
	.refine(
		(input) =>
			(input.subscriber_email !== undefined) !==
			(input.subscriber_id !== undefined),
		{
			message:
				"Exactly one of subscriber_email or subscriber_id is required (provide one, not both)",
		},
	)
	.superRefine((input, ctx) => {
		if (input.headers === undefined) return;
		const issues = collectHeaderIssues(input.headers);
		for (const issue of issues) {
			ctx.addIssue({
				code: "custom",
				path: issue.path,
				message: issue.message,
			});
		}
	});

/**
 * Result status reported back to the caller.
 *
 * - `accepted`  — Listmonk accepted the message (`sent: true`) or, when no
 *                 idempotency key was supplied, the request completed without
 *                 a negative acknowledgement.
 * - `replayed`  — A prior send with the same key was replayed. `duplicate`
 *                 is `true` and Listmonk was not called again.
 * - `failed`    — Listmonk returned a negative acknowledgement
 *                 (`sent: false`).
 */
const sendTransactionalStatusSchema = z.enum([
	"accepted",
	"replayed",
	"failed",
]);

const sendTransactionalOutputSchema = z
	.object({
		sent: z.boolean().describe("Whether Listmonk accepted the message"),
		status: sendTransactionalStatusSchema.describe(
			"Outcome of the send: accepted (freshly dispatched), replayed (idempotency hit, not re-dispatched), or failed (Listmonk rejected)",
		),
		duplicate: z
			.boolean()
			.optional()
			.describe("True when the result was replayed from an idempotency record"),
		idempotency_key: idempotencyKeyBaseSchema
			.optional()
			.describe("Echoed back when an idempotency key was supplied"),
		expires_at: z
			.iso.datetime()
			.optional()
			.describe(
				"ISO timestamp after which the idempotency record expires. Present when an idempotency key was supplied.",
			),
	});

export type SendTransactionalInput = z.input<
	typeof sendTransactionalInputSchema
>;
export type SendTransactionalOutput = z.output<
	typeof sendTransactionalOutputSchema
>;

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === "object") {
		if ("message" in error && typeof error.message === "string") {
			return error.message;
		}
		if ("error" in error && typeof error.error === "string") {
			return error.error;
		}
		try {
			return JSON.stringify(error);
		} catch {
			// Fall through to String conversion for non-serializable values.
		}
	}
	return String(error);
}

function unwrapData<T>(response: DataResponse<T>, context: string): T {
	if (response.error !== undefined) {
		const status =
			typeof response.response?.status === "number"
				? response.response.status
				: undefined;
		// Preserve the original error as the cause so structured transport
		// codes (error.code, error.cause.code) remain reachable for
		// isDefinitivePreDispatchError. Without this, Bun's fetch errors
		// (code: "ConnectionRefused", not in the message) would be lost and
		// a definitive pre-dispatch outage would be misclassified as unknown.
		const cause = response.error instanceof Error ? response.error : undefined;
		throw new TransactionalDispatchError(
			`${context}: ${toErrorMessage(response.error)}`,
			status,
			cause,
		);
	}
	if (response.data === undefined) {
		throw new TransactionalDispatchError(`${context}: received empty data`);
	}
	return response.data;
}

interface DispatchPayload {
	template_id: number;
	subscriber_email?: string;
	subscriber_id?: number;
	from_email?: string;
	data?: Record<string, unknown>;
	headers?: Array<Record<string, string>>;
	content_type?: "html" | "markdown" | "plain";
	messenger?: string;
	subject?: string;
	altbody?: string;
}

async function dispatchToListmonk(
	context: TransactionalOperationContext,
	payload: DispatchPayload,
): Promise<boolean> {
	const response = await context.client.transactional.send({
		template_id: payload.template_id,
		subscriber_emails:
			payload.subscriber_email === undefined
				? undefined
				: [payload.subscriber_email],
		subscriber_ids:
			payload.subscriber_id === undefined ? undefined : [payload.subscriber_id],
		from_email: payload.from_email,
		data: payload.data,
		headers: payload.headers,
		content_type: payload.content_type,
		messenger: payload.messenger,
		subject: payload.subject,
		altbody: payload.altbody,
	});
	const status =
		typeof response.response?.status === "number"
			? response.response.status
			: undefined;
	const data = unwrapData(response, "Failed to send transactional message");
	// Validate the acknowledgement is actually a boolean before the
	// idempotency wrapper trusts it. A non-conforming server, proxy, or
	// incompatible Listmonk version could return a truthy non-boolean
	// (e.g. the string "false"); without this guard the wrapper would
	// commit an `accepted` record before the output schema rejects it,
	// and a retry would replay `sent: true`.
	if (typeof data !== "boolean") {
		throw new TransactionalDispatchError(
			`Failed to send transactional message: Listmonk returned a non-boolean acknowledgement (${JSON.stringify(data)})`,
			status,
		);
	}
	return data;
}

function recordToOutput(
	record: TransactionalSendRecord,
	status: "accepted" | "replayed" | "failed",
): SendTransactionalOutput {
	return {
		sent: record.sent ?? false,
		status,
		duplicate: status === "replayed",
		idempotency_key: record.key,
		expires_at: record.expiresAt,
	};
}

/**
 * Send a transactional message through Listmonk.
 *
 * When `idempotency_key` is omitted, the request is dispatched immediately
 * and the result mirrors the prior `{ sent: boolean }` contract with
 * `status: "accepted" | "failed"`.
 *
 * When `idempotency_key` is supplied, an idempotency record is atomically
 * claimed before dispatch. Identical retries replay the original result;
 * a different payload with the same key is rejected as a conflict. Ambiguous
 * transport failures (timeout, connection reset) leave an `unknown` record
 * that blocks automatic retry and surfaces a `TransactionalReconcileError`.
 */
export async function sendTransactionalMessage(
	context: TransactionalOperationContext,
	input: z.output<typeof sendTransactionalInputSchema>,
): Promise<SendTransactionalOutput> {
	const payload: DispatchPayload = {
		template_id: input.template_id,
		subscriber_email: input.subscriber_email,
		subscriber_id: input.subscriber_id,
		from_email: input.from_email,
		data: input.data,
		headers: input.headers,
		content_type: input.content_type,
		messenger: input.messenger,
		subject: input.subject,
		altbody: input.altbody,
	};

	if (input.idempotency_key === undefined) {
		// No idempotency key: dispatch immediately, return the bare outcome.
		const sent = await dispatchToListmonk(context, payload);
		return {
			sent,
			status: sent ? "accepted" : "failed",
		};
	}

	const store = context.idempotencyStore;
	if (store === undefined || context.hashPayload === undefined) {
		// Surface is not wired for idempotency (e.g. a runtime-neutral
		// caller that did not inject a store). Reject rather than silently
		// dispatching without the safety net the caller asked for.
		throw new OperationInputError(
			"idempotency_key was supplied but this surface does not provide an idempotency store. Omit idempotency_key or run through the CLI/MCP adapter.",
		);
	}

	const serializedPayload = serializeTransactionalPayload(payload);
	const payloadHash = context.hashPayload(serializedPayload);
	const targetHash = computeTransactionalTargetHash(context.target ?? {});
	const claim = await store.claim({
		key: input.idempotency_key,
		payloadHash,
		targetHash,
	});

	if (claim.kind === "conflict") {
		throw new OperationInputError(
			`Idempotency key '${input.idempotency_key}' is already associated with a different payload or Listmonk target. Use a new key or remove idempotency_key to force a fresh send.`,
		);
	}

	if (claim.kind === "replay") {
		const record = claim.record;
		// Only deterministic terminal results are replayed verbatim:
		//   accepted — Listmonk returned sent:true
		//   failed   — Listmonk returned sent:false (negative acknowledgement)
		// Thrown dispatch errors are NOT persisted as `failed` (see below),
		// so a transient connection-refused does not suppress the message
		// for the TTL window.
		if (record.status === "accepted" || record.status === "failed") {
			return recordToOutput(record, "replayed");
		}
		// pending / unknown — the caller must reconcile rather than silently
		// re-dispatch. Surface enough context to act on.
		const reason = reconcileReason(record);
		throw new TransactionalReconcileError(
			record.key,
			record.status,
			`Idempotency key '${record.key}' is in '${record.status}' state and cannot be safely retried automatically. ${reason}`,
		);
	}

	// claim.kind === "new" — we own the dispatch.
	const record = claim.record;
	let sent: boolean;
	try {
		sent = await dispatchToListmonk(context, payload);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (isDefinitivePreDispatchError(error)) {
			// Proven pre-dispatch failure (ECONNREFUSED, ENOTFOUND): the
			// request never reached Listmonk. Release the claim so a retry
			// can dispatch once the outage clears.
			await releaseBestEffort(store, {
				key: input.idempotency_key,
				claimToken: record.claimToken,
			});
			throw error;
		}
		// Everything else — ambiguous transport failures (timeout,
		// ECONNRESET, fetch failed), post-dispatch response parse errors
		// (SyntaxError on a 2xx body), or unrecognized application errors —
		// is treated as `unknown`. Listmonk may have processed the message
		// before the error surfaced, so auto-retry must stay blocked and
		// the operator must reconcile.
		await commitBestEffort(store, {
			key: input.idempotency_key,
			claimToken: record.claimToken,
			status: "unknown",
			errorMessage,
		});
		throw new TransactionalReconcileError(
			input.idempotency_key,
			"unknown",
			`Transactional dispatch failed ambiguously ('${errorMessage}'). The message may or may not have been sent. Automatic retry is blocked; inspect Listmonk and the idempotency record before reconciling.`,
		);
	}

	// Dispatch returned a definitive acknowledgement (sent: true|false).
	// Persist best-effort: the dispatch result is the source of truth.
	await commitBestEffort(store, {
		key: input.idempotency_key,
		claimToken: record.claimToken,
		status: sent ? "accepted" : "failed",
		sent,
	});

	return {
		sent,
		status: sent ? "accepted" : "failed",
		duplicate: false,
		idempotency_key: input.idempotency_key,
		expires_at: record.expiresAt,
	};
}

/**
 * Wrap `store.commit` so a persistence failure (lock timeout, EACCES, full
 * disk) cannot replace the dispatch outcome. The dispatch result is the
 * source of truth; the record stays claimed until it expires or a later
 * sweep reclaims it.
 */
async function commitBestEffort(
	store: TransactionalIdempotencyStore,
	options: Parameters<TransactionalIdempotencyStore["commit"]>[0],
): Promise<void> {
	try {
		await store.commit(options);
	} catch (error) {
		console.warn(
			`Failed to persist transactional idempotency record for key '${options.key}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Best-effort release of a claim whose dispatch threw a definitive error.
 * A persistence failure must not mask the original transport error; the
 * claim will still expire at its TTL if the release did not land.
 */
async function releaseBestEffort(
	store: TransactionalIdempotencyStore,
	options: Parameters<TransactionalIdempotencyStore["release"]>[0],
): Promise<void> {
	try {
		await store.release(options);
	} catch (error) {
		console.warn(
			`Failed to release transactional idempotency claim for key '${options.key}': ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * Human-readable explanation for why a replayed record cannot be retried
 * automatically. Covers the non-`accepted` statuses the caller is allowed
 * to encounter; `accepted` is handled directly by the replay output path.
 *
 * `assertExhaustiveStatus` is a compile-time exhaustiveness guard: adding a
 * new `TransactionalSendStatus` member without handling it here surfaces as
 * a type error rather than silently producing a trailing-space message.
 */
function reconcileReason(record: TransactionalSendRecord): string {
	const status = record.status;
	switch (status) {
		case "pending":
			return "A previous request is still in flight or crashed before committing. Wait for it to settle or inspect the store.";
		case "unknown":
			return record.errorMessage
				? `Previous dispatch failed ambiguously: ${record.errorMessage}`
				: "Previous dispatch failed ambiguously.";
		case "failed":
			return record.errorMessage
				? `Previous dispatch was rejected by Listmonk: ${record.errorMessage}`
				: "Previous dispatch was rejected by Listmonk.";
		case "accepted":
			// Defensive: accepted records are replayed as success before this
			// function is reached. If we ever do see one, it still warrants
			// a real message rather than an empty string.
			return "The previous dispatch was accepted; replay the original result instead of reconciling.";
		default:
			return assertExhaustiveStatus(status);
	}
}

function assertExhaustiveStatus(status: never): string {
	return `Unexpected idempotency record status '${String(status)}'. Inspect the store and Listmonk before reconciling.`;
}

export const sendTransactionalOperation = defineOperation({
	id: "transactional.send",
	title: "Send transactional message",
	description: "Send a transactional email through Listmonk",
	inputSchema: sendTransactionalInputSchema,
	outputSchema: sendTransactionalOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		// The bare path (no idempotency_key) is non-idempotent. With a key
		// the wrapper is idempotent, but the operation-level hint stays
		// conservative because most callers will not supply one.
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_send_transactional",
		legacySuccessText: (output) => String(output.sent),
	},
	spec: bindTransactionalSendOperationSpec(),
	execute: sendTransactionalMessage,
});

export async function invokeSendTransactionalOperation(
	context: TransactionalOperationContext,
	input: unknown,
): Promise<SendTransactionalOutput> {
	const parsedInput = parseOperationInput(
		sendTransactionalOperation.inputSchema,
		input,
	);
	let output: SendTransactionalOutput;
	try {
		output = await sendTransactionalMessage(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(
			sendTransactionalOperation.id,
			error,
		);
	}
	return parseOperationOutput(
		sendTransactionalOperation.id,
		sendTransactionalOperation.outputSchema,
		output,
	);
}

export const transactionalOperations = [sendTransactionalOperation] as const;

export const transactionalOperationCatalog = defineOperationCatalog({
	id: "transactional",
	title: "Transactional mail",
	operations: transactionalOperations,
	specMigrationExemptions:
		operationSpecMigrationExemptionsByFamily.transactional,
});

export type TransactionalOperation = (typeof transactionalOperations)[number];

export function getTransactionalOperationByMcpName(
	name: string,
): TransactionalOperation | undefined {
	return name === sendTransactionalOperation.mcp.name
		? sendTransactionalOperation
		: undefined;
}

export interface TransactionalOperationInvocation {
	operation: TransactionalOperation;
	output: SendTransactionalOutput;
}

export async function invokeTransactionalOperationByMcpName(
	context: TransactionalOperationContext,
	name: string,
	input: unknown,
): Promise<TransactionalOperationInvocation | undefined> {
	switch (name) {
		case sendTransactionalOperation.mcp.name:
			return {
				operation: sendTransactionalOperation,
				output: await invokeSendTransactionalOperation(context, input),
			};
		default:
			return undefined;
	}
}
