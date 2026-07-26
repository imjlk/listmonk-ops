import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	getTransactionalOperationByMcpName,
	invokeSendTransactionalOperation,
	invokeTransactionalOperationByMcpName,
	OperationExecutionError,
	OperationInputError,
	sendTransactionalOperation,
	transactionalOperations,
} from "../src";

type TransactionalClient = Pick<ListmonkClient, "transactional">;

function context(send: TransactionalClient["transactional"]["send"]) {
	return { client: { transactional: { send } } as TransactionalClient };
}

describe("transactional operations", () => {
	test("validates and forwards the shared message payload", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		const output = await invokeSendTransactionalOperation(context(send), {
			template_id: "3",
			subscriber_id: "42",
			from_email: "Sender <sender@example.com>",
			content_type: "html",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});

		expect(output).toEqual({ sent: true });
		expect(send).toHaveBeenCalledWith({
			template_id: 3,
			subscriber_email: undefined,
			subscriber_id: 42,
			from_email: "Sender <sender@example.com>",
			content_type: "html",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});
	});

	test("accepts an email recipient through the generic invoke API", async () => {
		const send = mock(async () => ({ data: false })) as unknown as TransactionalClient["transactional"]["send"];

		await expect(
			sendTransactionalOperation.invoke(context(send), {
				template_id: 3,
				subscriber_email: "recipient@example.com",
			}),
		).resolves.toEqual({ sent: false });
	});

	test("requires exactly one supported recipient selector (XOR)", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		// Neither provided → rejected.
		await expect(
			invokeSendTransactionalOperation(context(send), { template_id: 3 }),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
				message:
					"Invalid parameter input: Exactly one of subscriber_email or subscriber_id is required (provide one, not both)",
			}),
		);
		// Both provided → also rejected.
		await expect(
			invokeSendTransactionalOperation(context(send), {
				template_id: 3,
				subscriber_email: "recipient@example.com",
				subscriber_id: 42,
			}),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
				message:
					"Invalid parameter input: Exactly one of subscriber_email or subscriber_id is required (provide one, not both)",
			}),
		);
		expect(send).not.toHaveBeenCalled();
	});

	test("rejects headers that smuggle CR, LF, NUL, or other control characters into values", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		const maliciousValues = [
			"injected\r\nBcc: leak@example.com",
			"injected\nBcc: leak@example.com",
			"truncated\0rest-of-payload",
			"verticalTab\vseparator",
			"bell\x07character",
			"delete\x7fcharacter",
		];
		for (const value of maliciousValues) {
			await expect(
				invokeSendTransactionalOperation(context(send), {
					template_id: 3,
					subscriber_id: 42,
					headers: [{ "X-Evil": value }],
				}),
			).rejects.toEqual(
				expect.objectContaining<Partial<OperationInputError>>({
					name: "OperationInputError",
				}),
			);
		}
		expect(send).not.toHaveBeenCalled();
	});

	test("rejects attempts to override protected transport headers", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		for (const protectedName of ["From", "Bcc", "Content-Type", "Subject"]) {
			await expect(
				invokeSendTransactionalOperation(context(send), {
					template_id: 3,
					subscriber_id: 42,
					headers: [{ [protectedName]: "value" }],
				}),
			).rejects.toEqual(
				expect.objectContaining<Partial<OperationInputError>>({
					name: "OperationInputError",
				}),
			);
		}
		expect(send).not.toHaveBeenCalled();
	});

	test("rejects header names that are not valid RFC 5322 atext tokens", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		// Whitespace, control characters, and `@`, `(`, `)`, `[`, `]`, `:`, `;`,
		// `,`, `<`, `>`, `\\`, `"` are all outside the RFC 5322 atext set.
		for (const invalidName of [
			"X Evil",
			"X@Evil",
			"X(Evil)",
			"X[Evil]",
			"X:Evil",
			"X,Evil",
		]) {
			await expect(
				invokeSendTransactionalOperation(context(send), {
					template_id: 3,
					subscriber_id: 42,
					headers: [{ [invalidName]: "value" }],
				}),
			).rejects.toEqual(
				expect.objectContaining<Partial<OperationInputError>>({
					name: "OperationInputError",
				}),
			);
		}
		expect(send).not.toHaveBeenCalled();
	});

	test("accepts common email header names that include dots or underscores", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		await expect(
			invokeSendTransactionalOperation(context(send), {
				template_id: 3,
				subscriber_id: 42,
				headers: [
					{ "X-Mailer": "listmonk-ops/1.0" },
					{ "X-MyApp.Version": "1.0" },
					{ X_Request_ID: "abc-123" },
				],
			}),
		).resolves.toEqual({ sent: true });
		expect(send).toHaveBeenCalledTimes(1);
	});

	test("accepts an idempotency_key without forwarding it to Listmonk", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		const output = await invokeSendTransactionalOperation(context(send), {
			template_id: 3,
			subscriber_id: 42,
			idempotency_key: "client-dedup-42",
		});

		expect(output).toEqual({ sent: true });
		// The Listmonk transactional payload must NOT include idempotency_key.
		expect(send).toHaveBeenCalledWith(
			expect.not.objectContaining({ idempotency_key: expect.anything() }),
		);
	});

	test("preserves API failures as operation execution errors", async () => {
		const send = mock(async () => ({ error: { error: "smtp unavailable" } })) as unknown as TransactionalClient["transactional"]["send"];

		await expect(
			invokeSendTransactionalOperation(context(send), {
				template_id: 3,
				subscriber_id: 42,
			}),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationExecutionError>>({
				name: "OperationExecutionError",
				operationId: "transactional.send",
				message: "Failed to send transactional message: smtp unavailable",
			}),
		);
	});

	test("dispatches the registered MCP name through the named invoker", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		const invocation = await invokeTransactionalOperationByMcpName(
			context(send),
			"listmonk_send_transactional",
			{ template_id: 3, subscriber_id: 42 },
		);

		expect(invocation?.operation).toBe(sendTransactionalOperation);
		expect(invocation?.output).toEqual({ sent: true });
		await expect(
			invokeTransactionalOperationByMcpName(
				context(send),
				"listmonk_unknown_transactional_tool",
				{},
			),
		).resolves.toBeUndefined();
	});

	test("exposes schemas and side-effect metadata through the registry", () => {
		expect(transactionalOperations).toEqual([sendTransactionalOperation]);
		expect(sendTransactionalOperation.inputJsonSchema.type).toBe("object");
		expect(sendTransactionalOperation.inputJsonSchema.required).toEqual([
			"template_id",
		]);
		expect(sendTransactionalOperation.inputJsonSchema.properties).toMatchObject({
			subscriber_id: {
				anyOf: [{ type: "integer" }, { type: "string" }],
			},
			content_type: { enum: ["html", "markdown", "plain"] },
			headers: { type: "array" },
		});
		expect(sendTransactionalOperation.outputJsonSchema.type).toBe("object");
		expect(sendTransactionalOperation.safety).toMatchObject({
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: false,
		});
		expect(
			getTransactionalOperationByMcpName("listmonk_send_transactional"),
		).toBe(sendTransactionalOperation);
	});
});
