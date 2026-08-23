import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverSequenceTick, runSequenceTick } from "../src/sequence-engine";
import {
	createFileSequenceRepository,
	createSequenceDefinition,
	createSequenceEnrollment,
	type SequenceExecutionContext,
	type SequenceRepository,
} from "../src";

const directories: string[] = [];

async function createStores() {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-sequences-"));
	directories.push(directory);
	return {
		repository: createFileSequenceRepository(join(directory, "sequences.json")),
		idempotencyStore: createFileBackedTransactionalIdempotencyStore({
			storePath: join(directory, "transactional.json"),
		}),
	};
}

function executionContext(
	repository: SequenceRepository,
	idempotencyStore: SequenceExecutionContext["idempotencyStore"],
): SequenceExecutionContext {
	return {
		repository,
		client: {
			subscriber: {
				getById: async ({ path }: { path: { id: number } }) => ({
					data: {
						id: path.id,
						status: "enabled",
						lists: [{ subscription_status: "subscribed" }],
					},
				}),
			},
			transactional: {
				send: async () => ({ data: true }),
			},
		} as unknown as SequenceExecutionContext["client"],
		idempotencyStore,
		hashPayload: hashTransactionalPayload,
		retryJitter: () => 1,
		target: { baseUrl: "http://127.0.0.1:9000", username: "test" },
	};
}

const singleSendSteps = [
	{
		id: "send",
		type: "send" as const,
		templateId: 9,
		fromEmail: "Welcome <welcome@example.com>",
	},
	{ id: "stop", type: "stop" as const },
];

describe("sequence tick echoed-set recovery", () => {
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
	});

	test("echoes the exact claimed set and converges a retried recovery", async () => {
		const { repository, idempotencyStore } = await createStores();
		const context = executionContext(repository, idempotencyStore);
		const now = new Date("2026-08-01T09:00:00.000Z");
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{ name: "recovery", steps: singleSendSteps },
				now,
			),
		);
		const enrollmentA = await repository.createEnrollment(
			createSequenceEnrollment(definition, {
				sequenceId: definition.id,
				subscriberId: 1,
			}, now),
		);
		const enrollmentB = await repository.createEnrollment(
			createSequenceEnrollment(definition, {
				sequenceId: definition.id,
				subscriberId: 2,
			}, now),
		);

		// A fresh tick claims both due enrollments and echoes their ids.
		const first = await runSequenceTick(context, { now });
		expect(first.claimed).toBe(2);
		expect([...first.claimedIds].sort()).toEqual(
			[enrollmentA.id, enrollmentB.id].sort(),
		);

		// The retried request carries the echoed set: the recovery pass
		// works only that set (each member runs its remaining step), and a
		// second identical retry converges with nothing left to claim.
		const recovery = await recoverSequenceTick(context, {
			ids: first.claimedIds,
			now,
		});
		expect(recovery.requested).toBe(2);
		expect(recovery.claimed + recovery.alreadyDone).toBe(2);
		const converged = await recoverSequenceTick(context, {
			ids: first.claimedIds,
			now,
		});
		expect(converged).toMatchObject({
			requested: 2,
			claimed: 0,
			alreadyDone: 2,
		});
	});

	test("re-claims only still-due members of the echoed set", async () => {
		const { repository, idempotencyStore } = await createStores();
		const context = executionContext(repository, idempotencyStore);
		const now = new Date("2026-08-01T09:00:00.000Z");
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{ name: "partial", steps: singleSendSteps },
				now,
			),
		);
		const enrollmentA = await repository.createEnrollment(
			createSequenceEnrollment(definition, {
				sequenceId: definition.id,
				subscriberId: 1,
			}, now),
		);
		const enrollmentB = await repository.createEnrollment(
			createSequenceEnrollment(definition, {
				sequenceId: definition.id,
				subscriberId: 2,
			}, now),
		);

		// Hold a live lease over both enrollments directly against the
		// store, as a concurrent worker would.
		const leased = await repository.claimDue({ limit: 2, now, leaseMs: 60_000 });
		expect(leased).toHaveLength(2);

		const recovery = await recoverSequenceTick(context, {
			ids: [enrollmentA.id, enrollmentB.id],
			now,
		});
		// Live leases are skipped; the pass never claims anything outside
		// the echoed set.
		expect(recovery).toMatchObject({
			requested: 2,
			claimed: 0,
			alreadyDone: 2,
		});

		// After the lease expires, the same echoed set re-claims both.
		const later = new Date(now.getTime() + 120_000);
		const expiredRecovery = await recoverSequenceTick(context, {
			ids: [enrollmentA.id, enrollmentB.id],
			now: later,
		});
		expect(expiredRecovery).toMatchObject({
			requested: 2,
			claimed: 2,
		});
	});

	test("rejects an echoed set containing an unknown enrollment", async () => {
		const { repository, idempotencyStore } = await createStores();
		const context = executionContext(repository, idempotencyStore);
		const now = new Date("2026-08-01T09:00:00.000Z");

		await expect(
			recoverSequenceTick(context, {
				ids: ["0aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
				now,
			}),
		).rejects.toThrow(/no longer exists/);
	});
});
