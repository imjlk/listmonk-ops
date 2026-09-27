import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	OperationExecutionError,
	type TransactionalIdempotencyStore,
} from "@listmonk-ops/operations";
import { describe, expect, mock, test } from "bun:test";
import {
	createTransactionalCommandError,
	isTransactionalSendRejected,
	renderTransactionalSend,
	type TransactionalCliContext,
} from "../src/commands/tx";

type TransactionalClient = Pick<ListmonkClient, "transactional">;

function context(
	send: TransactionalClient["transactional"]["send"],
): TransactionalCliContext {
	return {
		client: { transactional: { send } } as TransactionalClient,
		output: {
			json: mock(() => undefined),
			success: mock(() => undefined),
			warning: mock(() => undefined),
		},
	};
}

describe("transactional CLI action", () => {
	test("renders a send through the shared operation", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];
		const cliContext = context(send);

		await renderTransactionalSend(cliContext, {
			template_id: 3,
			subscriber_email: "recipient@example.com",
			content_type: "html",
			messenger: "email-transactional",
			subject: "Order ready",
			altbody: "Your order is ready.",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});

		expect(send).toHaveBeenCalledWith({
			template_id: 3,
			subscriber_emails: ["recipient@example.com"],
			subscriber_ids: undefined,
			from_email: undefined,
			content_type: "html",
			messenger: "email-transactional",
			subject: "Order ready",
			altbody: "Your order is ready.",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Transactional message sent",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({
			sent: true,
			status: "accepted",
		});
	});

	test("renders a Listmonk rejection as a warning instead of success", async () => {
		const send = mock(async () => ({ data: false })) as unknown as TransactionalClient["transactional"]["send"];
		const cliContext = context(send);

		const output = await renderTransactionalSend(cliContext, {
			template_id: 3,
			subscriber_email: "recipient@example.com",
		});

		expect(output).toEqual({ sent: false, status: "failed" });
		expect(isTransactionalSendRejected(output)).toBe(true);
		expect(cliContext.output.warning).toHaveBeenCalledWith(
			"Transactional message was rejected by Listmonk",
		);
		expect(cliContext.output.success).not.toHaveBeenCalled();
		expect(cliContext.output.json).toHaveBeenCalledWith(output);
	});

	test("treats a replayed rejection as a rejection", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];
		const record = {
			key: "order-42",
			payloadHash: "payload",
			targetHash: "target",
			status: "failed" as const,
			sent: false,
			claimToken: "claim",
			createdAt: "2026-09-27T00:00:00.000Z",
			updatedAt: "2026-09-27T00:00:00.000Z",
			expiresAt: "2026-09-28T00:00:00.000Z",
		};
		const idempotencyStore: TransactionalIdempotencyStore = {
			claim: async () => ({ kind: "replay", record }),
			commit: async () => undefined,
			release: async () => undefined,
			load: async () => ({ version: 2, records: {} }),
		};
		const cliContext = {
			...context(send),
			idempotencyStore,
			hashPayload: () => "payload",
		};

		const output = await renderTransactionalSend(cliContext, {
			template_id: 3,
			subscriber_email: "recipient@example.com",
			idempotency_key: "order-42",
		});

		expect(send).not.toHaveBeenCalled();
		expect(output).toMatchObject({ sent: false, status: "replayed" });
		expect(isTransactionalSendRejected(output)).toBe(true);
		expect(cliContext.output.warning).toHaveBeenCalledWith(
			"Transactional message was rejected by Listmonk (replayed result for idempotency key order-42)",
		);
		expect(cliContext.output.success).not.toHaveBeenCalled();
	});

	test("does not render success when shared validation fails", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];
		const cliContext = context(send);

		await expect(
			renderTransactionalSend(cliContext, { template_id: 3 }),
		).rejects.toThrow(
			"Exactly one of subscriber_email or subscriber_id is required",
		);
		expect(send).not.toHaveBeenCalled();
		expect(cliContext.output.success).not.toHaveBeenCalled();
		expect(cliContext.output.json).not.toHaveBeenCalled();
	});

	test("does not duplicate operation error context", () => {
		const operationError = new OperationExecutionError(
			"transactional.send",
			new Error("Failed to send transactional message: smtp unavailable"),
		);
		expect(createTransactionalCommandError(operationError)).toBe(operationError);

		const parseError = new Error("Invalid JSON for headers");
		const commandError = createTransactionalCommandError(parseError);
		expect(commandError.message).toBe(
			"Failed to send transactional email: Invalid JSON for headers",
		);
		expect(commandError.cause).toBe(parseError);
	});
});
