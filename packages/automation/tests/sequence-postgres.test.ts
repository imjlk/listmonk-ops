import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
	computeTransactionalTargetHash,
	TransactionalStoreCapacityError,
} from "@listmonk-ops/common";
import {
	invokeTransactionalRecordsOperation,
	invokeTransactionalReconcileOperation,
} from "@listmonk-ops/operations";
import {
	invokeSequenceEnrollmentGetOperation,
	invokeSequenceEnrollmentListOperation,
	invokeSequenceGetOperation,
	invokeSequenceListOperation,
	invokeSequencePauseOperation,
	invokeSequenceResumeOperation,
} from "../src/sequence-operations";
import { createPostgresSequenceRepository } from "../src/sequence-postgres";
import {
	closeSequenceRuntimeRepositories,
	getTransactionalIdempotencyStoreFromEnvironment,
} from "../src/sequence-runtime";
import {
	createFileSequenceRepository,
	createSequenceDefinition,
	createSequenceEnrollment,
	parseSequenceDefinition,
	SequenceConflictError,
	type SequenceEnrollment,
	type SequenceRepository,
} from "../src/sequences";

const databaseUrl =
	process.env.LISTMONK_OPS_TEST_SEQUENCE_DATABASE_URL?.trim() ||
	process.env.LISTMONK_OPS_TEST_WEBHOOK_DATABASE_URL?.trim();
const postgresTest = databaseUrl ? test : test.skip;
const repositories: SequenceRepository[] = [];

function withoutLease(
	enrollment: SequenceEnrollment,
	status: SequenceEnrollment["status"],
	now: Date,
) {
	const {
		leaseToken: _leaseToken,
		leaseExpiresAt: _leaseExpiresAt,
		...rest
	} = enrollment;
	return {
		...rest,
		status,
		updatedAt: now.toISOString(),
		lastTransitionAt: now.toISOString(),
	};
}

beforeAll(async () => {
	if (!databaseUrl) {
		return;
	}
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	try {
		await sql`DROP TABLE IF EXISTS listmonk_ops.sequence_idempotency_reconciliations`;
		await sql`DROP TABLE IF EXISTS listmonk_ops.sequence_idempotency_records`;
		await sql`DROP TABLE IF EXISTS listmonk_ops.sequence_enrollments`;
		await sql`DROP TABLE IF EXISTS listmonk_ops.sequence_definitions`;
		await sql`DROP TABLE IF EXISTS listmonk_ops.sequence_workers`;
		await sql`DROP TABLE IF EXISTS listmonk_ops.sequence_runtime_meta`;
	} finally {
		await sql.end({ timeout: 5 });
	}
	const repository = createPostgresSequenceRepository({
		connectionString: databaseUrl,
		maxConnections: 2,
	});
	repositories.push(repository);
	await repository.listDefinitions();
});

afterAll(async () => {
	await Promise.all(repositories.map((repository) => repository.close?.()));
});

describe("Postgres sequence repository", () => {
	postgresTest("schema initialization waits for the active claim lock", async () => {
		if (!databaseUrl) throw new Error("Postgres integration database is unavailable");
		const blocker = postgres(databaseUrl, { max: 1, prepare: false });
		const observer = postgres(databaseUrl, { max: 1, prepare: false });
		let releaseBlocker: (() => void) | undefined;
		let signalLocked: (() => void) | undefined;
		const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
		const released = new Promise<void>((resolve) => { releaseBlocker = resolve; });
		const holding = blocker.begin(async (transaction) => {
			await transaction`SELECT pg_advisory_xact_lock(hashtext('listmonk_ops'), hashtext('sequence_idempotency'))`;
			signalLocked?.();
			await released;
		});
		let candidate: SequenceRepository | undefined;
		let initializing: Promise<unknown> | undefined;
		try {
			await locked;
			candidate = createPostgresSequenceRepository({ connectionString: databaseUrl, maxConnections: 1 });
			initializing = candidate.listDefinitions();
			let waiterSeen = false;
			for (let attempt = 0; attempt < 30; attempt++) {
				const rows = await observer<{ count: number }[]>`
					SELECT count(*)::integer AS count FROM pg_locks
					WHERE locktype = 'advisory' AND NOT granted
						AND classid = hashtext('listmonk_ops')::oid
						AND objid = hashtext('sequence_idempotency')::oid
				`;
				if ((rows[0]?.count ?? 0) > 0) { waiterSeen = true; break; }
				await Bun.sleep(20);
			}
			expect(waiterSeen).toBe(true);
		} finally {
			releaseBlocker?.();
			await holding;
			await initializing;
			await candidate?.close?.();
			await observer.end({ timeout: 5 });
			await blocker.end({ timeout: 5 });
		}
	});
	postgresTest("protects verified sequence acceptance until enrollment recovery", async () => {
		if (!databaseUrl) throw new Error("Postgres integration database is unavailable");
		const sql = postgres(databaseUrl, { max: 1, prepare: false });
		const store = repositories[0]?.idempotencyStore;
		if (!store?.reconcile || !store.forgetReconciliation) throw new Error("Postgres transactional recovery unavailable");
		const key = `sequence:${randomUUID()}:revision:1:step:send`;
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const later = () => new Date("2026-01-03T00:00:00.000Z");
		try {
			const claim = await store.claim({ key, payloadHash: "payload", targetHash: "target", now });
			if (claim.kind !== "new") throw new Error("expected new claim");
			await store.reconcile({ key, targetHash: "target", expectedRevision: claim.record.claimToken, decision: "accepted", reason: "Provider logs confirm delivery", now });
			expect((await store.claim({ key, payloadHash: "payload", targetHash: "target", now: later })).kind).toBe("replay");
			expect((await store.load()).records[key]).toMatchObject({ status: "accepted" });
			let deleteError: unknown;
			try { await sql`DELETE FROM listmonk_ops.sequence_idempotency_records WHERE key = ${key}`; } catch (error) { deleteError = error; }
			expect(String(deleteError)).toContain("Ambiguous transactional claim deletion requires version 3 reconciliation");
			await store.forgetReconciliation({ key, targetHash: "target" });
			expect((await store.load()).reconciliations?.some((decision) => decision.key === key)).toBe(false);
			expect((await store.load()).records[key]).toBeUndefined();
			const replacement = await store.claim({ key, payloadHash: "payload", targetHash: "target", now: later });
			expect(replacement.kind).toBe("new");
			if (replacement.kind === "new") await store.release({ key, claimToken: replacement.record.claimToken });
		} finally {
			await sql`DELETE FROM listmonk_ops.sequence_idempotency_reconciliations WHERE key = ${key}`;
			await sql`DELETE FROM listmonk_ops.sequence_idempotency_records WHERE key = ${key}`;
			await sql.end({ timeout: 5 });
		}
	});
	postgresTest("retains ordinary accepted sequence sends across unrelated sweeps", async () => {
		const store = repositories[0]?.idempotencyStore;
		if (!store?.forgetReconciliation) throw new Error("Postgres transactional store unavailable");
		const key = `sequence:${randomUUID()}:revision:1:step:send`;
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const later = () => new Date("2026-01-03T00:00:00.000Z");
		const claim = await store.claim({ key, payloadHash: "payload", targetHash: "target", ttlMs: 1, now });
		if (claim.kind !== "new") throw new Error("expected new claim");
		await store.commit({ key, claimToken: claim.record.claimToken, status: "accepted", sent: true, now });
		const unrelatedKey = `unrelated-${randomUUID()}`;
		const unrelated = await store.claim({ key: unrelatedKey, payloadHash: "other", targetHash: "target", now: later });
		if (unrelated.kind === "new") await store.release({ key: unrelatedKey, claimToken: unrelated.record.claimToken });
		expect((await store.load()).records[key]?.status).toBe("accepted");
		expect(await store.get?.(key)).toMatchObject({ key, status: "accepted" });
		expect(await store.get?.(`missing-${randomUUID()}`)).toBeUndefined();
		await store.forgetReconciliation({ key, targetHash: "target" });
		expect((await store.load()).records[key]).toBeUndefined();
	});
	postgresTest("retains sequence recovery receipts beyond the direct-decision cap", async () => {
		if (!databaseUrl) throw new Error("Postgres integration database is unavailable");
		const sql = postgres(databaseUrl, { max: 1, prepare: false });
		const store = repositories[0]?.idempotencyStore;
		if (!store?.reconcile) throw new Error("Postgres transactional reconciliation unavailable");
		const prefix = `retention-${randomUUID()}`;
		const key = `sequence:${randomUUID()}:revision:1:step:send`;
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const later = () => new Date("2026-01-02T00:00:00.000Z");
		try {
			const claim = await store.claim({ key, payloadHash: "payload", targetHash: "target", ttlMs: 1, now });
			if (claim.kind !== "new") throw new Error("expected new claim");
			await store.reconcile({ key, targetHash: "target", expectedRevision: claim.record.claimToken, decision: "retry", reason: "Provider logs confirm no delivery", quiesced: true, now: later });
			await sql`
				INSERT INTO listmonk_ops.sequence_idempotency_reconciliations
					(key, target_hash, payload_hash, previous_status, previous_revision, decision, reason, reconciled_at)
				SELECT ${prefix} || '-' || value::text, 'target', 'payload', 'unknown', ${randomUUID()}::uuid,
					'accepted', 'Provider logs confirm delivery', ${later()}
				FROM generate_series(1, 1000) AS series(value)
			`;
			const directKey = `${prefix}-new`;
			const direct = await store.claim({ key: directKey, payloadHash: "payload", targetHash: "target", now: later });
			if (direct.kind !== "new") throw new Error("expected new claim");
			await store.reconcile({ key: directKey, targetHash: "target", expectedRevision: direct.record.claimToken, decision: "accepted", reason: "Provider logs confirm delivery", now: later });
			const history = (await store.load()).reconciliations ?? [];
			expect(history.some((decision) => decision.key === key && decision.decision === "retry")).toBe(true);
			expect(history.filter((decision) => !decision.key.startsWith("sequence:")).length).toBeLessThanOrEqual(1_000);
			await store.forgetReconciliation?.({ key, targetHash: "target" });
			expect((await store.load()).reconciliations?.some((decision) => decision.key === key)).toBe(false);
		} finally {
			await sql`DELETE FROM listmonk_ops.sequence_idempotency_reconciliations WHERE key = ${key} OR key LIKE ${prefix + "-%"}`;
			await sql`DELETE FROM listmonk_ops.sequence_idempotency_records WHERE key LIKE ${prefix + "-%"}`;
			await sql.end({ timeout: 5 });
		}
	});
	postgresTest("routes transactional inspection and recovery to the configured sequence database", async () => {
		const previous = process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL;
		const target = { baseUrl: "http://localhost:9000/api", username: "operator" };
		const key = `postgres-routed-${randomUUID()}`;
		const store = repositories[0]?.idempotencyStore;
		if (!store || !databaseUrl) throw new Error("Postgres transactional store unavailable");
		const claim = await store.claim({ key, payloadHash: "payload", targetHash: computeTransactionalTargetHash(target) });
		if (claim.kind !== "new") throw new Error("expected new claim");
		process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL = databaseUrl;
		try {
			const routed = getTransactionalIdempotencyStoreFromEnvironment();
			const records = await invokeTransactionalRecordsOperation({ idempotencyStore: routed, target }, { key });
			expect(records.records).toMatchObject([{ key, status: "pending" }]);
			await invokeTransactionalReconcileOperation({ idempotencyStore: routed, target }, {
				key,
				expected_revision: claim.record.claimToken,
				decision: "accepted",
				reason: "Provider logs confirm delivery",
			});
			expect((await store.load()).records[key]).toMatchObject({ status: "accepted", sent: true });
		} finally {
			await closeSequenceRuntimeRepositories();
			if (previous === undefined) delete process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL;
			else process.env.LISTMONK_OPS_SEQUENCE_DATABASE_URL = previous;
		}
	});
	postgresTest("retains ambiguous transactional claims past TTL and reconciles with target/revision fencing", async () => {
		const store = repositories[0]?.idempotencyStore;
		if (!store?.reconcile) throw new Error("Postgres transactional reconciliation unavailable");
		const now = () => new Date("2026-01-01T00:00:00.000Z");
		const later = () => new Date("2026-01-02T00:00:00.000Z");
		const key = `postgres-reconcile-${randomUUID()}`;
		const claim = await store.claim({ key, payloadHash: "payload", targetHash: "target", ttlMs: 1, now });
		if (claim.kind !== "new") throw new Error("expected new claim");
		expect((await store.claim({ key, payloadHash: "payload", targetHash: "target", now: later })).kind).toBe("replay");
		const args = { key, targetHash: "target", expectedRevision: claim.record.claimToken, decision: "retry" as const, reason: "Provider logs confirm no delivery", now: later };
		await expect(store.reconcile({ ...args, targetHash: "other", quiesced: true })).rejects.toThrow("not found");
		await expect(store.reconcile(args)).rejects.toThrow("may still be active");
		await expect(store.reconcile({ ...args, quiesced: true })).resolves.toMatchObject({ decision: "retry" });
		const document = await store.load();
		expect(document.records[key]).toBeUndefined();
		expect(document.reconciliations?.at(-1)).toMatchObject({ key, decision: "retry", previousRevision: claim.record.claimToken });
		await store.commit({ key, claimToken: claim.record.claimToken, status: "accepted", now: later });
		expect((await store.load()).records[key]).toBeUndefined();

		const unknownKey = `postgres-unknown-${randomUUID()}`;
		const unknownClaim = await store.claim({ key: unknownKey, payloadHash: "other-payload", targetHash: "target", ttlMs: 1, now });
		if (unknownClaim.kind !== "new") throw new Error("expected new claim");
		await store.commit({ key: unknownKey, claimToken: unknownClaim.record.claimToken, status: "unknown", now });
		expect((await store.claim({ key: unknownKey, payloadHash: "other-payload", targetHash: "target", now: later })).kind).toBe("replay");
		const accepted = await store.reconcile({ key: unknownKey, targetHash: "target", expectedRevision: unknownClaim.record.claimToken, decision: "accepted", reason: "Provider logs confirm delivery", now });
		await store.commit({ key: unknownKey, claimToken: unknownClaim.record.claimToken, status: "failed", now });
		expect((await store.load()).records[unknownKey]).toMatchObject({ status: "accepted", sent: true, claimToken: accepted.revision });
		const inheritedKey = await store.claim({ key: "__proto__", payloadHash: "prototype-payload", targetHash: "target" });
		if (inheritedKey.kind !== "new") throw new Error("expected new claim");
		expect(Object.hasOwn((await store.load()).records, "__proto__")).toBe(true);
		await store.release({ key: "__proto__", claimToken: inheritedKey.record.claimToken });
	});

	postgresTest("honors the transactional record-cap override and reports occupancy", async () => {
		if (!databaseUrl) throw new Error("Postgres integration database is unavailable");
		const store = repositories[0]?.idempotencyStore;
		if (!store) throw new Error("Postgres transactional store unavailable");
		const sql = postgres(databaseUrl, { max: 1, prepare: false });
		const previous = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS;
		const retainedKey = `postgres-cap-${randomUUID()}`;
		const overflowKey = `postgres-cap-${randomUUID()}`;
		// Pending claims can only be removed through the store, not DELETE.
		const claimed: { key: string; claimToken: string }[] = [];
		try {
			// The first claim also sweeps expired definitive records, so the
			// count below is exactly what the next claim will see.
			const first = await store.claim({ key: retainedKey, payloadHash: "payload", targetHash: "target" });
			if (first.kind !== "new") throw new Error("expected new claim");
			claimed.push({ key: retainedKey, claimToken: first.record.claimToken });
			const [row] = await sql<{ count: number }[]>`
				SELECT count(*)::integer AS count FROM listmonk_ops.sequence_idempotency_records
			`;
			const retained = row?.count ?? 0;
			process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = String(retained);

			let capacityError: unknown;
			try {
				await store.claim({ key: overflowKey, payloadHash: "payload", targetHash: "target" });
			} catch (error) {
				capacityError = error;
			}
			if (!(capacityError instanceof TransactionalStoreCapacityError)) {
				throw new Error("expected a TransactionalStoreCapacityError");
			}
			expect(capacityError.limit).toBe(retained);
			const occupancy = capacityError.occupancy;
			if (!occupancy) throw new Error("expected capacity occupancy");
			expect(occupancy.pending).toBeGreaterThanOrEqual(1);
			expect(occupancy.pending + occupancy.accepted + occupancy.failed + occupancy.unknown).toBe(retained);
			expect(capacityError.message).toContain(`${retained} retained records (limit ${retained}:`);
			expect(capacityError.message).toContain("raise LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS");
			// Replays never need a new slot.
			expect((await store.claim({ key: retainedKey, payloadHash: "payload", targetHash: "target" })).kind).toBe("replay");

			process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = String(retained + 1);
			const admitted = await store.claim({ key: overflowKey, payloadHash: "payload", targetHash: "target" });
			if (admitted.kind !== "new") throw new Error("expected new claim");
			claimed.push({ key: overflowKey, claimToken: admitted.record.claimToken });
		} finally {
			if (previous === undefined) delete process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS;
			else process.env.LISTMONK_OPS_TRANSACTIONAL_STORE_MAX_RECORDS = previous;
			for (const claim of claimed) await store.release(claim);
			await sql.end({ timeout: 5 });
		}
	});

	postgresTest("migrates a version 2 idempotency store without discarding pending records", async () => {
		if (!databaseUrl) throw new Error("Postgres integration database is unavailable");
		const sql = postgres(databaseUrl, { max: 1, prepare: false });
		const key = `postgres-v2-${randomUUID()}`;
		const store = repositories[0]?.idempotencyStore;
		if (!store) throw new Error("Postgres transactional store unavailable");
		await store.claim({ key, payloadHash: "migration-payload", targetHash: "target" });
		let migrated: SequenceRepository | undefined;
		try {
			await sql`DROP TRIGGER IF EXISTS guard_ambiguous_sequence_claim_delete ON listmonk_ops.sequence_idempotency_records`;
			await sql`DROP TABLE listmonk_ops.sequence_idempotency_reconciliations`;
			await sql`UPDATE listmonk_ops.sequence_runtime_meta SET value = '2' WHERE key = 'schema_version'`;
			migrated = createPostgresSequenceRepository({ connectionString: databaseUrl, maxConnections: 1 });
			const document = await migrated.idempotencyStore!.load();
			expect(document.records[key]?.status).toBe("pending");
			expect(document.reconciliations).toEqual([]);
			let deleteError: unknown;
			try {
				await sql`DELETE FROM listmonk_ops.sequence_idempotency_records WHERE key = ${key}`;
			} catch (error) {
				deleteError = error;
			}
			expect(String(deleteError)).toContain("Ambiguous transactional claim deletion requires version 3 reconciliation");
			await migrated.idempotencyStore!.reconcile!({ key, targetHash: "target", expectedRevision: document.records[key]!.claimToken, decision: "accepted", reason: "Verified delivery in provider logs" });
			expect((await migrated.idempotencyStore!.load()).records[key]?.status).toBe("accepted");
			const version = await sql<{ value: string }[]>`SELECT value FROM listmonk_ops.sequence_runtime_meta WHERE key = 'schema_version'`;
			expect(version[0]?.value).toBe("3");
		} finally {
			await migrated?.close?.();
			await sql`DELETE FROM listmonk_ops.sequence_idempotency_records WHERE key = ${key}`;
			await sql.end({ timeout: 5 });
		}
	});

	postgresTest(
		"matches file-backed ordering and redacted public read projections",
		async () => {
			if (!databaseUrl) {
				throw new Error("Postgres integration database is unavailable");
			}
			const directory = await mkdtemp(
				join(tmpdir(), "listmonk-ops-sequence-parity-"),
			);
			const file = createFileSequenceRepository(
				join(directory, "sequences.json"),
			);
			const database = repositories[0]!;
			const now = new Date("2026-07-29T00:00:00.000Z");
			const ids = [randomUUID(), randomUUID()].sort();
			const enrollmentIds = [randomUUID(), randomUUID()].sort();
			try {
				for (const [index, id] of ids.toReversed().entries()) {
					const canonicalIndex = ids.indexOf(id);
					const createdAt =
						canonicalIndex === 0
							? "2026-07-29T01:00:00.000+01:00"
							: "2026-07-29T00:00:00.000Z";
					const baseDefinition = createSequenceDefinition(
						{
							id,
							name: `parity-${id}`,
							description: "private description",
							steps: [
								{
									id: "branch",
									type: "condition",
									path: "profile.plan",
									operator: "equals",
									value:
										index === 0
											? { nested: { b: 2, a: 1 } }
											: { nested: { a: 1, b: 2 } },
									onTrue: "stop",
									onFalse: "stop",
								},
								{ id: "stop", type: "stop" },
							],
						},
						now,
					);
					const definition = parseSequenceDefinition({
						...baseDefinition,
						createdAt,
						updatedAt: createdAt,
						revisions: [
							{
								...baseDefinition.revisions[0]!,
								createdAt,
							},
						],
					});
					await file.createDefinition(definition);
					await database.createDefinition(definition);
					const enrollmentCreatedAt =
						index === 0
							? "2026-07-29T01:00:00.000+01:00"
							: "2026-07-29T00:00:00.000Z";
					const enrollment = {
						...createSequenceEnrollment(
							definition,
							{
								id: enrollmentIds[index]!,
								sequenceId: definition.id,
								subscriberId: 40 + index,
							},
							now,
						),
						createdAt: enrollmentCreatedAt,
						updatedAt: enrollmentCreatedAt,
						lastTransitionAt: enrollmentCreatedAt,
					};
					await file.createEnrollment(enrollment);
					await database.createEnrollment(enrollment);
				}

				const statusId = ids[0]!;
				const pausedAt = new Date("2026-07-29T02:00:00.000Z");
				const repeatedPauseAt = new Date("2026-07-29T03:00:00.000Z");
				const filePaused = await invokeSequencePauseOperation(
					{ repository: file, now: () => pausedAt },
					{ id: statusId },
				);
				const databasePaused = await invokeSequencePauseOperation(
					{ repository: database, now: () => pausedAt },
					{ id: statusId },
				);
				expect(databasePaused).toEqual(filePaused);
				expect(
					await invokeSequencePauseOperation(
						{ repository: file, now: () => repeatedPauseAt },
						{ id: statusId },
					),
				).toEqual(filePaused);
				expect(
					await invokeSequencePauseOperation(
						{ repository: database, now: () => repeatedPauseAt },
						{ id: statusId },
					),
				).toEqual(databasePaused);

				const resumedAt = new Date("2026-07-29T04:00:00.000Z");
				const repeatedResumeAt = new Date("2026-07-29T05:00:00.000Z");
				const fileResumed = await invokeSequenceResumeOperation(
					{ repository: file, now: () => resumedAt },
					{ id: statusId },
				);
				const databaseResumed = await invokeSequenceResumeOperation(
					{ repository: database, now: () => resumedAt },
					{ id: statusId },
				);
				expect(databaseResumed).toEqual(fileResumed);
				expect(
					await invokeSequenceResumeOperation(
						{ repository: file, now: () => repeatedResumeAt },
						{ id: statusId },
					),
				).toEqual(fileResumed);
				expect(
					await invokeSequenceResumeOperation(
						{ repository: database, now: () => repeatedResumeAt },
						{ id: statusId },
					),
				).toEqual(databaseResumed);

				const fileList = await invokeSequenceListOperation(
					{ repository: file },
					{},
				);
				const databaseList = await invokeSequenceListOperation(
					{ repository: database },
					{},
				);
				expect(databaseList).toEqual(fileList);
				expect(fileList.sequences.map(({ id }) => id)).toEqual(ids);
				expect(
					fileList.sequences[0]?.revisions[0]?.content_fingerprint,
				).toBe(fileList.sequences[1]?.revisions[0]?.content_fingerprint);
				expect(JSON.stringify(fileList)).not.toContain("private description");
				expect(JSON.stringify(fileList)).not.toContain("profile.plan");

				for (const id of ids) {
					expect(
						await invokeSequenceGetOperation(
							{ repository: database },
							{ id },
						),
					).toEqual(
						await invokeSequenceGetOperation({ repository: file }, { id }),
					);
				}

				const fileEnrollments =
					await invokeSequenceEnrollmentListOperation(
						{ repository: file },
						{},
					);
				const databaseEnrollments =
					await invokeSequenceEnrollmentListOperation(
						{ repository: database },
						{},
					);
				expect(databaseEnrollments).toEqual(fileEnrollments);
				expect(fileEnrollments.enrollments.map(({ id }) => id)).toEqual(
					enrollmentIds,
				);
				expect(JSON.stringify(fileEnrollments)).not.toContain(
					'"subscriber_id"',
				);
				for (const id of enrollmentIds) {
					expect(
						await invokeSequenceEnrollmentGetOperation(
							{ repository: database },
							{ id },
						),
					).toEqual(
						await invokeSequenceEnrollmentGetOperation(
							{ repository: file },
							{ id },
						),
					);
				}
			} finally {
				const cleanup = postgres(databaseUrl, { max: 1, prepare: false });
				try {
					await cleanup`
						DELETE FROM listmonk_ops.sequence_enrollments
						WHERE id IN ${cleanup(enrollmentIds)}
					`;
					await cleanup`
						DELETE FROM listmonk_ops.sequence_definitions
						WHERE id IN ${cleanup(ids)}
					`;
				} finally {
					await cleanup.end({ timeout: 5 });
				}
				await rm(directory, { recursive: true, force: true });
			}
		},
	);

	postgresTest(
		"coordinates claims, fences leases, keeps ambiguity active, and prunes workers",
		async () => {
			if (!databaseUrl) {
				throw new Error("Postgres integration database is unavailable");
			}
			const first = repositories[0]!;
			const second = createPostgresSequenceRepository({
				connectionString: databaseUrl,
				maxConnections: 2,
			});
			repositories.push(second);
			const initialAt = new Date("2026-07-29T00:00:00.000Z");
			const definition = await first.createDefinition(
				createSequenceDefinition(
					{
						id: randomUUID(),
						name: `postgres-sequence-${randomUUID()}`,
						steps: [{ id: "stop", type: "stop" }],
					},
					initialAt,
				),
			);
			await first.createEnrollment(
				createSequenceEnrollment(
					definition,
					{
						id: randomUUID(),
						sequenceId: definition.id,
						subscriberId: 41,
					},
					initialAt,
				),
			);
			await first.createEnrollment(
				createSequenceEnrollment(
					definition,
					{
						id: randomUUID(),
						sequenceId: definition.id,
						subscriberId: 42,
					},
					initialAt,
				),
			);
			expect(
				await first.getRuntimeHealth({
					now: initialAt,
					workerStaleMs: 1_000,
				}),
			).toMatchObject({ healthy: false, enrollments: { due: 2 } });

			const firstIdempotency = first.idempotencyStore;
			const secondIdempotency = second.idempotencyStore;
			expect(firstIdempotency).toBeDefined();
			expect(secondIdempotency).toBeDefined();
			const idempotencyKey = `sequence-test-${randomUUID()}`;
			const claims = await Promise.all([
				firstIdempotency!.claim({
					key: idempotencyKey,
					payloadHash: "payload",
					targetHash: "target",
				}),
				secondIdempotency!.claim({
					key: idempotencyKey,
					payloadHash: "payload",
					targetHash: "target",
				}),
			]);
			expect(claims.map((claim) => claim.kind).sort()).toEqual([
				"new",
				"replay",
			]);
			const claimedRecord =
				claims.find((claim) => claim.kind === "new")?.record ??
				claims[0]!.record;
			await firstIdempotency!.commit({
				key: idempotencyKey,
				claimToken: claimedRecord.claimToken,
				status: "accepted",
				sent: true,
			});
			expect(
				(await secondIdempotency!.load()).records[idempotencyKey],
			).toMatchObject({ status: "accepted", sent: true });

			const [firstClaims, secondClaims] = await Promise.all([
				first.claimDue({ limit: 1, now: initialAt, leaseMs: 1_000 }),
				second.claimDue({ limit: 1, now: initialAt, leaseMs: 1_000 }),
			]);
			expect(firstClaims).toHaveLength(1);
			expect(secondClaims).toHaveLength(1);
			expect(firstClaims[0]!.enrollment.id).not.toBe(
				secondClaims[0]!.enrollment.id,
			);

			const ambiguousClaim = firstClaims[0]!;
			const ambiguous = await first.completeClaim(
				ambiguousClaim.enrollment,
				withoutLease(
					ambiguousClaim.enrollment,
					"ambiguous",
					new Date("2026-07-29T00:00:00.100Z"),
				),
			);
			await expect(
				first.createEnrollment(
					createSequenceEnrollment(
						definition,
						{
							id: randomUUID(),
							sequenceId: definition.id,
							subscriberId: ambiguous.subscriberId,
						},
						initialAt,
					),
				),
			).rejects.toBeInstanceOf(SequenceConflictError);
			const { definition: nextRevision } = await first.updateDefinition(
				definition.id,
				{ steps: [{ id: "stop-v2", type: "stop" }] },
				new Date("2026-07-29T00:00:00.150Z"),
			);
			await expect(
				first.createEnrollment(
					createSequenceEnrollment(
						nextRevision,
						{
							id: randomUUID(),
							sequenceId: definition.id,
							subscriberId: ambiguous.subscriberId,
						},
						new Date("2026-07-29T00:00:00.160Z"),
					),
				),
			).rejects.toBeInstanceOf(SequenceConflictError);
			await expect(first.deleteDefinition(definition.id)).rejects.toThrow(
				"non-terminal enrollments",
			);
			await first.resolveAmbiguous(
				ambiguous,
				withoutLease(
					ambiguous,
					"completed",
					new Date("2026-07-29T00:00:00.200Z"),
				),
			);

			const staleClaim = secondClaims[0]!;
			expect(
				await first.reconcile({
					now: new Date("2026-07-29T00:00:02.000Z"),
					limit: 10,
					dryRun: false,
				}),
			).toMatchObject({ scanned: 1, recovered: 1, dryRun: false });
			await expect(
				second.completeClaim(
					staleClaim.enrollment,
					withoutLease(
						staleClaim.enrollment,
						"completed",
						new Date("2026-07-29T00:00:02.100Z"),
					),
				),
			).rejects.toThrow("lease was lost");
			const reclaimed = await first.claimDue({
				limit: 1,
				now: new Date("2026-07-29T00:00:02.100Z"),
				leaseMs: 1_000,
			});
			expect(reclaimed).toHaveLength(1);
			await first.completeClaim(
				reclaimed[0]!.enrollment,
				withoutLease(
					reclaimed[0]!.enrollment,
					"completed",
					new Date("2026-07-29T00:00:02.200Z"),
				),
			);
			expect(
				await first.listEnrollments({
					sequenceId: definition.id,
					status: "completed",
				}),
			).toHaveLength(2);

			await first.upsertWorker({
				id: randomUUID(),
				status: "running",
				startedAt: "2026-06-01T00:00:00.000Z",
				heartbeatAt: "2026-06-01T00:00:00.000Z",
			});
			await first.upsertWorker({
				id: randomUUID(),
				status: "stopped",
				startedAt: "2026-06-01T00:00:00.000Z",
				heartbeatAt: "2026-06-01T00:00:00.000Z",
				stoppedAt: "2026-06-01T00:00:00.000Z",
			});
			await first.upsertWorker({
				id: randomUUID(),
				status: "running",
				startedAt: "2026-07-29T00:00:02.000Z",
				heartbeatAt: "2026-07-29T00:00:02.000Z",
			});
			expect(
				await first.getRuntimeHealth({
					now: new Date("2026-07-29T00:00:02.500Z"),
					workerStaleMs: 1_000,
				}),
			).toMatchObject({
				healthy: true,
				workers: { running: 1, stale: 0, stopped: 0, failed: 0 },
			});

			expect(await first.deleteDefinition(definition.id)).toMatchObject({
				id: definition.id,
			});
			expect(
				await first.listEnrollments({ sequenceId: definition.id }),
			).toEqual([]);
		},
	);

	postgresTest(
		"reports legacy cross-revision conflicts before schema migration",
		async () => {
			if (!databaseUrl) {
				throw new Error("Postgres integration database is unavailable");
			}
			const sql = postgres(databaseUrl, { max: 1, prepare: false });
			const now = new Date("2026-07-29T01:00:00.000Z");
			const initial = createSequenceDefinition(
				{
					id: randomUUID(),
					name: `migration-conflict-${randomUUID()}`,
					steps: [{ id: "stop-v1", type: "stop" }],
				},
				now,
			);
			const definition = parseSequenceDefinition({
				...initial,
				currentRevision: 2,
				revisions: [
					...initial.revisions,
					{
						revision: 2,
						steps: [{ id: "stop-v2", type: "stop" }],
						createdAt: now.toISOString(),
					},
				],
			});
			const firstEnrollment = createSequenceEnrollment(
				initial,
				{
					id: randomUUID(),
					sequenceId: initial.id,
					subscriberId: 404,
				},
				now,
			);
			const secondEnrollment = createSequenceEnrollment(
				definition,
				{
					id: randomUUID(),
					sequenceId: definition.id,
					subscriberId: 404,
				},
				now,
			);
			let migrationRepository: SequenceRepository | undefined;
			try {
				await sql`DELETE FROM listmonk_ops.sequence_enrollments`;
				await sql`DELETE FROM listmonk_ops.sequence_definitions`;
				await sql`
					DROP INDEX IF EXISTS
						listmonk_ops.sequence_enrollments_active_unique_idx
				`;
				await sql`
					CREATE UNIQUE INDEX sequence_enrollments_active_unique_idx
					ON listmonk_ops.sequence_enrollments (
						sequence_id,
						revision,
						subscriber_id
					)
					WHERE status NOT IN ('completed', 'failed', 'cancelled')
				`;
				await sql`
					UPDATE listmonk_ops.sequence_runtime_meta
					SET value = '1', updated_at = now()
					WHERE key = 'schema_version'
				`;
				await sql`
					INSERT INTO listmonk_ops.sequence_definitions (
						id, name_key, status, definition, created_at, updated_at
					)
					VALUES (
						${definition.id}::uuid,
						${definition.name.toLowerCase()},
						${definition.status},
						${sql.json(definition as never)},
						${definition.createdAt}::timestamptz,
						${definition.updatedAt}::timestamptz
					)
				`;
				for (const enrollment of [firstEnrollment, secondEnrollment]) {
					await sql`
						INSERT INTO listmonk_ops.sequence_enrollments (
							id, sequence_id, revision, subscriber_id, status,
							next_run_at, lease_token, lease_expires_at,
							enrollment, created_at, updated_at
						)
						VALUES (
							${enrollment.id}::uuid,
							${enrollment.sequenceId}::uuid,
							${enrollment.revision},
							${enrollment.subscriberId},
							${enrollment.status},
							${enrollment.nextRunAt}::timestamptz,
							NULL,
							NULL,
							${sql.json(enrollment as never)},
							${enrollment.createdAt}::timestamptz,
							${enrollment.updatedAt}::timestamptz
						)
					`;
				}

				migrationRepository = createPostgresSequenceRepository({
					connectionString: databaseUrl,
					maxConnections: 1,
				});
				await expect(migrationRepository.listDefinitions()).rejects.toThrow(
					`sequence=${definition.id}, subscriber=404`,
				);
			} finally {
				await migrationRepository?.close?.();
				await sql`DELETE FROM listmonk_ops.sequence_enrollments`;
				await sql`DELETE FROM listmonk_ops.sequence_definitions`;
				await sql`
					DROP INDEX IF EXISTS
						listmonk_ops.sequence_enrollments_active_unique_idx
				`;
				await sql`
					CREATE UNIQUE INDEX sequence_enrollments_active_unique_idx
					ON listmonk_ops.sequence_enrollments (
						sequence_id,
						subscriber_id
					)
					WHERE status NOT IN ('completed', 'failed', 'cancelled')
				`;
				await sql`
					UPDATE listmonk_ops.sequence_runtime_meta
					SET value = '3', updated_at = now()
					WHERE key = 'schema_version'
				`;
				await sql.end({ timeout: 5 });
			}
		},
	);
});
