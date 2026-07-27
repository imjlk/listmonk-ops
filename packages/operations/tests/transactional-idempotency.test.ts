import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	claimTransactionalSend,
	commitTransactionalSend,
	computeTransactionalPayloadHash,
	computeTransactionalTargetHash,
	getTransactionalStorePath,
	isAmbiguousTransportError,
	loadStoredTransactionalDocument,
	validateStoredTransactionalStore,
	DEFAULT_TRANSACTIONAL_TTL_MS,
} from "../src";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

const fixedClock = (): Date => FIXED_NOW;

const DEFAULT_TARGET_HASH = computeTransactionalTargetHash({
	baseUrl: "http://localhost:9000/api",
	username: "api-admin",
});

const OTHER_TARGET_HASH = computeTransactionalTargetHash({
	baseUrl: "https://listmonk.example.com/api",
	username: "ops",
});

function makePayload(
	overrides: Partial<{
		template_id: number;
		subscriber_email: string;
		from_email: string;
		data: Record<string, unknown>;
		headers: Array<Record<string, string>>;
		content_type: "html" | "markdown" | "plain";
	}> = {},
) {
	return {
		template_id: overrides.template_id ?? 3,
		subscriber_email: overrides.subscriber_email ?? "recipient@example.com",
		from_email: overrides.from_email ?? "Sender <sender@example.com>",
		data: overrides.data ?? { order_id: "OPS-1" },
		headers: overrides.headers ?? [{ "X-Request-ID": "req-1" }],
		content_type: overrides.content_type ?? "html",
	};
}

async function claimAndCommitAccepted(
	storePath: string,
	key: string,
	payloadHash: string,
	targetHash = DEFAULT_TARGET_HASH,
): Promise<void> {
	const claim = await claimTransactionalSend({
		storePath,
		key,
		payloadHash,
		targetHash,
		now: fixedClock,
	});
	if (claim.kind !== "new") {
		throw new Error(`expected new claim, got ${claim.kind}`);
	}
	await commitTransactionalSend({
		storePath,
		key,
		claimToken: claim.record.claimToken,
		status: "accepted",
		sent: true,
		now: fixedClock,
	});
}

describe("transactional idempotency store", () => {
	let tempDir: string;
	let storePath: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-tx-idem-"));
		storePath = join(tempDir, "transactional.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	describe("getTransactionalStorePath", () => {
		test("honors the LISTMONK_OPS_TRANSACTIONAL_STORE env override", () => {
			const previous = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
			process.env.LISTMONK_OPS_TRANSACTIONAL_STORE =
				"/tmp/custom-tx-store.json";
			try {
				expect(getTransactionalStorePath()).toBe(
					"/tmp/custom-tx-store.json",
				);
			} finally {
				if (previous === undefined) {
					delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
				} else {
					process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = previous;
				}
			}
		});

		test("falls back to ~/.listmonk-ops/transactional.json when env unset", () => {
			const previous = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
			delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
			try {
				expect(getTransactionalStorePath()).toBe(
					join(homedir(), ".listmonk-ops", "transactional.json"),
				);
			} finally {
				if (previous !== undefined) {
					process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = previous;
				}
			}
		});
	});

	describe("computeTransactionalTargetHash", () => {
		test("differs across Listmonk targets", () => {
			expect(DEFAULT_TARGET_HASH).not.toBe(OTHER_TARGET_HASH);
		});

		test("is stable for identical inputs", () => {
			expect(
				computeTransactionalTargetHash({
					baseUrl: "http://localhost:9000/api",
					username: "api-admin",
				}),
			).toBe(DEFAULT_TARGET_HASH);
		});

		test("ignores leading/trailing whitespace in inputs", () => {
			expect(
				computeTransactionalTargetHash({
					baseUrl: "  http://localhost:9000/api  ",
					username: "  api-admin  ",
				}),
			).toBe(DEFAULT_TARGET_HASH);
		});
	});

	describe("computeTransactionalPayloadHash", () => {
		test("is stable across object key reordering", () => {
			const payloadA = makePayload({ data: { a: 1, b: 2, c: 3 } });
			const payloadB = makePayload({ data: { c: 3, a: 1, b: 2 } });
			expect(computeTransactionalPayloadHash(payloadA)).toBe(
				computeTransactionalPayloadHash(payloadB),
			);
		});

		test("changes when any field changes", () => {
			const base = makePayload();
			expect(computeTransactionalPayloadHash(base)).not.toBe(
				computeTransactionalPayloadHash(makePayload({ template_id: 4 })),
			);
			expect(computeTransactionalPayloadHash(base)).not.toBe(
				computeTransactionalPayloadHash(
					makePayload({ subscriber_email: "other@example.com" }),
				),
			);
			expect(computeTransactionalPayloadHash(base)).not.toBe(
				computeTransactionalPayloadHash(
					makePayload({ content_type: "plain" }),
				),
			);
		});

		test("treats Date instances like their transport ISO string", () => {
			// The wire body serializes a Date as its ISO string; the hash must
			// agree so reusing a key across structurally equal payloads does
			// not falsely conflict.
			const withDate = makePayload({ data: { when: new Date("2026-01-01T00:00:00.000Z") } });
			const withIso = makePayload({ data: { when: "2026-01-01T00:00:00.000Z" } });
			expect(computeTransactionalPayloadHash(withDate)).toBe(
				computeTransactionalPayloadHash(withIso),
			);
		});

		test("treats undefined inside arrays like null (transport semantics)", () => {
			// JSON.stringify([undefined]) === "[null]"; the hash must match.
			const withUndef = makePayload({ data: { xs: [undefined] } });
			const withNull = makePayload({ data: { xs: [null] } });
			expect(computeTransactionalPayloadHash(withUndef)).toBe(
				computeTransactionalPayloadHash(withNull),
			);
		});

		test("excludes undefined optional fields deterministically", () => {
			const withFrom = makePayload({ from_email: "x@example.com" });
			const withoutFrom = { ...withFrom, from_email: undefined };
			expect(computeTransactionalPayloadHash(withFrom)).not.toBe(
				computeTransactionalPayloadHash(withoutFrom),
			);
		});

		test("rejects cyclic payloads instead of overflowing the stack", () => {
			const cyclic: Record<string, unknown> = { a: 1 };
			cyclic.self = cyclic;
			expect(() =>
				computeTransactionalPayloadHash(makePayload({ data: cyclic })),
			).toThrow(/Circular reference detected/);
		});

		test("handles repeated (non-cyclic) object references without false positives", () => {
			const shared = { tag: "x" };
			const payloadA = makePayload({
				data: { first: shared, second: shared },
			});
			expect(() =>
				computeTransactionalPayloadHash(payloadA),
			).not.toThrow();
		});
	});

	describe("claimTransactionalSend", () => {
		test("claims a new pending record on first use", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const result = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});

			expect(result.kind).toBe("new");
			if (result.kind !== "new") return;
			expect(result.record).toMatchObject({
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				status: "pending",
				createdAt: FIXED_NOW.toISOString(),
				updatedAt: FIXED_NOW.toISOString(),
				expiresAt: new Date(
					FIXED_NOW.getTime() + DEFAULT_TRANSACTIONAL_TTL_MS,
				).toISOString(),
			});
			expect(typeof result.record.claimToken).toBe("string");
			expect(result.record.claimToken).toMatch(/^[0-9a-f]{16}$/);

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]?.status).toBe("pending");
		});

		test("replays an accepted record with the same payload and target", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await claimAndCommitAccepted(storePath, "order-1", payloadHash);

			const second = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});

			expect(second.kind).toBe("replay");
			if (second.kind === "replay") {
				expect(second.record.status).toBe("accepted");
				expect(second.record.sent).toBe(true);
			}
		});

		test("replays a failed record without re-dispatching", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const claim = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			if (claim.kind !== "new") throw new Error("expected new claim");
			await commitTransactionalSend({
				storePath,
				key: "order-1",
				claimToken: claim.record.claimToken,
				status: "failed",
				sent: false,
				errorMessage: "template disabled",
				now: fixedClock,
			});

			const replay = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			expect(replay.kind).toBe("replay");
			if (replay.kind === "replay") {
				expect(replay.record.status).toBe("failed");
				expect(replay.record.sent).toBe(false);
			}
		});

		test("returns conflict when payload differs for the same key", async () => {
			const hashA = computeTransactionalPayloadHash(
				makePayload({ data: { order_id: "OPS-1" } }),
			);
			const hashB = computeTransactionalPayloadHash(
				makePayload({ data: { order_id: "OPS-2" } }),
			);

			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash: hashA,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			const second = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash: hashB,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});

			expect(second.kind).toBe("conflict");
			if (second.kind === "conflict") {
				expect(second.existing.payloadHash).toBe(hashA);
			}
		});

		test("returns conflict when target differs for the same key", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			const second = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: OTHER_TARGET_HASH,
				now: fixedClock,
			});
			expect(second.kind).toBe("conflict");
		});

		test("treats an expired record as a fresh claim", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const shortTtl = 1;
			const first = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				ttlMs: shortTtl,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
			});
			if (first.kind !== "new") throw new Error("expected new");

			// Advance the clock past expiry.
			const later = () => new Date("2026-01-02T00:00:00.000Z");
			const result = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: later,
			});

			expect(result.kind).toBe("new");
			if (result.kind === "new") {
				expect(result.record.createdAt).toBe(later().toISOString());
			}
		});

		test("replays pending/unknown records to block silent re-dispatch", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			for (const status of ["pending", "unknown", "failed"] as const) {
				const dir = await mkdtemp(
					join(tmpdir(), "listmonk-ops-tx-idem-cycle-"),
				);
				const path = join(dir, "transactional.json");
				try {
					const claim = await claimTransactionalSend({
						storePath: path,
						key: `order-${status}`,
						payloadHash,
						targetHash: DEFAULT_TARGET_HASH,
						now: fixedClock,
					});
					if (claim.kind !== "new") throw new Error("expected new");
					if (status !== "pending") {
						await commitTransactionalSend({
							storePath: path,
							key: `order-${status}`,
							claimToken: claim.record.claimToken,
							status,
							sent: status === "failed" ? false : undefined,
							errorMessage: "boom",
							now: fixedClock,
						});
					}

					const replay = await claimTransactionalSend({
						storePath: path,
						key: `order-${status}`,
						payloadHash,
						targetHash: DEFAULT_TARGET_HASH,
						now: fixedClock,
					});
					// pending/unknown → replay (caller surfaces reconcile error);
					// failed → replay (caller returns stored negative ack).
					expect(replay.kind).toBe("replay");
					if (replay.kind === "replay") {
						expect(replay.record.status).toBe(status);
					}
				} finally {
					await rm(dir, { recursive: true, force: true });
				}
			}
		});

		test("does not consult Object.prototype for inherited keys", async () => {
			// A bare records[key] lookup would return an inherited value for
			// 'constructor'/'toString'/'__proto__' and follow the conflict
			// path. Own-property lookup must treat these as fresh claims.
			for (const inheritedKey of ["constructor", "toString", "__proto__"]) {
				const dir = await mkdtemp(
					join(tmpdir(), "listmonk-ops-tx-proto-"),
				);
				const path = join(dir, "transactional.json");
				try {
					const payloadHash = computeTransactionalPayloadHash(
						makePayload(),
					);
					const result = await claimTransactionalSend({
						storePath: path,
						key: inheritedKey,
						payloadHash,
						targetHash: DEFAULT_TARGET_HASH,
						now: fixedClock,
					});
					expect(result.kind).toBe("new");
				} finally {
					await rm(dir, { recursive: true, force: true });
				}
			}
		});
	});

	describe("commitTransactionalSend", () => {
		test("transitions a claimed record to accepted with sent:true", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const claim = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			if (claim.kind !== "new") throw new Error("expected new claim");

			await commitTransactionalSend({
				storePath,
				key: "order-1",
				claimToken: claim.record.claimToken,
				status: "accepted",
				sent: true,
				now: fixedClock,
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]).toMatchObject({
				status: "accepted",
				sent: true,
			});
		});

		test("coerces accepted commits to sent:true even when caller omits sent", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const claim = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			if (claim.kind !== "new") throw new Error("expected new claim");

			await commitTransactionalSend({
				storePath,
				key: "order-1",
				claimToken: claim.record.claimToken,
				status: "accepted",
				now: fixedClock,
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]?.sent).toBe(true);
		});

		test("records the error message on failed/unknown outcomes", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const claim = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			if (claim.kind !== "new") throw new Error("expected new claim");

			await commitTransactionalSend({
				storePath,
				key: "order-1",
				claimToken: claim.record.claimToken,
				status: "unknown",
				errorMessage: "fetch failed: ECONNRESET",
				now: fixedClock,
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]).toMatchObject({
				status: "unknown",
				errorMessage: "fetch failed: ECONNRESET",
			});
		});

		test("is a no-op when the claim token does not match (stale commit)", async () => {
			// Simulate: dispatch A claims, record expires, dispatch B reclaims
			// with a new token, then A tries to commit.
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const first = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				ttlMs: 1,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
			});
			if (first.kind !== "new") throw new Error("expected new");
			const staleToken = first.record.claimToken;

			// Advance past expiry and reclaim.
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: () => new Date("2026-01-02T00:00:00.000Z"),
			});

			// Stale commit must NOT overwrite the fresh claim.
			await commitTransactionalSend({
				storePath,
				key: "order-1",
				claimToken: staleToken,
				status: "accepted",
				sent: true,
				now: () => new Date("2026-01-02T00:00:00.000Z"),
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]?.status).toBe("pending");
		});

		test("is a no-op when the record has vanished", async () => {
			await commitTransactionalSend({
				storePath,
				key: "never-claimed",
				claimToken: "deadbeefdeadbeef",
				status: "accepted",
				sent: true,
				now: fixedClock,
			});
			const stored = await loadStoredTransactionalDocument(storePath);
			expect(Object.keys(stored.records)).toEqual([]);
		});
	});

	describe("validateStoredTransactionalStore", () => {
		test("accepts a well-formed v1 document", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			await expect(
				validateStoredTransactionalStore(storePath),
			).resolves.toBeUndefined();
		});

		test("rejects an unsupported schema version", async () => {
			await writeFile(
				storePath,
				JSON.stringify({ version: 99, records: {} }, null, 2),
			);
			await expect(
				validateStoredTransactionalStore(storePath),
			).rejects.toThrow(/unsupported schema version/);
		});

		test("rejects a malformed record", async () => {
			await writeFile(
				storePath,
				JSON.stringify(
					{
						version: 1,
						records: {
							"order-1": {
								key: "order-1",
								// missing payloadHash, status, timestamps
							},
						},
					},
					null,
					2,
				),
			);
			await expect(
				validateStoredTransactionalStore(storePath),
			).rejects.toThrow(/record 'order-1' failed schema validation/);
		});

		test("rejects a record whose key does not match the map key", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const validRecord = {
				key: "wrong-key",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				status: "accepted",
				sent: true,
				claimToken: "abcdef0123456789",
				createdAt: FIXED_NOW.toISOString(),
				updatedAt: FIXED_NOW.toISOString(),
				expiresAt: FIXED_NOW.toISOString(),
			};
			await writeFile(
				storePath,
				JSON.stringify(
					{ version: 1, records: { "order-1": validRecord } },
					null,
					2,
				),
			);
			await expect(
				validateStoredTransactionalStore(storePath),
			).rejects.toThrow(/does not match map key/);
		});

		test("rejects a non-object root", async () => {
			await writeFile(storePath, JSON.stringify([1, 2, 3], null, 2));
			await expect(
				validateStoredTransactionalStore(storePath),
			).rejects.toThrow(/expected an object/);
		});

		test("rejects an accepted record without sent:true", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const badRecord = {
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				status: "accepted",
				sent: false, // invariant violation
				claimToken: "abcdef0123456789",
				createdAt: FIXED_NOW.toISOString(),
				updatedAt: FIXED_NOW.toISOString(),
				expiresAt: FIXED_NOW.toISOString(),
			};
			await writeFile(
				storePath,
				JSON.stringify(
					{ version: 1, records: { "order-1": badRecord } },
					null,
					2,
				),
			);
			await expect(
				validateStoredTransactionalStore(storePath),
			).rejects.toThrow(/failed schema validation/);
		});

		test("rejects locale-style or slash timestamps that Date.parse accepts", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			for (const malformedTimestamp of [
				"July 4, 2024",
				"2024/01/15",
				"2024-01-15",
				"not-a-date",
			]) {
				const validShape = {
					key: "order-1",
					payloadHash,
					targetHash: DEFAULT_TARGET_HASH,
					status: "accepted",
					sent: true,
					claimToken: "abcdef0123456789",
					createdAt: malformedTimestamp,
					updatedAt: FIXED_NOW.toISOString(),
					expiresAt: FIXED_NOW.toISOString(),
				};
				await writeFile(
					storePath,
					JSON.stringify(
						{ version: 1, records: { "order-1": validShape } },
						null,
						2,
					),
				);
				await expect(
					validateStoredTransactionalStore(storePath),
				).rejects.toThrow(/failed schema validation/);
			}
		});

		test("accepts ISO 8601 timestamps with millisecond and timezone variants", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			for (const validTimestamp of [
				FIXED_NOW.toISOString(),
				"2026-01-01T00:00:00.123Z",
				"2026-01-01T00:00:00+09:00",
				"2026-01-01T00:00:00.123456789Z",
			]) {
				const record = {
					key: "order-1",
					payloadHash,
					targetHash: DEFAULT_TARGET_HASH,
					status: "accepted" as const,
					sent: true,
					claimToken: "abcdef0123456789",
					createdAt: validTimestamp,
					updatedAt: validTimestamp,
					expiresAt: validTimestamp,
				};
				await writeFile(
					storePath,
					JSON.stringify(
						{ version: 1, records: { "order-1": record } },
						null,
						2,
					),
				);
				await expect(
					validateStoredTransactionalStore(storePath),
				).resolves.toBeUndefined();
			}
		});
	});

	describe("atomic read-modify-write", () => {
		test("serialized claims never lose a record to a concurrent writer", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await Promise.all([
				claimTransactionalSend({
					storePath,
					key: "order-A",
					payloadHash,
					targetHash: DEFAULT_TARGET_HASH,
					now: fixedClock,
				}),
				claimTransactionalSend({
					storePath,
					key: "order-B",
					payloadHash,
					targetHash: DEFAULT_TARGET_HASH,
					now: fixedClock,
				}),
			]);

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(Object.keys(stored.records).sort()).toEqual([
				"order-A",
				"order-B",
			]);
		});

		test("purges expired records during a locked update", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			// Seed an expired record with a 1ms TTL.
			await claimTransactionalSend({
				storePath,
				key: "expired",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				ttlMs: 1,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
			});
			// A later claim for a different key should sweep the expired one.
			await claimTransactionalSend({
				storePath,
				key: "fresh",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: () => new Date("2026-01-02T00:00:00.000Z"),
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(Object.keys(stored.records).sort()).toEqual(["fresh"]);
		});
	});

	describe("isAmbiguousTransportError", () => {
		test("flags timeout, connection reset, and abort signals", () => {
			expect(isAmbiguousTransportError(new Error("Request timed out"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("ECONNRESET"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("fetch failed"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("The operation was aborted"))).toBe(true);
		});

		test("flags ENETUNREACH and 'network is unreachable' as ambiguous", () => {
			expect(isAmbiguousTransportError(new Error("connect ENETUNREACH"))).toBe(true);
			expect(
				isAmbiguousTransportError(new Error("Network is unreachable")),
			).toBe(true);
		});

		test("flags a specific network-error phrase", () => {
			expect(isAmbiguousTransportError(new Error("network error"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("TypeError: network error"))).toBe(true);
		});

		test("does not flag definitive connection-refused or DNS failures", () => {
			// ECONNREFUSED (nothing listening) and ENOTFOUND (DNS) are
			// definitive — the request never reached Listmonk, so a retry
			// is safe and classifying them as unknown would needlessly
			// block the caller for the TTL window.
			expect(isAmbiguousTransportError(new Error("connect ECONNREFUSED"))).toBe(false);
			expect(isAmbiguousTransportError(new Error("getaddrinfo ENOTFOUND"))).toBe(false);
		});

		test("does not flag definitive network-policy rejections", () => {
			expect(
				isAmbiguousTransportError(
					new Error("invalid network configuration"),
				),
			).toBe(false);
			expect(
				isAmbiguousTransportError(new Error("network policy violation")),
			).toBe(false);
		});

		test("does not flag explicit Listmonk rejections", () => {
			expect(isAmbiguousTransportError(new Error("template not found"))).toBe(false);
			expect(isAmbiguousTransportError(new Error("subscriber blocklisted"))).toBe(false);
		});

		test("does not flag non-Error values", () => {
			expect(isAmbiguousTransportError("timeout")).toBe(false);
			expect(isAmbiguousTransportError({ code: "ECONNRESET" })).toBe(false);
		});
	});
});
