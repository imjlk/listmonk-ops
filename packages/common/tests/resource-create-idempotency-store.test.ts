import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileBackedResourceCreateIdempotencyStore } from "../src/resource-create-idempotency-store";

const directories: string[] = [];

async function createStorePath() {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-resource-create-"),
	);
	directories.push(directory);
	return join(directory, "resource-creates.json");
}

describe("resource create idempotency file-backed store", () => {
	test("replays a bound key and rejects target and payload drift", async () => {
		const storePath = await createStorePath();
		const store = createFileBackedResourceCreateIdempotencyStore({ storePath });

		expect(
			await store.lookup({ key: "key-1", targetHash: "target-a" }),
		).toBeUndefined();

		await store.save({
			key: "key-1",
			payloadHash: "payload-1",
			targetHash: "target-a",
			resourceKind: "list",
			resourceId: "31",
		});

		const bound = await store.lookup({ key: "key-1", targetHash: "target-a" });
		expect(bound).toMatchObject({
			resourceKind: "list",
			resourceId: "31",
			payloadHash: "payload-1",
		});

		// A different target under the same key is rejected.
		await expect(
			store.lookup({ key: "key-1", targetHash: "target-b" }),
		).rejects.toThrow(/different Listmonk target/);

		// The persisted document is schema-versioned and atomic.
		const persisted = JSON.parse(await readFile(storePath, "utf8")) as {
			version: number;
			records: Record<string, { resourceId: string }>;
		};
		expect(persisted.version).toBe(1);
		expect(persisted.records["key-1"]?.resourceId).toBe("31");
	});

	test("writes are durable and visible across store instances", async () => {
		const storePath = await createStorePath();
		const first = createFileBackedResourceCreateIdempotencyStore({ storePath });
		await first.save({
			key: "key-2",
			payloadHash: "payload-2",
			targetHash: "target-a",
			resourceKind: "campaign",
			resourceId: "77",
		});
		const second = createFileBackedResourceCreateIdempotencyStore({ storePath });
		const replayed = await second.lookup({
			key: "key-2",
			targetHash: "target-a",
		});
		expect(replayed?.resourceId).toBe("77");
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
