import type { ListmonkClient } from "@listmonk-ops/openapi";
import { OperationExecutionError } from "@listmonk-ops/operations";
import { describe, expect, mock, test } from "bun:test";
import {
	createTransactionalCommandError,
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
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});

		expect(send).toHaveBeenCalledWith({
			template_id: 3,
			subscriber_email: "recipient@example.com",
			subscriber_id: undefined,
			from_email: undefined,
			content_type: "html",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Transactional message sent",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith(true);
	});

	test("does not render success when shared validation fails", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];
		const cliContext = context(send);

		await expect(
			renderTransactionalSend(cliContext, { template_id: 3 }),
		).rejects.toThrow(
			"Either subscriber_email or subscriber_id is required",
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
