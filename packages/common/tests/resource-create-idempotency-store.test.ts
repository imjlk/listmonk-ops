import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
	claimResourceCreate,
	commitResourceCreate,
	createFileBackedResourceCreateIdempotencyStore,
	createResourceCreateStore,
	getResourceCreateStoreMaxRecords,
	markResourceCreateUnknown,
	releaseResourceCreate,
	RESOURCE_CREATE_CLAIM_STALE_MS,
	RESOURCE_CREATE_STORE_MAX_RECORDS,
	type StoredResourceCreateRecord,
} from "../src/resource-create-idempotency-store";
import { writeJsonFileStore as writeRawJsonFileStore } from "../src/json-file-store";

const directories: string[] = [];

async function createStorePath() {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-resource-create-"),
	);
	directories.push(directory);
	return join(directory, "resource-creates.json");
}

/** Wall-clock estimate of this test process's start, mirroring the store. */
const testProcessStartedAt = new Date(
	Math.round(Date.now() - performance.now()),
).toISOString();

function pendingRecord(overrides: Partial<StoredResourceCreateRecord> = {}) {
	return {
		key: "key-1",
		payloadHash: "payload-1",
		targetHash: "target-a",
		resourceKind: "list",
		status: "pending" as const,
		claimToken: "token-old",
		owner: {
			pid: process.pid,
			hostname: hostname(),
			startedAt: testProcessStartedAt,
		},
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		...overrides,
	};
}

describe("resource create idempotency file-backed store", () => {
	test("claims, commits, and replays a bound key", async () => {
		const storePath = await createStorePath();
		const store = createFileBackedResourceCreateIdempotencyStore({ storePath });

		const claim = await store.claim({
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		expect(claim.kind).toBe("new");
		if (claim.kind !== "new") throw new Error("unreachable");

		await store.commit({
			key: "key-1",
			claimToken: claim.claimToken,
			resourceId: "31",
		});

		const replay = await store.claim({
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		expect(replay).toMatchObject({
			kind: "replay",
			record: { resourceKind: "list", resourceId: "31" },
		});

		// The persisted document is schema-versioned and atomic.
		const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
			version: number;
			records: Record<string, { status: string; resourceId?: string }>;
		};
		expect(persisted.version).toBe(1);
		expect(persisted.records["key-1"]).toMatchObject({
			status: "created",
			resourceId: "31",
		});
	});

	test("rejects payload, target, and resource-kind drift as conflicts", async () => {
		const storePath = await createStorePath();
		const store = createFileBackedResourceCreateIdempotencyStore({ storePath });
		const claim = await claimResourceCreate({
			storePath,
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		if (claim.kind !== "new") throw new Error("expected a new claim");
		await store.commit({
			key: "key-1",
			claimToken: claim.claimToken,
			resourceId: "31",
		});

		await expect(
			store.claim({
				key: "key-1",
				payloadHash: "payload-2",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "conflict", reason: "payload" });

		await expect(
			store.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-b",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "conflict", reason: "target" });

		await expect(
			store.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "campaign",
			}),
		).resolves.toMatchObject({ kind: "conflict", reason: "resourceKind" });
	});

	test("serializes concurrent same-key claims to exactly one new claim", async () => {
		const storePath = await createStorePath();
		const first = createFileBackedResourceCreateIdempotencyStore({ storePath });
		const second = createFileBackedResourceCreateIdempotencyStore({ storePath });

		const claims = await Promise.all([
			first.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
			second.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		]);

		const kinds = claims.map((claim) => claim.kind).sort();
		expect(kinds).toEqual(["new", "pending"]);
		const owned = claims.find((claim) => claim.kind === "new");
		if (owned?.kind !== "new") throw new Error("expected one owned claim");

		// The losing caller observes the pending claim; after the owner
		// commits, its next claim replays instead of creating again.
		await commitResourceCreate({
			storePath,
			key: "key-1",
			claimToken: owned.claimToken,
			resourceId: "31",
		});
		await expect(
			second.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "replay" });
	});

	test("reports a dead-owner claim as unresolved without taking it over", async () => {
		const storePath = await createStorePath();
		const exited = Bun.spawn(["true"]);
		await exited.exited;
		expect(exited.exitCode).toBe(0);

		await writeRawJsonFileStore(createResourceCreateStore(storePath), {
			version: 1,
			records: {
				"key-1": pendingRecord({
					owner: {
						pid: exited.pid,
						hostname: hostname(),
						startedAt: testProcessStartedAt,
					},
				}),
			},
		});

		await expect(
			claimResourceCreate({
				storePath,
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "unresolved" });

		// The record is left untouched for manual reconciliation.
		const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
			records: Record<string, { status: string; claimToken: string }>;
		};
		expect(persisted.records["key-1"]?.status).toBe("pending");
		expect(persisted.records["key-1"]?.claimToken).toBe("token-old");
	});

	test("reports a reused-PID owner as unresolved after a crash and restart", async () => {
		const storePath = await createStorePath();
		// A restarted service inherits a recycled PID (for example PID 1 in a
		// container): the pid is alive again, but it is not the claim's
		// process. The recorded start time does not match this process.
		await writeRawJsonFileStore(createResourceCreateStore(storePath), {
			version: 1,
			records: {
				"key-1": pendingRecord({
					owner: {
						pid: process.pid,
						hostname: hostname(),
						startedAt: "2020-01-01T00:00:00Z",
					},
				}),
			},
		});

		await expect(
			claimResourceCreate({
				storePath,
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "unresolved" });
	});

	test("reports an aged foreign-host claim as unresolved without taking it over", async () => {
		const storePath = await createStorePath();
		const startedAt = new Date(Date.now() - RESOURCE_CREATE_CLAIM_STALE_MS - 1000);
		await writeRawJsonFileStore(createResourceCreateStore(storePath), {
			version: 1,
			records: {
				"key-1": pendingRecord({
					createdAt: startedAt.toISOString(),
					owner: {
						pid: process.pid,
						hostname: "other-host.example",
						startedAt: testProcessStartedAt,
					},
				}),
			},
		});

		const claim = await claimResourceCreate({
			storePath,
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		expect(claim).toMatchObject({ kind: "unresolved" });

		// The record and its first-claim evidence are preserved for manual
		// reconciliation; the claim is never silently replaced.
		const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
			records: Record<string, { claimToken: string; createdAt: string }>;
		};
		expect(persisted.records["key-1"]?.claimToken).toBe("token-old");
		expect(persisted.records["key-1"]?.createdAt).toBe(startedAt.toISOString());
	});

	test("marks an ambiguous claim unknown and fails fast on a live host", async () => {
		const storePath = await createStorePath();
		const store = createFileBackedResourceCreateIdempotencyStore({ storePath });

		const claim = await claimResourceCreate({
			storePath,
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		if (claim.kind !== "new") throw new Error("expected a new claim");

		// The owner is this live process, so the pending claim is not stale.
		await expect(
			store.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "pending" });

		// The attempt ends without a definitive outcome: markUnknown makes a
		// later same-key claim fail fast as unresolved instead of waiting on
		// a live owner that will never finish.
		await markResourceCreateUnknown({
			storePath,
			key: "key-1",
			claimToken: claim.claimToken,
		});
		// A foreign token cannot mark the claim.
		await markResourceCreateUnknown({
			storePath,
			key: "key-1",
			claimToken: "wrong-token",
		});

		await expect(
			store.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "unresolved" });
	});

	test("validates the record-cap override strictly", async () => {
		const previous = process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS;
		try {
			delete process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS;
			expect(getResourceCreateStoreMaxRecords()).toBe(
				RESOURCE_CREATE_STORE_MAX_RECORDS,
			);

			process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS = "500";
			expect(getResourceCreateStoreMaxRecords()).toBe(500);

			// Blank falls back to the default like an unset variable.
			process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS = "  ";
			expect(getResourceCreateStoreMaxRecords()).toBe(
				RESOURCE_CREATE_STORE_MAX_RECORDS,
			);

			for (const garbage of ["10k", "10000oops", "1e4", "-5", "0"]) {
				process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS = garbage;
				expect(() => getResourceCreateStoreMaxRecords()).toThrow(
					/positive integer/,
				);
			}
		} finally {
			if (previous === undefined) {
				delete process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS;
			} else {
				process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE_MAX_RECORDS = previous;
			}
		}
	});

	test("never steals a live same-host claim by age alone", async () => {
		const storePath = await createStorePath();
		// A legitimately slow in-flight create: the owner is this live
		// process, so no age threshold may hand the claim to a retry.
		const startedAt = new Date(Date.now() - RESOURCE_CREATE_CLAIM_STALE_MS - 1000);
		await writeRawJsonFileStore(createResourceCreateStore(storePath), {
			version: 1,
			records: {
				"key-1": pendingRecord({ createdAt: startedAt.toISOString() }),
			},
		});

		await expect(
			claimResourceCreate({
				storePath,
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "pending" });
	});

	test("fresh claims record their own first-claim evidence time", async () => {
		const storePath = await createStorePath();
		const claim = await claimResourceCreate({
			storePath,
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		if (claim.kind !== "new") throw new Error("expected a new claim");
		expect(claim.record.firstClaimedAt).toBe(claim.record.createdAt);
	});

	test("release drops a pending claim but never a bound record", async () => {
		const storePath = await createStorePath();
		const store = createFileBackedResourceCreateIdempotencyStore({ storePath });

		const claim = await claimResourceCreate({
			storePath,
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		if (claim.kind !== "new") throw new Error("expected a new claim");

		// A foreign token cannot release or commit the claim.
		await releaseResourceCreate({
			storePath,
			key: "key-1",
			claimToken: "wrong-token",
		});
		await expect(
			store.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "pending" });

		await releaseResourceCreate({
			storePath,
			key: "key-1",
			claimToken: claim.claimToken,
		});
		// The released key is claimable fresh again.
		const second = await claimResourceCreate({
			storePath,
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		if (second.kind !== "new") throw new Error("expected a new claim");
		await store.commit({
			key: "key-1",
			claimToken: second.claimToken,
			resourceId: "31",
		});
		await releaseResourceCreate({
			storePath,
			key: "key-1",
			claimToken: second.claimToken,
		});
		await expect(
			store.claim({
				key: "key-1",
				payloadHash: "payload-1",
				targetHash: "target-a",
				resourceKind: "list",
			}),
		).resolves.toMatchObject({ kind: "replay" });
	});

	test("writes are durable and visible across store instances", async () => {
		const storePath = await createStorePath();
		const first = createFileBackedResourceCreateIdempotencyStore({ storePath });
		const claim = await claimResourceCreate({
			storePath,
			key: "key-2",
			payloadHash: "payload-2",
			targetHash: "target-a",
			resourceKind: "campaign",
		});
		if (claim.kind !== "new") throw new Error("expected a new claim");
		await first.commit({
			key: "key-2",
			claimToken: claim.claimToken,
			resourceId: "77",
		});
		const second = createFileBackedResourceCreateIdempotencyStore({ storePath });
		const replayed = await second.claim({
			key: "key-2",
			payloadHash: "payload-2",
			targetHash: "target-a",
			resourceKind: "campaign",
		});
		expect(replayed).toMatchObject({ kind: "replay", record: { resourceId: "77" } });
	});
});

import { afterEach } from "bun:test";
afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});
