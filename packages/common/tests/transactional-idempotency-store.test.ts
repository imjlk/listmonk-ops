import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	claimTransactionalSend,
	commitTransactionalSend,
	computeTransactionalTargetHash,
	createFileBackedTransactionalIdempotencyStore,
	createTransactionalStoreCapacityError,
	getTransactionalStoreMaxRecords,
	getTransactionalStorePath,
	hashTransactionalPayload,
	isStoredTransactionalSendRecord,
	loadStoredTransactionalDocument,
	parseStoredTransactionalDocument,
	reconcileTransactionalSend,
	releaseTransactionalSend,
	TransactionalStoreCapacityError,
	TRANSACTIONAL_STORE_MAX_RECORDS,
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

/**
 * Hash helper for tests. The store treats `payloadHash` as an opaque
 * equality token; canonical serialization correctness is exercised in the
 * operations package's pure-function tests.
 */
function hashPayload(value: unknown): string {
	return hashTransactionalPayload(JSON.stringify(value));
}

interface Payload {
	template_id: number;
	subscriber_email: string;
	data: Record<string, unknown>;
}

function makePayload(overrides: Partial<Payload> = {}): Payload {
	return {
		template_id: overrides.template_id ?? 3,
		subscriber_email: overrides.subscriber_email ?? "recipient@example.com",
		data: overrides.data ?? { order_id: "OPS-1" },
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

describe("transactional idempotency file-backed store", () => {
	let tempDir: string;
	let storePath: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-tx-store-"));
		storePath = join(tempDir, "transactional.json");
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("requires target and revision to reconcile an unknown record without dispatching", async () => {
		const key = "ambiguous-order";
		const claim = await claimTransactionalSend({ storePath, key, payloadHash: hashPayload(makePayload()), targetHash: DEFAULT_TARGET_HASH, now: fixedClock });
		if (claim.kind !== "new") throw new Error("expected new claim");
		await commitTransactionalSend({ storePath, key, claimToken: claim.record.claimToken, status: "unknown", now: fixedClock });
		const args = { storePath, key, targetHash: DEFAULT_TARGET_HASH, expectedRevision: claim.record.claimToken, decision: "accepted" as const, reason: "Confirmed delivery in Mailpit", now: fixedClock };
		await expect(reconcileTransactionalSend({ ...args, targetHash: OTHER_TARGET_HASH })).rejects.toThrow("not found");
		await expect(reconcileTransactionalSend({ ...args, expectedRevision: "stale" })).rejects.toThrow("changed");
		const result = await reconcileTransactionalSend(args);
		expect(result.decision).toBe("accepted");
		const stored = await loadStoredTransactionalDocument(storePath);
		expect(stored.records[key]).toMatchObject({ status: "accepted", sent: true, claimToken: result.revision });
		expect(stored.reconciliations?.at(-1)).toMatchObject({ key, decision: "accepted", reason: "Confirmed delivery in Mailpit", previousStatus: "unknown", previousRevision: claim.record.claimToken, payloadHash: claim.record.payloadHash });
		await expect(reconcileTransactionalSend(args)).rejects.toThrow("changed");
	});

	test("records verified delivery immediately for a pending claim and fences its later commit", async () => {
		const key = "verified-pending";
		const claim = await claimTransactionalSend({ storePath, key, payloadHash: hashPayload(makePayload()), targetHash: DEFAULT_TARGET_HASH, now: fixedClock });
		if (claim.kind !== "new") throw new Error("expected new claim");
		await reconcileTransactionalSend({ storePath, key, targetHash: DEFAULT_TARGET_HASH, expectedRevision: claim.record.claimToken, decision: "accepted", reason: "Verified delivered in provider logs", now: fixedClock });
		await commitTransactionalSend({ storePath, key, claimToken: claim.record.claimToken, status: "failed", sent: false, now: fixedClock });
		expect((await loadStoredTransactionalDocument(storePath)).records[key]).toMatchObject({ status: "accepted", sent: true });
	});

	test("retains sequence recovery decisions while bounding direct-send history", async () => {
		const claim = await claimTransactionalSend({ storePath, key: "direct-new", payloadHash: "payload", targetHash: DEFAULT_TARGET_HASH, now: fixedClock });
		if (claim.kind !== "new") throw new Error("expected new claim");
		const sequenceKey = "sequence:00000000-0000-4000-8000-000000000001:revision:1:step:send";
		const event = (key: string) => ({
			key, targetHash: DEFAULT_TARGET_HASH, payloadHash: "payload",
			previousStatus: "pending" as const, previousRevision: "revision",
			decision: "retry" as const, reason: "Verified no delivery in provider logs",
			reconciledAt: FIXED_NOW.toISOString(),
		});
		await writeFile(storePath, JSON.stringify({
			version: 2,
			records: { [claim.record.key]: claim.record },
			reconciliations: [event(sequenceKey), ...Array.from({ length: 1_000 }, (_, index) => event(`direct-${index}`))],
		}));
		// Sequence receipts do not count toward the direct-send history cap.
		expect((await loadStoredTransactionalDocument(storePath)).reconciliations).toHaveLength(1_001);
		await reconcileTransactionalSend({ storePath, key: claim.record.key, targetHash: DEFAULT_TARGET_HASH, expectedRevision: claim.record.claimToken, decision: "accepted", reason: "Provider logs confirm delivery", now: fixedClock });
		const history = (await loadStoredTransactionalDocument(storePath)).reconciliations ?? [];
		expect(history.some((decision) => decision.key === sequenceKey)).toBe(true);
		expect(history.filter((decision) => !decision.key.startsWith("sequence:"))).toHaveLength(1_000);
	});

	test("retains an accepted sequence send across unrelated expiry sweeps until enrollment cleanup", async () => {
		const store = createFileBackedTransactionalIdempotencyStore({ storePath });
		const key = "sequence:00000000-0000-4000-8000-000000000001:revision:1:step:send";
		const claim = await store.claim({ key, payloadHash: "payload", targetHash: DEFAULT_TARGET_HASH, ttlMs: 1, now: fixedClock });
		if (claim.kind !== "new") throw new Error("expected new claim");
		await store.commit({ key, claimToken: claim.record.claimToken, status: "accepted", sent: true, now: fixedClock });
		const later = () => new Date("2026-01-02T00:00:00.000Z");
		await store.claim({ key: "unrelated", payloadHash: "other", targetHash: DEFAULT_TARGET_HASH, now: later });
		expect((await store.load()).records[key]?.status).toBe("accepted");
		expect(await store.get?.(key)).toMatchObject({ key, status: "accepted" });
		expect(await store.get?.("missing")).toBeUndefined();
		expect((await store.claim({ key, payloadHash: "payload", targetHash: DEFAULT_TARGET_HASH, now: later })).kind).toBe("replay");
		await store.forgetReconciliation?.({ key, targetHash: DEFAULT_TARGET_HASH });
		expect((await store.load()).records[key]).toBeUndefined();
	});

	test("requires an expired, quiesced pending claim before explicitly permitting a retry", async () => {
		const key = "pending-order";
		const claim = await claimTransactionalSend({ storePath, key, payloadHash: hashPayload(makePayload()), targetHash: DEFAULT_TARGET_HASH, ttlMs: 1, now: fixedClock });
		if (claim.kind !== "new") throw new Error("expected new claim");
		const args = { storePath, key, targetHash: DEFAULT_TARGET_HASH, expectedRevision: claim.record.claimToken, decision: "retry" as const, reason: "Confirmed no delivery in Mailpit" };
		await expect(reconcileTransactionalSend({ ...args, quiesced: true, now: fixedClock })).rejects.toThrow("may still be active");
		await expect(reconcileTransactionalSend({ ...args, now: () => new Date("2026-01-02T00:00:00Z") })).rejects.toThrow("may still be active");
		const result = await reconcileTransactionalSend({ ...args, quiesced: true, now: () => new Date("2026-01-02T00:00:00Z") });
		expect(result.decision).toBe("retry");
		expect((await loadStoredTransactionalDocument(storePath)).records[key]).toBeUndefined();
		await commitTransactionalSend({ storePath, key, claimToken: claim.record.claimToken, status: "accepted", now: () => new Date("2026-01-02T00:00:01Z") });
		expect((await loadStoredTransactionalDocument(storePath)).records[key]).toBeUndefined();
	});

	test("requires elapsed TTL and a stopped sender before permitting retry after an unknown outcome", async () => {
		const key = "unknown-order";
		const claim = await claimTransactionalSend({ storePath, key, payloadHash: hashPayload(makePayload()), targetHash: DEFAULT_TARGET_HASH, ttlMs: 1, now: fixedClock });
		if (claim.kind !== "new") throw new Error("expected new claim");
		await commitTransactionalSend({ storePath, key, claimToken: claim.record.claimToken, status: "unknown", now: fixedClock });
		const args = { storePath, key, targetHash: DEFAULT_TARGET_HASH, expectedRevision: claim.record.claimToken, decision: "retry" as const, reason: "Verified no delivery in provider logs" };
		await expect(reconcileTransactionalSend({ ...args, quiesced: true, now: fixedClock })).rejects.toThrow("may still be active");
		await expect(reconcileTransactionalSend({ ...args, now: () => new Date("2026-01-02T00:00:00Z") })).rejects.toThrow("may still be active");
		await expect(reconcileTransactionalSend({ ...args, quiesced: true, now: () => new Date("2026-01-02T00:00:00Z") })).resolves.toMatchObject({ decision: "retry" });
		const replacement = await claimTransactionalSend({ storePath, key, payloadHash: hashPayload(makePayload()), targetHash: DEFAULT_TARGET_HASH, now: () => new Date("2026-01-02T00:00:01Z") });
		expect(replacement.kind).toBe("new");
		expect((await loadStoredTransactionalDocument(storePath)).reconciliations?.at(-1)).toMatchObject({ key, decision: "retry", reason: "Verified no delivery in provider logs" });
	});

	test("migrates legacy version 1 claims to version 2 before replaying an expired pending send", async () => {
		const key = "legacy-pending";
		const claim = await claimTransactionalSend({ storePath, key, payloadHash: "payload", targetHash: DEFAULT_TARGET_HASH, ttlMs: 1, now: fixedClock });
		if (claim.kind !== "new") throw new Error("expected new claim");
		await writeFile(storePath, JSON.stringify({ version: 1, records: { [key]: claim.record } }));
		expect((await loadStoredTransactionalDocument(storePath)).records[key]?.status).toBe("pending");
		expect(JSON.parse(await readFile(storePath, "utf8")).version).toBe(2);
		const replay = await claimTransactionalSend({ storePath, key, payloadHash: "payload", targetHash: DEFAULT_TARGET_HASH, now: () => new Date("2026-01-02T00:00:00Z") });
		expect(replay.kind).toBe("replay");
	});

	test("creates the version 2 marker when an empty store is first inspected", async () => {
		expect(Object.keys((await loadStoredTransactionalDocument(storePath)).records)).toEqual([]);
		expect(JSON.parse(await readFile(storePath, "utf8")).version).toBe(2);
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

		test("resolves a relative override against the home directory (cwd-independent)", () => {
			const previous = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
			process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = "relative/store.json";
			try {
				const resolved = getTransactionalStorePath();
				// Must be absolute and anchored to home so the CLI (any cwd)
				// and MCP server (service cwd) share the same file.
				expect(resolved.startsWith("/")).toBe(true);
				expect(resolved).toBe(join(homedir(), "relative/store.json"));
			} finally {
				if (previous === undefined) {
					delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
				} else {
					process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = previous;
				}
			}
		});

		test("expands ~/ and ignores surrounding whitespace like a shell-expanded value", () => {
			// MCP client JSON configs are not shell-expanded, so the same
			// `~/tx.json` must reach the same file the CLI's shell resolved.
			const previous = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
			try {
				process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = "~/tx.json";
				expect(getTransactionalStorePath()).toBe(join(homedir(), "tx.json"));
				process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = "  state/tx.json\n";
				expect(getTransactionalStorePath()).toBe(
					join(homedir(), "state", "tx.json"),
				);
				process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = " /srv/tx.json ";
				expect(getTransactionalStorePath()).toBe("/srv/tx.json");
			} finally {
				if (previous === undefined) {
					delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE;
				} else {
					process.env.LISTMONK_OPS_TRANSACTIONAL_STORE = previous;
				}
			}
		});
	});

	describe("claimTransactionalSend", () => {
		test("claims a new pending record on first use", async () => {
			const payloadHash = hashPayload(makePayload());
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

		test("rejects nonpositive TTL before creating a claim", async () => {
			const payloadHash = hashPayload(makePayload());
			for (const badTtl of [0, -1, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
				await expect(
					claimTransactionalSend({
						storePath,
						key: "order-1",
						payloadHash,
						targetHash: DEFAULT_TARGET_HASH,
						ttlMs: badTtl,
						now: fixedClock,
					}),
				).rejects.toThrow(/TTL must be a positive finite number/);
			}
		});

		test("replays an accepted record with the same payload and target", async () => {
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
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
			const hashA = hashPayload(makePayload({ data: { order_id: "OPS-1" } }));
			const hashB = hashPayload(makePayload({ data: { order_id: "OPS-2" } }));

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
			const payloadHash = hashPayload(makePayload());
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

		test("treats an expired accepted record as a fresh claim", async () => {
			const payloadHash = hashPayload(makePayload());
			const claim = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				ttlMs: 1,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
			});
			if (claim.kind !== "new") throw new Error("expected new claim");
			await commitTransactionalSend({ storePath, key: "order-1", claimToken: claim.record.claimToken, status: "accepted", sent: true, now: () => new Date("2026-01-01T00:00:00.000Z") });

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

		test("retains expired pending and unknown records so a retry cannot silently resend", async () => {
			const payloadHash = hashPayload(makePayload());
			for (const status of ["pending", "unknown"] as const) {
				const key = `order-${status}`;
				const claim = await claimTransactionalSend({ storePath, key, payloadHash, targetHash: DEFAULT_TARGET_HASH, ttlMs: 1, now: () => new Date("2026-01-01T00:00:00.000Z") });
				if (claim.kind !== "new") throw new Error("expected new claim");
				if (status === "unknown") await commitTransactionalSend({ storePath, key, claimToken: claim.record.claimToken, status, now: () => new Date("2026-01-01T00:00:00.000Z") });
				const replay = await claimTransactionalSend({ storePath, key, payloadHash, targetHash: DEFAULT_TARGET_HASH, now: () => new Date("2026-01-02T00:00:00.000Z") });
				expect(replay.kind).toBe("replay");
				if (replay.kind === "replay") expect(replay.record.status).toBe(status);
			}
		});

		test("replays pending/unknown records to block silent re-dispatch", async () => {
			const payloadHash = hashPayload(makePayload());
			for (const status of ["pending", "unknown", "failed"] as const) {
				const dir = await mkdtemp(
					join(tmpdir(), "listmonk-ops-tx-cycle-"),
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
			for (const inheritedKey of ["constructor", "toString", "__proto__"]) {
				const dir = await mkdtemp(
					join(tmpdir(), "listmonk-ops-tx-proto-"),
				);
				const path = join(dir, "transactional.json");
				try {
					const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
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

		test("coerces failed commits to sent:false even when caller passes sent:true", async () => {
			const payloadHash = hashPayload(makePayload());
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
				sent: true, // caller mistake — must be coerced to false
				now: fixedClock,
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]).toMatchObject({
				status: "failed",
				sent: false,
			});
		});

		test("records the error message on failed/unknown outcomes", async () => {
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
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
			await commitTransactionalSend({ storePath, key: "order-1", claimToken: staleToken, status: "accepted", sent: true, now: () => new Date("2026-01-01T00:00:00.000Z") });

			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: () => new Date("2026-01-02T00:00:00.000Z"),
			});

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

	describe("releaseTransactionalSend", () => {
		test("deletes a claim so a retry can dispatch again", async () => {
			const payloadHash = hashPayload(makePayload());
			const claim = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			if (claim.kind !== "new") throw new Error("expected new");

			await releaseTransactionalSend({
				storePath,
				key: "order-1",
				claimToken: claim.record.claimToken,
				now: fixedClock,
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]).toBeUndefined();

			// A new claim with the same key must succeed now.
			const reclaim = await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			expect(reclaim.kind).toBe("new");
		});

		test("is a no-op when the claim token does not match", async () => {
			const payloadHash = hashPayload(makePayload());
			await claimTransactionalSend({
				storePath,
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});

			await releaseTransactionalSend({
				storePath,
				key: "order-1",
				claimToken: "wrong-token",
				now: fixedClock,
			});

			const stored = await loadStoredTransactionalDocument(storePath);
			expect(stored.records["order-1"]?.status).toBe("pending");
		});

		test("is a no-op when the record has vanished", async () => {
			await releaseTransactionalSend({
				storePath,
				key: "never-claimed",
				claimToken: "deadbeefdeadbeef",
				now: fixedClock,
			});
			const stored = await loadStoredTransactionalDocument(storePath);
			expect(Object.keys(stored.records)).toEqual([]);
		});
	});

	describe("validateStoredTransactionalStore", () => {
		test("accepts a well-formed v1 document", async () => {
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
			const badRecord = {
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				status: "accepted",
				sent: false,
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

		test("rejects a failed record with sent:true", async () => {
			const payloadHash = hashPayload(makePayload());
			const badRecord = {
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				status: "failed",
				sent: true, // invariant violation: failed must not report sent:true
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
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
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
			const payloadHash = hashPayload(makePayload());
			const expired = await claimTransactionalSend({
				storePath,
				key: "expired",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				ttlMs: 1,
				now: () => new Date("2026-01-01T00:00:00.000Z"),
			});
			if (expired.kind !== "new") throw new Error("expected new claim");
			await commitTransactionalSend({ storePath, key: "expired", claimToken: expired.record.claimToken, status: "accepted", sent: true, now: () => new Date("2026-01-01T00:00:00.000Z") });
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

		test("rejects new claims at capacity instead of evicting a live record", async () => {
			// Seed the store to capacity with far-future-TTL records via a
			// single write so the test stays fast.
			const records: Record<string, unknown> = Object.create(null);
			const farFuture = new Date(
				FIXED_NOW.getTime() + 10 * DEFAULT_TRANSACTIONAL_TTL_MS,
			).toISOString();
			for (let i = 0; i < TRANSACTIONAL_STORE_MAX_RECORDS; i++) {
				const key = `order-${i}`;
				records[key] = {
					key,
					payloadHash: hashPayload({ i }),
					targetHash: DEFAULT_TARGET_HASH,
					status: "accepted",
					sent: true,
					claimToken: "abcdef0123456789",
					createdAt: FIXED_NOW.toISOString(),
					updatedAt: FIXED_NOW.toISOString(),
					expiresAt: farFuture,
				};
			}
			await writeFile(
				storePath,
				JSON.stringify({ version: 1, records }, null, 2),
			);

			// Sanity: the seeded document is valid and full.
			const loaded = await loadStoredTransactionalDocument(storePath);
			expect(Object.keys(loaded.records)).toHaveLength(
				TRANSACTIONAL_STORE_MAX_RECORDS,
			);

			// A new claim must reject rather than silently evicting a live
			// record (which would break the idempotency guarantee for the
			// evicted key).
			await expect(
				claimTransactionalSend({
					storePath,
					key: "order-overflow",
					payloadHash: hashPayload(makePayload()),
					targetHash: DEFAULT_TARGET_HASH,
					now: fixedClock,
				}),
			).rejects.toBeInstanceOf(TransactionalStoreCapacityError);

			// Capacity guard did not drop any existing record.
			const after = await loadStoredTransactionalDocument(storePath);
			expect(Object.keys(after.records)).toHaveLength(
				TRANSACTIONAL_STORE_MAX_RECORDS,
			);
		});

		test("honors the record-cap override and reports occupancy with real remedies", async () => {
			const previous = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS;
			try {
				process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = "3";
				await claimAndCommitAccepted(storePath, "accepted-order", "payload-1");
				const failed = await claimTransactionalSend({
					storePath,
					key: "failed-order",
					payloadHash: "payload-2",
					targetHash: DEFAULT_TARGET_HASH,
					now: fixedClock,
				});
				if (failed.kind !== "new") throw new Error("expected new claim");
				await commitTransactionalSend({
					storePath,
					key: "failed-order",
					claimToken: failed.record.claimToken,
					status: "failed",
					sent: false,
					now: fixedClock,
				});
				await claimTransactionalSend({
					storePath,
					key: "pending-order",
					payloadHash: "payload-3",
					targetHash: DEFAULT_TARGET_HASH,
					now: fixedClock,
				});

				let capacityError: unknown;
				try {
					await claimTransactionalSend({
						storePath,
						key: "overflow-order",
						payloadHash: "payload-4",
						targetHash: DEFAULT_TARGET_HASH,
						now: fixedClock,
					});
				} catch (error) {
					capacityError = error;
				}
				if (!(capacityError instanceof TransactionalStoreCapacityError)) {
					throw new Error("expected a TransactionalStoreCapacityError");
				}
				expect(capacityError.limit).toBe(3);
				expect(capacityError.occupancy).toEqual({
					pending: 1,
					accepted: 1,
					failed: 1,
					unknown: 0,
				});
				expect(capacityError.message).toContain(
					"3 retained records (limit 3: 1 accepted, 1 failed, 1 pending, 0 unknown)",
				);
				expect(capacityError.message).toContain("listmonk-cli tx reconcile");
				expect(capacityError.message).toContain(
					"raise LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS",
				);

				// Replays never need a new slot.
				const replay = await claimTransactionalSend({
					storePath,
					key: "accepted-order",
					payloadHash: "payload-1",
					targetHash: DEFAULT_TARGET_HASH,
					now: fixedClock,
				});
				expect(replay.kind).toBe("replay");

				// Raising the cap admits the next keyed send.
				process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = " 4 ";
				const admitted = await claimTransactionalSend({
					storePath,
					key: "overflow-order",
					payloadHash: "payload-4",
					targetHash: DEFAULT_TARGET_HASH,
					now: fixedClock,
				});
				expect(admitted.kind).toBe("new");
			} finally {
				if (previous === undefined) {
					delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS;
				} else {
					process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = previous;
				}
			}
		});
	});

	describe("getTransactionalStoreMaxRecords", () => {
		test("validates the record-cap override strictly", () => {
			const previous = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS;
			try {
				delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS;
				expect(getTransactionalStoreMaxRecords()).toBe(
					TRANSACTIONAL_STORE_MAX_RECORDS,
				);
				process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = "50000";
				expect(getTransactionalStoreMaxRecords()).toBe(50_000);
				// Blank falls back to the default like an unset variable.
				process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = "  ";
				expect(getTransactionalStoreMaxRecords()).toBe(
					TRANSACTIONAL_STORE_MAX_RECORDS,
				);
				for (const invalid of [
					"10k",
					"1e4",
					"-5",
					"0",
					"1.5",
					"99999999999999999999",
				]) {
					process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = invalid;
					expect(() => getTransactionalStoreMaxRecords()).toThrow(
						`LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS must be a positive integer (received '${invalid}')`,
					);
				}
			} finally {
				if (previous === undefined) {
					delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS;
				} else {
					process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = previous;
				}
			}
		});
	});

	describe("createTransactionalStoreCapacityError", () => {
		test("reports counts, the limit, and the remedies an operator can apply", () => {
			const error = createTransactionalStoreCapacityError(10_000, {
				accepted: 9_990,
				failed: 5,
				pending: 3,
				unknown: 2,
			});
			expect(error).toBeInstanceOf(TransactionalStoreCapacityError);
			expect(error.name).toBe("TransactionalStoreCapacityError");
			expect(error.message).toBe(
				[
					"Transactional idempotency store is at capacity: 10000 retained records (limit 10000: 9990 accepted, 5 failed, 3 pending, 2 unknown), so new keyed sends are rejected instead of evicting a record.",
					"Failed records, and accepted records of direct sends, free their slots when their idempotency TTL expires (24 hours by default); accepted sequence-step receipts are released once their enrollment advances. Pending and unknown records remain until an operator reconciles them with `listmonk-cli tx records` and `listmonk-cli tx reconcile` (MCP: listmonk_transactional_records and listmonk_reconcile_transactional).",
					"To retain more records, raise LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS.",
				].join(" "),
			);
			// Missing statuses count as zero.
			expect(createTransactionalStoreCapacityError(1, { pending: 1 }).occupancy).toEqual({
				pending: 1,
				accepted: 0,
				failed: 0,
				unknown: 0,
			});
		});
	});

	describe("createFileBackedTransactionalIdempotencyStore", () => {
		test("exposes claim/commit/load behind the injected-store interface", async () => {
			const store = createFileBackedTransactionalIdempotencyStore({
				storePath,
			});
			const payloadHash = hashPayload(makePayload());
			const claim = await store.claim({
				key: "order-1",
				payloadHash,
				targetHash: DEFAULT_TARGET_HASH,
				now: fixedClock,
			});
			expect(claim.kind).toBe("new");
			if (claim.kind !== "new") return;
			await store.commit({
				key: "order-1",
				claimToken: claim.record.claimToken,
				status: "accepted",
				sent: true,
				now: fixedClock,
			});
			const loaded = await store.load();
			expect(loaded.records["order-1"]?.status).toBe("accepted");
		});
	});

	describe("pure helpers", () => {
		test("isStoredTransactionalSendRecord accepts a valid record", () => {
			const record = {
				key: "k",
				payloadHash: "p",
				targetHash: "t",
				status: "accepted",
				sent: true,
				claimToken: "tok",
				createdAt: FIXED_NOW.toISOString(),
				updatedAt: FIXED_NOW.toISOString(),
				expiresAt: FIXED_NOW.toISOString(),
			};
			expect(isStoredTransactionalSendRecord(record)).toBe(true);
		});

		test("isStoredTransactionalSendRecord rejects accepted-without-sent", () => {
			const record = {
				key: "k",
				payloadHash: "p",
				targetHash: "t",
				status: "accepted",
				claimToken: "tok",
				createdAt: FIXED_NOW.toISOString(),
				updatedAt: FIXED_NOW.toISOString(),
				expiresAt: FIXED_NOW.toISOString(),
			};
			expect(isStoredTransactionalSendRecord(record)).toBe(false);
		});

		test("parseStoredTransactionalDocument migrates a valid version 1 document", () => {
			const doc = {
				version: 1,
				records: {
					k: {
						key: "k",
						payloadHash: "p",
						targetHash: "t",
						status: "accepted",
						sent: true,
						claimToken: "tok",
						createdAt: FIXED_NOW.toISOString(),
						updatedAt: FIXED_NOW.toISOString(),
						expiresAt: FIXED_NOW.toISOString(),
					},
				},
			};
			const parsed = parseStoredTransactionalDocument(doc);
			expect(parsed.version).toBe(2);
			expect(parsed.records["k"]?.status).toBe("accepted");
		});
	});
});
