import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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
