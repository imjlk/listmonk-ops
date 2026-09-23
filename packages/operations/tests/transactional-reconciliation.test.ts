import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	claimTransactionalSend,
	commitTransactionalSend,
	computeTransactionalTargetHash,
	createFileBackedTransactionalIdempotencyStore,
	loadStoredTransactionalDocument,
} from "@listmonk-ops/common";
import {
	invokeTransactionalRecordsOperation,
	invokeTransactionalReconcileOperation,
} from "../src/transactional-reconciliation";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("shared transactional operations inspect a target-bound redacted record and reconcile without dispatch", async () => {
	const directory = await mkdtemp(join(tmpdir(), "lmops-reconcile-"));
	directories.push(directory);
	const storePath = join(directory, "transactional.json");
	const target = { baseUrl: "http://localhost:9000/api", username: "operator" };
	const targetHash = computeTransactionalTargetHash(target);
	const claim = await claimTransactionalSend({ storePath, key: "order-42", payloadHash: "payload-digest", targetHash });
	if (claim.kind !== "new") throw new Error("expected new claim");
	await commitTransactionalSend({ storePath, key: "order-42", claimToken: claim.record.claimToken, status: "unknown", errorMessage: "remote response contained private recipient" });
	const context = {
		idempotencyStore: createFileBackedTransactionalIdempotencyStore({
			storePath,
		}),
		target,
	};
	const listed = await invokeTransactionalRecordsOperation(context, {});
	expect(listed.total).toBe(1);
	expect(listed.records[0]).toMatchObject({
		key: "order-42",
		status: "unknown",
		revision: claim.record.claimToken,
		error_present: true,
	});
	expect(JSON.stringify(listed)).not.toContain("private recipient");
	expect((await invokeTransactionalRecordsOperation({ ...context, target: { baseUrl: "http://other.test/api", username: "operator" } }, {})).total).toBe(
		0,
	);
	const input = {
		key: "order-42",
		expected_revision: claim.record.claimToken,
		decision: "accepted",
		reason: "Verified delivered in Mailpit",
	};
	await expect(invokeTransactionalReconcileOperation(context, { ...input, reason: "Verified delivery\nfrom logs" })).rejects.toThrow();
	await expect(invokeTransactionalReconcileOperation(context, { ...input, expected_revision: "stale" })).rejects.toThrow();
	const result = await invokeTransactionalReconcileOperation(context, input);
	expect(result.decision).toBe("accepted");
	expect((await loadStoredTransactionalDocument(storePath)).records["order-42"]?.sent).toBe(
		true,
	);
});

test("keyset pages expose every retained ambiguous record beyond the first hundred", async () => {
	const directory = await mkdtemp(join(tmpdir(), "lmops-reconcile-pages-"));
	directories.push(directory);
	const storePath = join(directory, "transactional.json");
	const target = { baseUrl: "http://localhost:9000/api", username: "operator" };
	const targetHash = computeTransactionalTargetHash(target);
	const records = Object.fromEntries(
		Array.from({ length: 105 }, (_, index) => {
			const key = `order-${index}`;
			return [
				key,
				{
					key,
					payloadHash: "payload",
					targetHash,
					status: "unknown",
					claimToken: `revision-${index}`,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
					expiresAt: "2026-01-02T00:00:00.000Z",
				},
			];
		}),
	);
	await writeFile(storePath, JSON.stringify({ version: 2, records }));
	const context = {
		idempotencyStore: createFileBackedTransactionalIdempotencyStore({
			storePath,
		}),
		target,
	};
	const first = await invokeTransactionalRecordsOperation(context, { limit: 100 });
	expect(first.total).toBe(105);
	expect(first.records).toHaveLength(100);
	expect(first.next_cursor).toBeDefined();
	const second = await invokeTransactionalRecordsOperation(context, { limit: 100, cursor: first.next_cursor });
	expect(second.records).toHaveLength(5);
	expect(second.next_cursor).toBeUndefined();
	expect(new Set([...first.records, ...second.records].map((record) => record.key)).size).toBe(
		105,
	);
	await expect(invokeTransactionalRecordsOperation(context, { cursor: "bad-cursor" })).rejects.toThrow("Invalid transactional record cursor");
});

test("inspects and reconciles long sequence keys with valid offset timestamps", async () => {
	const directory = await mkdtemp(join(tmpdir(), "lmops-reconcile-long-key-"));
	directories.push(directory);
	const storePath = join(directory, "transactional.json");
	const target = { baseUrl: "http://localhost:9000/api", username: "operator" };
	const key = `sequence:00000000-0000-4000-8000-000000000001:revision:123:step:${"x".repeat(80)}`;
	const record = {
		key, payloadHash: "payload", targetHash: computeTransactionalTargetHash(target),
		status: "unknown", claimToken: "revision",
		createdAt: "2026-01-01T09:00:00+09:00",
		updatedAt: "2026-01-01T09:00:00+09:00",
		expiresAt: "2026-01-02T09:00:00+09:00",
	};
	await writeFile(storePath, JSON.stringify({ version: 2, records: { [key]: record } }));
	const context = { idempotencyStore: createFileBackedTransactionalIdempotencyStore({ storePath }), target };
	const listed = await invokeTransactionalRecordsOperation(context, { key });
	expect(listed.records).toMatchObject([{ key, created_at: record.createdAt }]);
	await expect(invokeTransactionalReconcileOperation(context, {
		key, expected_revision: record.claimToken, decision: "accepted",
		reason: "Provider logs confirm delivery",
	})).resolves.toMatchObject({ key, decision: "accepted" });
});

test("accepts pagination cursors produced from maximum-length record keys", async () => {
	const directory = await mkdtemp(join(tmpdir(), "lmops-reconcile-max-cursor-"));
	directories.push(directory);
	const storePath = join(directory, "transactional.json");
	const target = { baseUrl: "http://localhost:9000/api", username: "operator" };
	const targetHash = computeTransactionalTargetHash(target);
	const longKey = "x".repeat(256);
	const record = (key: string, updatedAt: string) => ({
		key, payloadHash: "payload", targetHash, status: "unknown", claimToken: "revision",
		createdAt: updatedAt, updatedAt, expiresAt: "2026-01-03T00:00:00.000Z",
	});
	await writeFile(storePath, JSON.stringify({ version: 2, records: {
		[longKey]: record(longKey, "2026-01-02T00:00:00.000Z"),
		short: record("short", "2026-01-01T00:00:00.000Z"),
	} }));
	const context = { idempotencyStore: createFileBackedTransactionalIdempotencyStore({ storePath }), target };
	const first = await invokeTransactionalRecordsOperation(context, { limit: 1 });
	expect(first.records.map((entry) => entry.key)).toEqual([longKey]);
	expect(first.next_cursor?.length).toBeGreaterThan(256);
	const second = await invokeTransactionalRecordsOperation(context, { limit: 1, cursor: first.next_cursor });
	expect(second.records.map((entry) => entry.key)).toEqual(["short"]);
});
