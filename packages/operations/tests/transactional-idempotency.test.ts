import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	claimTransactionalSend,
	commitTransactionalSend,
	computeTransactionalPayloadHash,
	getTransactionalStorePath,
	isAmbiguousTransportError,
	loadStoredTransactionalDocument,
	validateStoredTransactionalStore,
	DEFAULT_TRANSACTIONAL_TTL_MS,
} from "../src";

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

const fixedClock = (): Date => FIXED_NOW;

function makePayload(overrides: Partial<{
	template_id: number;
	subscriber_email: string;
	from_email: string;
	data: Record<string, unknown>;
	headers: Array<Record<string, string>>;
	content_type: "html" | "markdown" | "plain";
}> = {}) {
	return {
		template_id: overrides.template_id ?? 3,
		subscriber_email: overrides.subscriber_email ?? "recipient@example.com",
		from_email: overrides.from_email ?? "Sender <sender@example.com>",
		data: overrides.data ?? { order_id: "OPS-1" },
		headers: overrides.headers ?? [{ "X-Request-ID": "req-1" }],
		content_type: overrides.content_type ?? "html",
	};
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

	describe("computeTransactionalPayloadHash", () => {
		test("is stable across object key reordering", () => {
			const payloadA = makePayload({
				data: { a: 1, b: 2, c: 3 },
			});
			const payloadB = makePayload({
				data: { c: 3, a: 1, b: 2 },
			});
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

		test("excludes undefined optional fields deterministically", () => {
			const withFrom = makePayload({ from_email: "x@example.com" });
			const withoutFrom = { ...withFrom, from_email: undefined };
			expect(computeTransactionalPayloadHash(withFrom)).not.toBe(
				computeTransactionalPayloadHash(withoutFrom),
			);
		});
	});

	describe("claimTransactionalSend", () => {
		test("claims a new pending record on first use", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const result = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				now: fixedClock,
			});

			expect(result).toEqual({
				kind: "new",
				record: {
					key: "order-1",
					payloadHash,
					status: "pending",
					createdAt: FIXED_NOW.toISOString(),
					updatedAt: FIXED_NOW.toISOString(),
					expiresAt: new Date(
						FIXED_NOW.getTime() + DEFAULT_TRANSACTIONAL_TTL_MS,
					).toISOString(),
				},
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"].status).toBe("pending");
		});

		test("replays an accepted record with the same payload", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				now: fixedClock,
			});
			await commitTransactionalSend({
				storePath,
				key: "order-1",
				status: "accepted",
				sent: true,
				now: fixedClock,
			});

			const second = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				now: fixedClock,
			});

			expect(second.kind).toBe("replay");
			if (second.kind === "replay") {
				expect(second.record.status).toBe("accepted");
				expect(second.record.sent).toBe(true);
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
				now: fixedClock,
			});
			const second = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash: hashB,
				now: fixedClock,
			});

			expect(second.kind).toBe("conflict");
			if (second.kind === "conflict") {
				expect(second.existing.payloadHash).toBe(hashA);
			}
		});

		test("treats an expired record as a fresh claim", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const shortTtl = 1; // 1ms
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				ttlMs: shortTtl,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
			});

			// Advance the clock past expiry.
			const later = () => new Date("2026-01-02T00:00:00.000Z");
			const result = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				now: later,
			});

			expect(result.kind).toBe("new");
			if (result.kind === "new") {
				expect(result.record.createdAt).toBe(later().toISOString());
			}
		});

		test("replays pending/unknown/failed records to block silent re-dispatch", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			for (const status of ["pending", "unknown", "failed"] as const) {
				const dir = await mkdtemp(join(tmpdir(), "listmonk-ops-tx-idem-cycle-"));
				const path = join(dir, "transactional.json");
				try {
					await claimTransactionalSend({
						storePath: path,
						key: `order-${status}`,
						payloadHash,
						now: fixedClock,
					});
					if (status !== "pending") {
						await commitTransactionalSend({
							storePath: path,
							key: `order-${status}`,
							status,
							sent: false,
							errorMessage: "boom",
							now: fixedClock,
						});
					}

					const replay = await claimTransactionalSend({
						storePath: path,
						key: `order-${status}`,
						payloadHash,
						now: fixedClock,
					});
					expect(replay.kind).toBe("replay");
					if (replay.kind === "replay") {
						expect(replay.record.status).toBe(status);
					}
				} finally {
					await rm(dir, { recursive: true, force: true });
				}
			}
		});
	});

	describe("commitTransactionalSend", () => {
		test("transitions a claimed record to accepted", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				now: fixedClock,
			});
			await commitTransactionalSend({
				storePath,
				key: "order-1",
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

		test("records the error message on failed/unknown outcomes", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				now: fixedClock,
			});
			await commitTransactionalSend({
				storePath,
				key: "order-1",
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

		test("is a no-op when the record has vanished", async () => {
			// Commit on a store with no prior claim must not throw.
			await commitTransactionalSend({
				storePath,
				key: "never-claimed",
				status: "accepted",
				sent: true,
				now: fixedClock,
			});
			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records).toEqual({});
		});
	});

	describe("validateStoredTransactionalStore", () => {
		test("accepts a well-formed v1 document", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				now: fixedClock,
			});
			await expect(validateStoredTransactionalStore(storePath)).resolves.toBeUndefined();
		});

		test("rejects an unsupported schema version", async () => {
			await writeFile(
				storePath,
				JSON.stringify({ version: 99, records: {} }, null, 2),
			);
			await expect(validateStoredTransactionalStore(storePath)).rejects.toThrow(
				/unsupported schema version/,
			);
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
			await expect(validateStoredTransactionalStore(storePath)).rejects.toThrow(
				/record 'order-1' failed schema validation/,
			);
		});

		test("rejects a record whose key does not match the map key", async () => {
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			const validRecord = {
				key: "wrong-key",
				payloadHash,
				status: "accepted",
				sent: true,
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
			await expect(validateStoredTransactionalStore(storePath)).rejects.toThrow(
				/does not match map key/,
			);
		});

		test("rejects a non-object root", async () => {
			await writeFile(storePath, JSON.stringify([1, 2, 3], null, 2));
			await expect(validateStoredTransactionalStore(storePath)).rejects.toThrow(
				/expected an object/,
			);
		});
	});

	describe("atomic read-modify-write", () => {
		test("serialized claims never lose a record to a concurrent writer", async () => {
			// The store's lock serializes updateJsonFileStore callers, so two
			// claims for different keys must both land in the final file.
			const payloadHash = computeTransactionalPayloadHash(makePayload());
			await Promise.all([
				claimTransactionalSend({
					storePath,
					key: "order-A",
					payloadHash,
					now: fixedClock,
				}),
				claimTransactionalSend({
					storePath,
					key: "order-B",
					payloadHash,
					now: fixedClock,
				}),
			]);

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(Object.keys(stored.records).sort()).toEqual([
				"order-A",
				"order-B",
			]);
		});
	});

	describe("isAmbiguousTransportError", () => {
		test("flags timeout, connection reset, and abort signals", () => {
			expect(isAmbiguousTransportError(new Error("Request timed out"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("ECONNRESET"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("fetch failed"))).toBe(true);
			expect(isAmbiguousTransportError(new Error("The operation was aborted"))).toBe(true);
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
