import { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeSendTransactionalOperation,
	OperationExecutionError,
	type SendTransactionalInput,
} from "@listmonk-ops/operations";
import { z } from "zod";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { parseJson, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type TransactionalOutput = Pick<typeof OutputUtils, "json" | "success">;

export interface TransactionalCliContext {
	client: Pick<ListmonkClient, "transactional">;
	output: TransactionalOutput;
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

export async function renderTransactionalSend(
	context: TransactionalCliContext,
	input: SendTransactionalInput,
): Promise<void> {
	const output = await invokeSendTransactionalOperation(context, input);
	context.output.success("Transactional message sent");
	context.output.json(output.sent);
}

type SendTransactionalFlags = {
	"template-id": number;
	"subscriber-email"?: string;
	"subscriber-id"?: number;
	"from-email"?: string;
	data?: string;
	headers?: string;
	"content-type"?: "html" | "markdown" | "plain";
};

export async function handleSendTransactionalCommand({
	flags,
	...args
}: HandlerArgs<SendTransactionalFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
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
			{ client, output: OutputUtils },
			{
				template_id: flags["template-id"],
				subscriber_email: flags["subscriber-email"],
				subscriber_id: flags["subscriber-id"],
				from_email: flags["from-email"],
				data,
				headers,
				content_type: flags["content-type"],
			},
		);
	} catch (error) {
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
			},
			handler: handleSendTransactionalCommand,
		}),
	],
});
