import type { ListmonkClient } from "@listmonk-ops/openapi";
import { z } from "zod";
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
			input.subscriber_email !== undefined || input.subscriber_id !== undefined,
		{ message: "Either subscriber_email or subscriber_id is required" },
	);

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
	mcp: { name: "listmonk_send_transactional" },
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
