import type { ListmonkClient } from "@listmonk-ops/openapi";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

export interface TransactionalOperationContext {
	client: Pick<ListmonkClient, "transactional">;
}

type DataResponse<T> = {
	data?: T;
	error?: unknown;
};

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

const sendTransactionalOutputSchema = z.object({
	sent: z.boolean().describe("Whether Listmonk accepted the message"),
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
		throw new Error(`${context}: ${toErrorMessage(response.error)}`);
	}
	if (response.data === undefined) {
		throw new Error(`${context}: received empty data`);
	}
	return response.data;
}

export async function sendTransactionalMessage(
	{ client }: TransactionalOperationContext,
	input: z.output<typeof sendTransactionalInputSchema>,
): Promise<SendTransactionalOutput> {
	const response = await client.transactional.send({
		template_id: input.template_id,
		subscriber_email: input.subscriber_email,
		subscriber_id: input.subscriber_id,
		from_email: input.from_email,
		data: input.data,
		headers: input.headers,
		content_type: input.content_type,
	});

	return {
		sent: unwrapData(response, "Failed to send transactional message"),
	};
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
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_send_transactional",
		legacySuccessText: (output) => String(output.sent),
	},
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
