import {
	hashTransactionalPayload,
	type OutputUtils,
} from "@listmonk-ops/common";
import { getTransactionalIdempotencyStoreFromEnvironment } from "@listmonk-ops/automation";
import { getOutput } from "../lib/output";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	idempotencyKeySchema,
	invokeTransactionalRecordsOperation,
	invokeTransactionalReconcileOperation,
	invokeSendTransactionalOperation,
	OperationExecutionError,
	TransactionalReconcileError,
	type SendTransactionalInput,
	type SendTransactionalOutput,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import {
	parseJson,
	positiveIntegerIdSchema,
	toErrorMessage,
} from "../lib/command-utils";
import { resolveListmonkSession } from "../lib/listmonk";

type TransactionalOutput = Pick<
	typeof OutputUtils,
	"json" | "success" | "warning"
>;

export interface TransactionalCliContext {
	client: Pick<ListmonkClient, "transactional">;
	output: TransactionalOutput;
	idempotencyStore?: Parameters<
		typeof invokeSendTransactionalOperation
	>[0]["idempotencyStore"];
	hashPayload?: Parameters<
		typeof invokeSendTransactionalOperation
	>[0]["hashPayload"];
	target?: { baseUrl?: string; username?: string };
}

export function createTransactionalCommandError(error: unknown): Error {
	if (error instanceof OperationExecutionError) {
		return error;
	}
	return new Error(
		`Failed to send transactional email: ${toErrorMessage(error)}`,
		{
			cause: error,
		},
	);
}

/**
 * Listmonk answered but declined the message (`data: false`). A replay of
 * such an answer is a rejection too: the message was never sent.
 */
export function isTransactionalSendRejected(
	output: SendTransactionalOutput,
): boolean {
	return !output.sent;
}

function summarizeTransactionalOutput(output: SendTransactionalOutput): string {
	if (output.status === "replayed") {
		return output.sent
			? `Transactional message replayed (duplicate of idempotency key ${output.idempotency_key ?? "?"})`
			: `Transactional message was rejected by Listmonk (replayed result for idempotency key ${output.idempotency_key ?? "?"})`;
	}
	if (output.status === "failed") {
		return output.idempotency_key === undefined
			? "Transactional message was rejected by Listmonk"
			: `Transactional message was rejected by Listmonk (idempotency key ${output.idempotency_key})`;
	}
	if (output.idempotency_key !== undefined) {
		return `Transactional message sent (idempotency key ${output.idempotency_key})`;
	}
	return "Transactional message sent";
}

export async function renderTransactionalSend(
	context: TransactionalCliContext,
	input: SendTransactionalInput,
): Promise<SendTransactionalOutput> {
	const output = await invokeSendTransactionalOperation(context, input);
	const summary = summarizeTransactionalOutput(output);
	if (isTransactionalSendRejected(output)) {
		context.output.warning(summary);
	} else {
		context.output.success(summary);
	}
	context.output.json(output);
	return output;
}

type SendTransactionalFlags = {
	"template-id": number;
	"subscriber-email"?: string;
	"subscriber-id"?: number;
	"from-email"?: string;
	data?: string;
	headers?: string;
	"content-type"?: "html" | "markdown" | "plain";
	messenger?: string;
	subject?: string;
	altbody?: string;
	"idempotency-key"?: string;
};

export async function handleSendTransactionalCommand({
	flags,
	...args
}: HandlerArgs<SendTransactionalFlags>): Promise<void> {
	try {
		// Resolve the full session (not just the client) so the idempotency
		// wrapper can namespace records by the resolved Listmonk target.
		const session = await resolveListmonkSession(args, { requireAuth: true });
		if (!session.client) {
			throw new Error("Listmonk client is not available");
		}
		const client = session.client;
		const data = flags.data
			? parseJson<NonNullable<SendTransactionalInput["data"]>>(
					flags.data,
					"data",
				)
			: undefined;
		const headers = flags.headers
			? parseJson<NonNullable<SendTransactionalInput["headers"]>>(
					flags.headers,
					"headers",
				)
			: undefined;

		const output = await renderTransactionalSend(
			{
				client,
				output: getOutput(),
				idempotencyStore:
					getTransactionalIdempotencyStoreFromEnvironment(),
				hashPayload: hashTransactionalPayload,
				target: { baseUrl: session.baseUrl, username: session.username },
			},
			{
				template_id: flags["template-id"],
				subscriber_email: flags["subscriber-email"],
				subscriber_id: flags["subscriber-id"],
				from_email: flags["from-email"],
				data,
				headers,
				content_type: flags["content-type"],
				messenger: flags.messenger,
				subject: flags.subject,
				altbody: flags.altbody,
				idempotency_key: flags["idempotency-key"],
			},
		);
		// Listmonk's negative acknowledgement is a completed send attempt rather
		// than a CLI error: keep the structured result on stdout and report the
		// rejection through the exit code.
		if (isTransactionalSendRejected(output)) {
			process.exitCode = 1;
		}
	} catch (error) {
		if (error instanceof TransactionalReconcileError) {
			// Reconcile-required errors carry operator guidance that the
			// generic wrapper would mangle. Surface the full message verbatim.
			throw error;
		}
		throw createTransactionalCommandError(error);
	}
}

async function handleRecordsCommand(args: HandlerArgs<{ key?: string; status?: "pending" | "accepted" | "failed" | "unknown"; limit: number; cursor?: string }>): Promise<void> {
	const session = await resolveListmonkSession(args, {
		requireAuth: false,
		localOnly: true,
	});
	getOutput().json(await invokeTransactionalRecordsOperation({
		idempotencyStore: getTransactionalIdempotencyStoreFromEnvironment(),
		target: { baseUrl: session.baseUrl, username: session.username },
	}, args.flags));
}

async function handleReconcileCommand(args: HandlerArgs<{ key: string; "expected-revision": string; decision: "accepted" | "retry"; reason: string; quiesced?: boolean }>): Promise<void> {
	const session = await resolveListmonkSession(args, {
		requireAuth: false,
		localOnly: true,
	});
	const { flags } = args;
	getOutput().json(await invokeTransactionalReconcileOperation({
		idempotencyStore: getTransactionalIdempotencyStoreFromEnvironment(),
		target: { baseUrl: session.baseUrl, username: session.username },
	}, {
		key: flags.key,
		expected_revision: flags["expected-revision"],
		decision: flags.decision,
		reason: flags.reason,
		quiesced: flags.quiesced,
	}));
}

export default defineGroup({
	name: "tx",
	description: "Transactional email operations",
	commands: [
		defineCommand({
			name: "records",
			operationId: "transactional.list",
			description: "Inspect redacted send records for the selected Listmonk target",
			options: {
				key: option(z.string().optional(), { description: "Exact idempotency key" }),
				status: option(z.enum(["pending", "accepted", "failed", "unknown"]).optional(), { description: "Filter by record status" }),
				limit: option(z.coerce.number().int().min(1).max(100).default(50), { description: "Maximum records to show" }),
				cursor: option(z.string().optional(), { description: "Cursor returned by the previous records page" }),
			},
			handler: handleRecordsCommand,
		}),
		defineCommand({
			name: "reconcile",
			operationId: "transactional.reconcile",
			description: "Record an explicit operator conclusion; never sends mail",
			options: {
				key: option(z.string(), { description: "Exact idempotency key" }),
				"expected-revision": option(z.string(), { description: "Revision returned by tx records" }),
				decision: option(z.enum(["accepted", "retry"]), { description: "Verified delivery decision" }),
				reason: option(z.string(), { description: "Operator evidence or reason, 10-500 characters" }),
				quiesced: option(z.boolean().optional(), { description: "Attest that the sender has stopped for an expired pending claim" }),
			},
			handler: handleReconcileCommand,
		}),
		defineCommand({
			name: "send",
			operationId: "transactional.send",
			description: "Send a transactional email",
			options: {
				"template-id": option(positiveIntegerIdSchema, {
					description: "Template ID",
				}),
				"subscriber-email": option(z.string().trim().email().optional(), {
					description: "Recipient subscriber email",
				}),
				"subscriber-id": option(positiveIntegerIdSchema.optional(), {
					description: "Recipient subscriber ID",
				}),
				"from-email": option(z.string().trim().min(1).optional(), {
					description: "From email header value",
				}),
				data: option(z.string().optional(), {
					description: "JSON template variables",
				}),
				headers: option(z.string().optional(), {
					description: "JSON array of additional email header objects",
				}),
				"content-type": option(
					z.enum(["html", "markdown", "plain"]).optional(),
					{
						description: "Message content type",
					},
				),
				messenger: option(z.string().trim().min(1).optional(), {
					description: "Listmonk messenger name",
				}),
				subject: option(z.string().trim().min(1).optional(), {
					description: "Message subject override",
				}),
				altbody: option(z.string().min(1).optional(), {
					description: "Plain-text alternative for multipart HTML email",
				}),
				"idempotency-key": option(idempotencyKeySchema, {
					description:
						"Optional idempotency key. A retry with the same key and payload replays the original result instead of re-sending.",
				}),
			},
			handler: handleSendTransactionalCommand,
		}),
	],
});
