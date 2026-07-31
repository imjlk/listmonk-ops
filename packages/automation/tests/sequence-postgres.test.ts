import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import {
	invokeSequenceEnrollmentGetOperation,
	invokeSequenceEnrollmentListOperation,
	invokeSequenceGetOperation,
	invokeSequenceListOperation,
} from "../src/sequence-operations";
import { createPostgresSequenceRepository } from "../src/sequence-postgres";
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
					const definition = createSequenceDefinition(
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
					await file.createDefinition(definition);
					await database.createDefinition(definition);
					const enrollment = createSequenceEnrollment(
						definition,
						{
							id: enrollmentIds[index]!,
							sequenceId: definition.id,
							subscriberId: 40 + index,
						},
						now,
					);
					await file.createEnrollment(enrollment);
					await database.createEnrollment(enrollment);
				}

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
			const nextRevision = await first.updateDefinition(
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
					SET value = '2', updated_at = now()
					WHERE key = 'schema_version'
				`;
				await sql.end({ timeout: 5 });
			}
		},
	);
});
