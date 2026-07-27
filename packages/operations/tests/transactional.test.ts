import type { ListmonkClient } from "@listmonk-ops/openapi";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	getTransactionalOperationByMcpName,
	invokeSendTransactionalOperation,
	invokeTransactionalOperationByMcpName,
	OperationExecutionError,
	OperationInputError,
	sendTransactionalOperation,
	transactionalOperations,
	type TransactionalOperationContext,
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

		expect(output).toEqual({ sent: true, status: "accepted" });
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
		).resolves.toEqual({ sent: false, status: "failed" });
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
		).resolves.toEqual({ sent: true, status: "accepted" });
		expect(send).toHaveBeenCalledTimes(1);
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
		expect(invocation?.output).toEqual({ sent: true, status: "accepted" });
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
			idempotency_key: { type: "string" },
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

	test("rejects idempotency keys that contain whitespace or disallowed characters", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		for (const invalidKey of ["has space", "with@at", "slash/char", ""]) {
			await expect(
				invokeSendTransactionalOperation(context(send), {
					template_id: 3,
					subscriber_id: 42,
					idempotency_key: invalidKey,
				}),
			).rejects.toEqual(
				expect.objectContaining<Partial<OperationInputError>>({
					name: "OperationInputError",
				}),
			);
		}
		expect(send).not.toHaveBeenCalled();
	});
});

describe("transactional idempotency wrapper integration", () => {
	let tempDir: string;
	let storePath: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-tx-wrap-"));
		storePath = join(tempDir, "transactional.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	type TransactionalClient = Pick<ListmonkClient, "transactional">;

	function contextWithStore(
		send: TransactionalClient["transactional"]["send"],
		path: string,
	): TransactionalOperationContext {
		return {
			client: { transactional: { send } } as TransactionalClient,
			storePath: path,
		};
	}

	test("replays the original result when the same key+payload is retried", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send, storePath);
		const input = {
			template_id: 3,
			subscriber_id: 42,
			from_email: "Sender <sender@example.com>",
			content_type: "html" as const,
			data: { order_id: "OPS-1" },
			headers: [{ "X-Request-ID": "req-1" }],
			idempotency_key: "order-1",
		};

		const first = await invokeSendTransactionalOperation(ctx, input);
		expect(first).toMatchObject({
			sent: true,
			status: "accepted",
			duplicate: false,
			idempotency_key: "order-1",
		});
		expect(first.expires_at).toBeDefined();
		expect(send).toHaveBeenCalledTimes(1);

		// Retry with identical payload — Listmonk must not be called again.
		const replay = await invokeSendTransactionalOperation(ctx, input);
		expect(replay).toMatchObject({
			sent: true,
			status: "replayed",
			duplicate: true,
			idempotency_key: "order-1",
		});
		expect(send).toHaveBeenCalledTimes(1);
	});

	test("rejects a different payload under the same idempotency key as a conflict", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send, storePath);

		await invokeSendTransactionalOperation(ctx, {
			template_id: 3,
			subscriber_id: 42,
			idempotency_key: "order-1",
			data: { order_id: "OPS-1" },
		});

		await expect(
			invokeSendTransactionalOperation(ctx, {
				template_id: 3,
				subscriber_id: 42,
				idempotency_key: "order-1",
				data: { order_id: "OPS-2" },
			}),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
				message: expect.stringContaining("already associated with a different payload"),
			}),
		);
		// Only the first call reached Listmonk.
		expect(send).toHaveBeenCalledTimes(1);
	});

	test("records an ambiguous transport failure as unknown and blocks auto-retry", async () => {
		const send = mock(async () => {
			throw new Error("fetch failed: ECONNRESET");
		}) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send, storePath);

		await expect(
			invokeSendTransactionalOperation(ctx, {
				template_id: 3,
				subscriber_id: 42,
				idempotency_key: "order-1",
			}),
		).rejects.toEqual(
			expect.objectContaining({
				name: "TransactionalReconcileError",
				status: "unknown",
			}),
		);

		// A second attempt with the same key must NOT auto-retry; it surfaces
		// a reconcile-required error because the prior record is `unknown`.
		send.mockImplementation(
			async () => ({ data: true }) as unknown as Awaited<
				ReturnType<TransactionalClient["transactional"]["send"]>
			>,
		);
		await expect(
			invokeSendTransactionalOperation(ctx, {
				template_id: 3,
				subscriber_id: 42,
				idempotency_key: "order-1",
			}),
		).rejects.toEqual(
			expect.objectContaining({
				name: "TransactionalReconcileError",
				status: "unknown",
			}),
		);
		// Listmonk was only called once (the original dispatch).
		expect(send).toHaveBeenCalledTimes(1);
	});

	test("replays an explicit Listmonk rejection without re-dispatching", async () => {
		const send = mock(async () => ({ data: false })) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send, storePath);

		const first = await invokeSendTransactionalOperation(ctx, {
			template_id: 3,
			subscriber_id: 42,
			idempotency_key: "order-1",
		});
		expect(first).toMatchObject({
			sent: false,
			status: "failed",
			duplicate: false,
		});

		// A definitive negative acknowledgement is deterministic: replay it
		// instead of re-dispatching or surfacing a reconcile error.
		const replay = await invokeSendTransactionalOperation(ctx, {
			template_id: 3,
			subscriber_id: 42,
			idempotency_key: "order-1",
		});
		expect(replay).toMatchObject({
			sent: false,
			status: "replayed",
			duplicate: true,
		});
		expect(send).toHaveBeenCalledTimes(1);
	});
});
