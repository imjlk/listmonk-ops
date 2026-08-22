import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import {
	claimResourceCreate,
	commitResourceCreate,
	createFileBackedResourceCreateIdempotencyStore,
	createResourceCreateStore,
	releaseResourceCreate,
	RESOURCE_CREATE_CLAIM_STALE_MS,
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

function pendingRecord(overrides: Partial<StoredResourceCreateRecord> = {}) {
	return {
		key: "key-1",
		payloadHash: "payload-1",
		targetHash: "target-a",
		resourceKind: "list",
		status: "pending" as const,
		claimToken: "token-old",
		owner: { pid: process.pid, hostname: hostname() },
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
		expect(claim.recovered).toBe(false);

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

	test("takes over a stale claim whose owner process died", async () => {
		const storePath = await createStorePath();
		const exited = Bun.spawn(["true"]);
		await exited.exited;
		expect(exited.exitCode).toBe(0);

		await writeRawJsonFileStore(createResourceCreateStore(storePath), {
			version: 1,
			records: {
				"key-1": pendingRecord({ owner: { pid: exited.pid, hostname: hostname() } }),
			},
		});

		const claim = await claimResourceCreate({
			storePath,
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
		});
		expect(claim).toMatchObject({ kind: "new", recovered: true });

		// The replaced claim's token can no longer commit or release.
		await commitResourceCreate({
			storePath,
			key: "key-1",
			claimToken: "token-old",
			resourceId: "31",
		});
		const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
			records: Record<string, { status: string }>;
		};
		expect(persisted.records["key-1"]?.status).toBe("pending");
	});

	test("takes over an aged-out claim from a live owner", async () => {
		const storePath = await createStorePath();
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
		).resolves.toMatchObject({ kind: "new", recovered: true });
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
		expect(second.recovered).toBe(false);
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
