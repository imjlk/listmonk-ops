import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	SequenceTickFailureError,
	recoverSequenceTick,
	runSequenceTick,
} from "../src/sequence-engine";
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

		// A fresh tick claims both due enrollments and echoes their claim
		// positions (enrollment id + originally claimed step).
		const first = await runSequenceTick(context, { now });
		expect(first.claimed).toBe(2);
		expect([...first.claimedIds].sort()).toEqual(
			[enrollmentA.id, enrollmentB.id].sort(),
		);
		expect(first.claimedSteps).toHaveLength(2);
		for (const step of first.claimedSteps) {
			expect(step.stepId).toBe("send");
		}

		// The retried request carries the echoed set: both members already
		// advanced past the claimed step, so the step-bound recovery pass
		// skips them — one retry converges with no re-execution.
		const recovery = await recoverSequenceTick(context, {
			claims: first.claimedSteps,
			now,
		});
		expect(recovery).toMatchObject({
			requested: 2,
			claimed: 0,
			pendingIds: [],
			alreadyDone: 2,
		});
	});

	test("re-claims only still-due members at their originally claimed step", async () => {
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
		const claims = [
			{ id: enrollmentA.id, stepId: "send" },
			{ id: enrollmentB.id, stepId: "send" },
		];

		// Hold a live lease over both enrollments directly against the
		// store, as a concurrent worker would.
		const leased = await repository.claimDue({ limit: 2, now, leaseMs: 60_000 });
		expect(leased).toHaveLength(2);

		const recovery = await recoverSequenceTick(context, { claims, now });
		// Live leases are skipped and reported as pending (still at their
		// claimed step, retryable after the lease expires), never folded
		// into already_done.
		expect(recovery).toMatchObject({
			requested: 2,
			claimed: 0,
			pendingIds: [enrollmentA.id, enrollmentB.id],
			alreadyDone: 0,
		});

		// After the lease expires, the same echoed set re-claims both at
		// their original steps.
		const later = new Date(now.getTime() + 120_000);
		const expiredRecovery = await recoverSequenceTick(context, {
			claims,
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
				claims: [
					{
						id: "0aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
						stepId: "send",
					},
				],
				now,
			}),
		).rejects.toThrow(/no longer exists/);
	});

	test("surfaces the claim set on a failed tick for recovery", async () => {
		const { repository, idempotencyStore } = await createStores();
		const context = executionContext(repository, idempotencyStore);
		const now = new Date("2026-08-01T09:00:00.000Z");
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{ name: "failing", steps: singleSendSteps },
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(definition, {
				sequenceId: definition.id,
				subscriberId: 1,
			}, now),
		);

		// Deterministic rejection: persisting the completed claim fails
		// after the send succeeded — the ambiguous-outcome window the
		// failure contract exists for.
		const originalComplete = repository.completeClaim.bind(repository);
		(repository as { completeClaim: unknown }).completeClaim = async () => {
			throw new Error("store write failed");
		};
		let failure: unknown;
		try {
			await runSequenceTick(context, { now });
		} catch (error) {
			failure = error;
		} finally {
			(repository as { completeClaim: unknown }).completeClaim =
				originalComplete;
		}
		expect(failure).toBeInstanceOf(SequenceTickFailureError);
		const tickFailure = failure as SequenceTickFailureError;
		// The claim set survives the failure so the caller can recover it.
		expect(tickFailure.claimedSteps).toEqual([
			{ id: enrollment.id, stepId: "send" },
		]);
	});
});
