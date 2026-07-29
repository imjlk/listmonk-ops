import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createPostgresSequenceRepository } from "../src/sequence-postgres";
import {
	createSequenceDefinition,
	createSequenceEnrollment,
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
});
