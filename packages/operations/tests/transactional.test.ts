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
});

describe("transactional idempotency pure helpers", () => {
	describe("serializeTransactionalPayload", () => {
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
			expect(isAmbiguousTransportError(new Error("connect ENETUNREACH"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("The operation was aborted"))).toBe(true);
		});

		test("does not flag definitive connection-refused or DNS failures", () => {
			expect(isAmbiguousTransportError(new Error("connect ECONNREFUSED"))).toBe(false);
			expect(isAmbiguousTransportError(new Error("getaddrinfo ENOTFOUND"))).toBe(false);
		});

		test("does not flag explicit Listmonk application errors", () => {
			expect(isAmbiguousTransportError(new Error("template not found"))).toBe(false);
			expect(isAmbiguousTransportError(new Error("subscriber blocklisted"))).toBe(false);
			expect(isAmbiguousTransportError(new Error("invalid network configuration"))).toBe(false);
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

		test("does not flag application errors", () => {
			expect(
				isDefinitivePreDispatchError(new Error("template not found")),
			).toBe(false);
		});
	});
});
