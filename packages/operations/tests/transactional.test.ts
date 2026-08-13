import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	computeTransactionalTargetHash,
	getTransactionalOperationByMcpName,
	invokeSendTransactionalOperation,
	invokeTransactionalOperationByMcpName,
	isAmbiguousTransportError,
	isDefinitivePreDispatchError,
	OperationExecutionError,
	OperationInputError,
	serializeTransactionalPayload,
	sendTransactionalOperation,
	TRANSACTIONAL_FROM_EMAIL_PATTERN,
	TRANSACTIONAL_SUBJECT_PATTERN,
	transactionalOperations,
	DEFAULT_TRANSACTIONAL_TTL_MS,
	type TransactionalClaimResult,
	type TransactionalIdempotencyStore,
	type TransactionalOperationContext,
	type TransactionalSendRecord,
} from "../src";

type TransactionalClient = Pick<ListmonkClient, "transactional">;

function context(send: TransactionalClient["transactional"]["send"]) {
	return { client: { transactional: { send } } as TransactionalClient };
}

/**
 * Minimal in-memory store implementing the operations-package interface.
 * Keeps a single Map keyed by idempotency_key; not atomic, but sufficient
 * for wrapper-level unit tests that exercise one request at a time.
 */
function createInMemoryTransactionalIdempotencyStore(): TransactionalIdempotencyStore & {
	snapshot(): Map<string, TransactionalSendRecord>;
} {
	const records = new Map<string, TransactionalSendRecord>();
	let tokenCounter = 0;
	return {
		claim({ key, payloadHash, targetHash, ttlMs, now }) {
			const at = (now ?? (() => new Date()))();
			const ttl = ttlMs ?? DEFAULT_TRANSACTIONAL_TTL_MS;
			const expiresAt = new Date(at.getTime() + ttl).toISOString();
			// Sweep expired first so the test reflects the file-store behavior.
			for (const [k, r] of records) {
				if (new Date(r.expiresAt).getTime() < at.getTime()) {
					records.delete(k);
				}
			}
			const existing = records.get(key);
			if (existing) {
				const samePayload =
					existing.payloadHash === payloadHash &&
					existing.targetHash === targetHash;
				if (!samePayload) {
					return Promise.resolve({
						kind: "conflict",
						existing,
					} satisfies TransactionalClaimResult);
				}
				return Promise.resolve({
					kind: "replay",
					record: existing,
				} satisfies TransactionalClaimResult);
			}
			const record: TransactionalSendRecord = {
				key,
				payloadHash,
				targetHash,
				status: "pending",
				claimToken: `tok-${tokenCounter++}`,
				createdAt: at.toISOString(),
				updatedAt: at.toISOString(),
				expiresAt,
			};
			records.set(key, record);
			return Promise.resolve({
				kind: "new",
				record,
			} satisfies TransactionalClaimResult);
		},
		commit({ key, claimToken, status, sent, errorMessage, now }) {
			const at = (now ?? (() => new Date()))();
			const existing = records.get(key);
			if (existing && existing.claimToken === claimToken) {
				records.set(key, {
					...existing,
					status,
					sent: status === "accepted" ? true : sent,
					errorMessage,
					updatedAt: at.toISOString(),
				});
			}
			return Promise.resolve();
		},
		release({ key, claimToken }) {
			const existing = records.get(key);
			if (existing && existing.claimToken === claimToken) {
				records.delete(key);
			}
			return Promise.resolve();
		},
		load() {
			const doc = { version: 1 as const, records: {} as Record<string, TransactionalSendRecord> };
			for (const [k, v] of records) doc.records[k] = v;
			return Promise.resolve(doc);
		},
		snapshot() {
			return new Map(records);
		},
	};
}

describe("transactional operations", () => {
	test("validates and forwards the shared message payload", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		const output = await invokeSendTransactionalOperation(context(send), {
			template_id: "3",
			subscriber_id: "42",
			from_email: "Sender <sender@example.com>",
			content_type: "html",
			messenger: "email-transactional",
			subject: "Order {{ .Tx.Data.order_id }}",
			altbody: "Order {{ .Tx.Data.order_id }} is ready.",
			data: { order_id: "OPS-42" },
			headers: [{ "X-Request-ID": "request-42" }],
		});

		expect(output).toEqual({ sent: true, status: "accepted" });
		expect(send).toHaveBeenCalledWith({
			template_id: 3,
			subscriber_emails: undefined,
			subscriber_ids: [42],
			from_email: "Sender <sender@example.com>",
			content_type: "html",
			messenger: "email-transactional",
			subject: "Order {{ .Tx.Data.order_id }}",
			altbody: "Order {{ .Tx.Data.order_id }} is ready.",
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

	test("accepts one bare or display-name From mailbox", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		for (const fromEmail of [
			"sender@example.com",
			" sender@example.com ",
			"Sender <sender@example.com>",
			"Sender<sender@example.com>",
			'"Example, Inc." <sender@example.com>',
			'"John Doe (Admin)" <sender@example.com>',
		]) {
			await expect(
				invokeSendTransactionalOperation(context(send), {
					template_id: 3,
					subscriber_id: 42,
					from_email: fromEmail,
				}),
			).resolves.toEqual({ sent: true, status: "accepted" });
		}
		expect(send).toHaveBeenCalledTimes(6);
		expect(send).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ from_email: "sender@example.com" }),
		);
	});

	test("rejects malformed, multiple, or injected From mailboxes before dispatch", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		for (const fromEmail of [
			"Sender <sender@example.com>\r\nBcc: leak@example.com",
			"sender@example.com, other@example.com",
			"Sender <sender..dots@example.com>",
			"Sender <sender@example-.com>",
			"Sender <sender@example.com> trailing",
			"\ud800@example.com",
		]) {
			await expect(
				invokeSendTransactionalOperation(context(send), {
					template_id: 3,
					subscriber_id: 42,
					from_email: fromEmail,
				}),
			).rejects.toEqual(
				expect.objectContaining<Partial<OperationInputError>>({
					name: "OperationInputError",
				}),
			);
		}
		expect(send).not.toHaveBeenCalled();
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

	test("rejects subject overrides containing control characters before dispatch", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		for (const subject of [
			"Receipt\r\nBcc: leak@example.com",
			"Receipt\nBcc: leak@example.com",
			"Receipt\0hidden",
			"Receipt\x7fhidden",
		]) {
			await expect(
				invokeSendTransactionalOperation(context(send), {
					template_id: 3,
					subscriber_id: 42,
					subject,
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

		for (const protectedName of [
			"From",
			"Bcc",
			"Content-Type",
			"Subject",
			"Return-Path",
			"Sender",
			"Received",
			"Resent-Date",
			"RESENT-From",
			"Resent-X-Trace",
		]) {
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
					{ "X-Resent-Trace": "forwarded" },
				],
			}),
		).resolves.toEqual({ sent: true, status: "accepted" });
		expect(send).toHaveBeenCalledTimes(1);
	});

	test("rejects an empty plain-text alternative before dispatch", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];

		await expect(
			invokeSendTransactionalOperation(context(send), {
				template_id: 3,
				subscriber_id: 42,
				altbody: "",
			}),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
			}),
		);
		expect(send).not.toHaveBeenCalled();
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
			from_email: {
				type: "string",
				minLength: 1,
				maxLength: 512,
				pattern: TRANSACTIONAL_FROM_EMAIL_PATTERN.source,
			},
			messenger: { type: "string", minLength: 1 },
			subject: {
				type: "string",
				minLength: 1,
				pattern: TRANSACTIONAL_SUBJECT_PATTERN.source,
			},
			altbody: { type: "string" },
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
	type TransactionalClient = Pick<ListmonkClient, "transactional">;

	// Simple in-memory SHA-256 stand-in: the wrapper only needs a stable
	// equality token, not cryptographic strength, for these unit tests.
	function naiveHash(value: string): string {
		let h = 0;
		for (let i = 0; i < value.length; i++) {
			h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
		}
		return (h >>> 0).toString(16).padStart(8, "0");
	}

	function contextWithStore(
		send: TransactionalClient["transactional"]["send"],
	): TransactionalOperationContext {
		const store = createInMemoryTransactionalIdempotencyStore();
		return {
			client: { transactional: { send } } as TransactionalClient,
			idempotencyStore: store,
			hashPayload: (serialized: string) =>
				naiveHash(serialized).padEnd(8, "0"),
		};
	}

	test("replays the original result when the same key+payload is retried", async () => {
		const send = mock(async () => ({ data: true })) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send);
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
		const ctx = contextWithStore(send);

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
		const ctx = contextWithStore(send);

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
		const ctx = contextWithStore(send);

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

	test("does not terminally record a definitive thrown dispatch error", async () => {
		// ECONNREFUSED is definitive (nothing listening); the wrapper must NOT
		// persist it as `failed` or a retry would replay the stored error and
		// suppress the message for the TTL window. The claim stays pending
		// and a retry can dispatch once the outage clears.
		const send = mock(async () => {
			throw new Error("connect ECONNREFUSED 127.0.0.1:9000");
		}) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send);

		await expect(
			invokeSendTransactionalOperation(ctx, {
				template_id: 3,
				subscriber_id: 42,
				idempotency_key: "order-1",
			}),
		).rejects.toThrow(/ECONNREFUSED/);

		// A retry after the outage clears must dispatch again (not replay).
		send.mockImplementation(
			async () => ({ data: true }) as unknown as Awaited<
				ReturnType<TransactionalClient["transactional"]["send"]>
			>,
		);
		const retry = await invokeSendTransactionalOperation(ctx, {
			template_id: 3,
			subscriber_id: 42,
			idempotency_key: "order-1",
		});
		expect(retry).toMatchObject({
			sent: true,
			status: "accepted",
		});
		expect(send).toHaveBeenCalledTimes(2);
	});

	test("records post-dispatch response failures as unknown, not released", async () => {
		// Listmonk accepted the request and returned a 2xx body, but the
		// generated client failed to parse it (SyntaxError). The message
		// may have been delivered, so the wrapper must NOT release the
		// claim — it records `unknown` so auto-retry stays blocked.
		const send = mock(async () => {
			throw new SyntaxError("Unexpected end of JSON input");
		}) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send);

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

		// A retry must NOT re-dispatch; the prior record is `unknown`.
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
			expect(send).toHaveBeenCalledTimes(1);
		});

	test("rejects non-boolean acknowledgements before persisting accepted", async () => {
		// A non-conforming server/proxy could return a truthy non-boolean
		// (e.g. the string "false"). The wrapper must NOT treat it as
		// accepted and persist sent:true. It throws, leaving an unknown
		// record (the response reached us but its shape is untrustworthy),
		// so a retry surfaces a reconcile error rather than silently
		// replaying a false acceptance.
		const send = mock(async () => ({
			data: "false",
		})) as unknown as TransactionalClient["transactional"]["send"];
		const ctx = contextWithStore(send);

		await expect(
			invokeSendTransactionalOperation(ctx, {
				template_id: 3,
				subscriber_id: 42,
				idempotency_key: "order-1",
			}),
		).rejects.toThrow(/non-boolean acknowledgement/);

		// The retry must NOT silently replay sent:true; the record is unknown.
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
		expect(send).toHaveBeenCalledTimes(1);
	});
});

describe("transactional idempotency pure helpers", () => {
describe("serializeTransactionalPayload", () => {
		test("distinguishes delivery and rendering overrides", () => {
			const base = serializeTransactionalPayload({ template_id: 3 });
			for (const payload of [
				{ template_id: 3, messenger: "email-transactional" },
				{ template_id: 3, subject: "Order ready" },
				{ template_id: 3, altbody: "Your order is ready." },
			]) {
				expect(serializeTransactionalPayload(payload)).not.toBe(base);
			}
		});

		test("is stable across object key reordering", () => {
			const a = serializeTransactionalPayload({
				template_id: 3,
				data: { a: 1, b: 2, c: 3 },
			});
			const b = serializeTransactionalPayload({
				template_id: 3,
				data: { c: 3, a: 1, b: 2 },
			});
			expect(a).toBe(b);
		});

		test("treats Date instances like their transport ISO string", () => {
			const withDate = serializeTransactionalPayload({
				template_id: 3,
				data: { when: new Date("2026-01-01T00:00:00.000Z") },
			});
			const withIso = serializeTransactionalPayload({
				template_id: 3,
				data: { when: "2026-01-01T00:00:00.000Z" },
			});
			expect(withDate).toBe(withIso);
		});

		test("treats undefined inside arrays like null (transport semantics)", () => {
			const withUndef = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: [undefined] },
			});
			const withNull = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: [null] },
			});
			expect(withUndef).toBe(withNull);
		});

		test("serializes sparse array holes as null (matches JSON transport)", () => {
			// JSON.stringify(new Array(1)) === "[null]"; the hash must agree
			// so a key reused with the sparse and the explicit-null forms
			// does not falsely conflict or replay.
			const sparse = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: new Array(1) }, // eslint-disable-line no-sparse-arrays
			});
			const explicit = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: [null] },
			});
			expect(sparse).toBe(explicit);
		});

		test("honors toJSON when hashing payloads", () => {
			// URL serializes via toJSON() → its href string. Two distinct
			// URLs are enumerable-empty ({}) but produce different wire
			// payloads; the hash must distinguish them.
			class FakeURL {
				constructor(private readonly href: string) {}
				toJSON(): string {
					return this.href;
				}
			}
			const a = serializeTransactionalPayload({
				template_id: 3,
				data: { link: new FakeURL("https://a.example.com") },
			});
			const b = serializeTransactionalPayload({
				template_id: 3,
				data: { link: new FakeURL("https://b.example.com") },
			});
			expect(a).not.toBe(b);
			// And a matching plain string must hash identically to its
			// toJSON counterpart.
			const asString = serializeTransactionalPayload({
				template_id: 3,
				data: { link: "https://a.example.com" },
			});
			expect(a).toBe(asString);
		});

		test("omits object properties whose toJSON returns undefined", () => {
			// JSON.stringify drops a property when its value's toJSON
			// returns undefined. { value: { toJSON() { return undefined; } } }
			// therefore has the same wire body as {}, and must hash alike.
			class Omitting {
				toJSON(): unknown {
					return undefined;
				}
			}
			const withOmitting = serializeTransactionalPayload({
				template_id: 3,
				data: { value: new Omitting(), keep: 1 },
			});
			const withoutProperty = serializeTransactionalPayload({
				template_id: 3,
				data: { keep: 1 },
			});
			expect(withOmitting).toBe(withoutProperty);
			// And distinct from a payload that actually sends null.
			const withNull = serializeTransactionalPayload({
				template_id: 3,
				data: { value: null, keep: 1 },
			});
			expect(withOmitting).not.toBe(withNull);
		});

		test("passes the property key to toJSON (matches JSON.stringify)", () => {
			// JSON.stringify calls toJSON(key), forwarding the property name.
			// A value whose toJSON depends on its key must hash the way the
			// transport serializes it, or two structurally different payloads
			// could collide.
			class KeyEcho {
				toJSON(key: string): unknown {
					return key;
				}
			}
			const withKeyEcho = serializeTransactionalPayload({
				template_id: 3,
				data: { first: new KeyEcho(), second: new KeyEcho() },
			});
			// The wire body sends {"first":"first","second":"second"}.
			const explicit = serializeTransactionalPayload({
				template_id: 3,
				data: { first: "first", second: "second" },
			});
			expect(withKeyEcho).toBe(explicit);
		});

		test("passes array indices to toJSON as strings", () => {
			// JSON.stringify calls toJSON("0"), toJSON("1"), … for array
			// elements. A value whose toJSON depends on its key must hash
			// the way the transport serializes it.
			class IndexEcho {
				toJSON(key: string): unknown {
					return key;
				}
			}
			const withIndexEcho = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: [new IndexEcho(), new IndexEcho()] },
			});
			// The wire body sends {"xs":["0","1"]}.
			const explicit = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: ["0", "1"] },
			});
			expect(withIndexEcho).toBe(explicit);
		});

		test("serializes invalid dates as null (matches JSON.stringify)", () => {
			// JSON.stringify(new Date("invalid")) === "null"; the hash must
			// agree and not throw (toISOString would raise RangeError).
			const withInvalid = serializeTransactionalPayload({
				template_id: 3,
				data: { when: new Date("invalid") },
			});
			const withNull = serializeTransactionalPayload({
				template_id: 3,
				data: { when: null },
			});
			expect(withInvalid).toBe(withNull);
		});

		test("unboxes boxed primitives like JSON.stringify", () => {
			// new Number(1) and new Number(2) are objects but JSON.stringify
			// sends 1 and 2; the hash must distinguish them, not collapse
			// both to {}.
			const one = serializeTransactionalPayload({
				template_id: 3,
				data: { n: new Number(1) },
			});
			const two = serializeTransactionalPayload({
				template_id: 3,
				data: { n: new Number(2) },
			});
			expect(one).not.toBe(two);
			// And match their primitive counterparts.
			expect(one).toBe(
				serializeTransactionalPayload({
					template_id: 3,
					data: { n: 1 },
				}),
			);
		});

		test("serializes non-JSON array values (functions, symbols) as null", () => {
			// JSON.stringify coerces functions/symbols inside arrays to null;
			// the hash must agree so [() => {}] does not collide with [].
			const withFn = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: [() => {}] },
			});
			const withNull = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: [null] },
			});
			expect(withFn).toBe(withNull);
			// And distinct from an empty array.
			const empty = serializeTransactionalPayload({
				template_id: 3,
				data: { xs: [] },
			});
			expect(withFn).not.toBe(empty);
		});

		test("omits function/symbol-valued object properties (matches JSON.stringify)", () => {
			// JSON.stringify drops function/symbol properties entirely
			// (not null), so { cb: () => {} } and {} must hash alike.
			const withCallback = serializeTransactionalPayload({
				template_id: 3,
				data: { cb: () => {}, keep: 1 },
			});
			const withoutCallback = serializeTransactionalPayload({
				template_id: 3,
				data: { keep: 1 },
			});
			expect(withCallback).toBe(withoutCallback);
		});

		test("hashes bigints as decimal strings (matches jsonBodySerializer)", () => {
			// The OpenAPI client serializes bigints as decimal strings,
			// so distinct bigints must produce distinct hashes.
			const one = serializeTransactionalPayload({
				template_id: 3,
				data: { value: 1n },
			});
			const two = serializeTransactionalPayload({
				template_id: 3,
				data: { value: 2n },
			});
			expect(one).not.toBe(two);
			// And match the string form the transport sends.
			const oneAsString = serializeTransactionalPayload({
				template_id: 3,
				data: { value: "1" },
			});
			expect(one).toBe(oneAsString);
		});

		test("rejects cyclic payloads instead of overflowing the stack", () => {
			const cyclic: Record<string, unknown> = { a: 1 };
			cyclic.self = cyclic;
			expect(() =>
				serializeTransactionalPayload({
					template_id: 3,
					data: cyclic,
				}),
			).toThrow(/Circular reference detected/);
		});
	});

describe("computeTransactionalTargetHash", () => {
		test("differs across Listmonk targets", () => {
			const staging = computeTransactionalTargetHash({
				baseUrl: "http://staging.example.com/api",
				username: "ops",
			});
			const production = computeTransactionalTargetHash({
				baseUrl: "https://listmonk.example.com/api",
				username: "ops",
			});
			expect(staging).not.toBe(production);
		});

		test("produces a 64-bit (16 hex char) collision-resistant digest", () => {
			// 32-bit FNV was trivially collidable; the dual-seed 64-bit
			// form raises deliberate-collision cost above practical reach.
			const hash = computeTransactionalTargetHash({
				baseUrl: "http://x/api",
				username: "ops",
			});
			expect(hash).toMatch(/^[0-9a-f]{16}$/);
		});

		test("ignores leading/trailing whitespace", () => {
			const a = computeTransactionalTargetHash({
				baseUrl: "http://x/api",
				username: "ops",
			});
			const b = computeTransactionalTargetHash({
				baseUrl: "  http://x/api  ",
				username: "  ops  ",
			});
			expect(a).toBe(b);
		});
	});

describe("isAmbiguousTransportError", () => {
	test("flags timeout, connection reset, fetch failures, and aborts", () => {
		expect(isAmbiguousTransportError(new Error("Request timed out"))).toBe(true);
		expect(isAmbiguousTransportError(new Error("ECONNRESET"))).toBe(true);
		expect(isAmbiguousTransportError(new Error("fetch failed"))).toBe(true);
		expect(isAmbiguousTransportError(new Error("connect ENETUNREACH"))).toBe(
			true,
		);
		expect(isAmbiguousTransportError(new Error("The operation was aborted"))).toBe(
			true,
		);
	});

	test("does not flag definitive connection-refused or DNS failures", () => {
		expect(isAmbiguousTransportError(new Error("connect ECONNREFUSED"))).toBe(
			false,
		);
		expect(isAmbiguousTransportError(new Error("getaddrinfo ENOTFOUND"))).toBe(
			false,
		);
	});

	test("does not flag explicit Listmonk application errors", () => {
		expect(isAmbiguousTransportError(new Error("template not found"))).toBe(
			false,
		);
		expect(isAmbiguousTransportError(new Error("subscriber blocklisted"))).toBe(
			false,
		);
		expect(isAmbiguousTransportError(new Error("invalid network configuration"))).toBe(
			false,
		);
	});

	test("does not flag non-Error values", () => {
		expect(isAmbiguousTransportError("timeout")).toBe(false);
		expect(isAmbiguousTransportError({ code: "ECONNRESET" })).toBe(false);
	});
});

describe("isDefinitivePreDispatchError", () => {
		test("flags connection-refused and DNS failures as proven pre-dispatch", () => {
			expect(
				isDefinitivePreDispatchError(new Error("connect ECONNREFUSED 127.0.0.1:9000")),
			).toBe(true);
			expect(
				isDefinitivePreDispatchError(new Error("getaddrinfo ENOTFOUND example.com")),
			).toBe(true);
		});

		test("recognizes Bun fetch error codes that omit ECONNREFUSED from the message", () => {
			// Bun's fetch reports `error.code === "ConnectionRefused"` /
			// `"HostNotFoundError"` rather than embedding the errno in the
			// message, so a message-only check would miss them.
			const refused = Object.assign(new Error("Unable to connect"), {
				code: "ConnectionRefused",
			});
			const dns = Object.assign(new Error("Unable to resolve host"), {
				code: "HostNotFoundError",
			});
			const getaddr = Object.assign(new Error("getaddrinfo failed"), {
				code: "GetAddrInfoFailed",
			});
			expect(isDefinitivePreDispatchError(refused)).toBe(true);
			expect(isDefinitivePreDispatchError(dns)).toBe(true);
			expect(isDefinitivePreDispatchError(getaddr)).toBe(true);
		});

		test("recognizes Node errno codes nested in error.cause.code", () => {
			// undici typically throws TypeError("fetch failed") with the
			// system error as cause; the errno lives on cause.code.
			const cause = Object.assign(new Error("connect ECONNREFUSED"), {
				code: "ECONNREFUSED",
			});
			const wrapped = Object.assign(new TypeError("fetch failed"), {
				cause,
			});
			expect(isDefinitivePreDispatchError(wrapped)).toBe(true);
		});

		test("does not flag ambiguous transport failures", () => {
			// These may have reached Listmonk; only `unknown` is safe.
			expect(isDefinitivePreDispatchError(new Error("fetch failed"))).toBe(false);
			expect(isDefinitivePreDispatchError(new Error("Request timed out"))).toBe(false);
			expect(isDefinitivePreDispatchError(new Error("ECONNRESET"))).toBe(false);
			expect(isDefinitivePreDispatchError(new Error("connect ENETUNREACH"))).toBe(false);
		});

		test("does not flag post-dispatch response parse failures", () => {
			// A 2xx body that fails JSON.parse may still have been delivered.
			expect(
				isDefinitivePreDispatchError(new SyntaxError("Unexpected end of JSON input")),
			).toBe(false);
		});

		test("flags definitive 4xx HTTP rejections as pre-dispatch", () => {
			// 401/403/404/422 reached Listmonk but were rejected before
			// dispatch — safe to release so a retry can dispatch once the
			// underlying issue (credentials, payload, routing) is fixed.
			for (const status of [400, 401, 403, 404, 422]) {
				const error = Object.assign(new Error("request rejected"), {
					httpStatus: status,
				});
				expect(isDefinitivePreDispatchError(error)).toBe(true);
			}
		});

		test("does not flag 5xx server errors as pre-dispatch", () => {
			// 5xx means Listmonk may have partially processed the message.
			for (const status of [500, 502, 503, 504]) {
				const error = Object.assign(new Error("server error"), {
					httpStatus: status,
				});
				expect(isDefinitivePreDispatchError(error)).toBe(false);
			}
		});

		test("treats httpStatus as authoritative over transport-message heuristics", () => {
			// A 5xx body that happens to contain "ECONNREFUSED" must NOT be
			// released; the server reached Listmonk and may have partially
			// processed the message. Status is checked before message text.
			const misleading5xx = Object.assign(
				new Error("upstream reported ECONNREFUSED in the error body"),
				{ httpStatus: 502 },
			);
			expect(isDefinitivePreDispatchError(misleading5xx)).toBe(false);
		});

		test("does not flag application errors", () => {
			expect(
				isDefinitivePreDispatchError(new Error("template not found")),
			).toBe(false);
		});
	});
});
