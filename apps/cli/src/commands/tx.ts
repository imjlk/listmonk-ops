import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
	type OutputUtils,
} from "@listmonk-ops/common";
import { getOutput } from "../lib/output";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	idempotencyKeySchema,
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
import { parseJson, toErrorMessage } from "../lib/command-utils";
import { resolveListmonkSession } from "../lib/listmonk";

type TransactionalOutput = Pick<typeof OutputUtils, "json" | "success">;

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

function summarizeTransactionalOutput(output: SendTransactionalOutput): string {
	if (output.status === "replayed") {
		return `Transactional message replayed (duplicate of idempotency key ${output.idempotency_key ?? "?"})`;
	}
	if (output.status === "failed") {
		return "Transactional message was rejected by Listmonk";
	}
	if (output.idempotency_key !== undefined) {
		return `Transactional message sent (idempotency key ${output.idempotency_key})`;
	}
	return "Transactional message sent";
}

export async function renderTransactionalSend(
	context: TransactionalCliContext,
	input: SendTransactionalInput,
): Promise<void> {
	const output = await invokeSendTransactionalOperation(context, input);
	context.output.success(summarizeTransactionalOutput(output));
	context.output.json(output);
}

type SendTransactionalFlags = {
	"template-id": number;
	"subscriber-email"?: string;
	"subscriber-id"?: number;
	"from-email"?: string;
	data?: string;
	headers?: string;
	"content-type"?: "html" | "markdown" | "plain";
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

		await renderTransactionalSend(
			{
				client,
				output: getOutput(),
				idempotencyStore:
					createFileBackedTransactionalIdempotencyStore(),
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
				idempotency_key: flags["idempotency-key"],
			},
		);
	} catch (error) {
		if (error instanceof TransactionalReconcileError) {
			// Reconcile-required errors carry operator guidance that the
			// generic wrapper would mangle. Surface the full message verbatim.
			throw error;
		}
		throw createTransactionalCommandError(error);
	}
}

export default defineGroup({
	name: "tx",
	description: "Transactional email operations",
	commands: [
		defineCommand({
			name: "send",
			operationId: "transactional.send",
			description: "Send a transactional email",
			options: {
				"template-id": option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
				"subscriber-email": option(z.string().trim().email().optional(), {
					description: "Recipient subscriber email",
				}),
				"subscriber-id": option(z.coerce.number().int().positive().optional(), {
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
				"idempotency-key": option(idempotencyKeySchema, {
					description:
						"Optional idempotency key. A retry with the same key and payload replays the original result instead of re-sending.",
				}),
			},
			handler: handleSendTransactionalCommand,
		}),
	],
});
