import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	reconcileAmbiguousSequenceEnrollment,
	runSequenceTick,
	runSequenceWorker,
} from "../src/sequence-engine";
import {
	invokeSequenceValidateOperation,
	sequenceOperationCatalog,
	sequenceReconcileOperation,
} from "../src/sequence-operations";
import {
	createFileSequenceRepository,
	createSequenceDefinition,
	createSequenceEnrollment,
	SequenceConflictError,
	type SequenceExecutionContext,
	type SequenceRepository,
	type SequenceWorker,
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

function client(options: {
	status?: string;
	subscriptionStatus?: string;
	subscriberGet?: (id: number) => Promise<unknown>;
	send?: () => Promise<unknown>;
} = {}): SequenceExecutionContext["client"] {
	return {
		subscriber: {
			getById: async ({ path }: { path: { id: number } }) =>
				options.subscriberGet
					? options.subscriberGet(path.id)
					: {
							data: {
								id: path.id,
								status: options.status ?? "enabled",
								lists: [
									{
										subscription_status:
											options.subscriptionStatus ?? "subscribed",
									},
								],
							},
						},
		},
		transactional: {
			send: options.send ?? (async () => ({ data: true })),
		},
	} as unknown as Pick<ListmonkClient, "subscriber" | "transactional">;
}

function executionContext(
	repository: SequenceRepository,
	idempotencyStore: SequenceExecutionContext["idempotencyStore"],
	listmonk = client(),
): SequenceExecutionContext {
	return {
		repository,
		client: listmonk,
		idempotencyStore,
		hashPayload: hashTransactionalPayload,
		target: {
			baseUrl: "http://127.0.0.1:9000",
			username: "test",
		},
	};
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("sequence definitions and file persistence", () => {
	test("pins enrollments to immutable revisions", async () => {
		const { repository } = await createStores();
		const now = new Date("2026-08-01T09:00:00.000Z");
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "welcome",
					steps: [{ id: "stop-v1", type: "stop" }],
				},
				now,
			),
		);
		const first = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 41 },
				now,
			),
		);
		const updated = await repository.updateDefinition(
			definition.id,
			{ steps: [{ id: "stop-v2", type: "stop" }] },
			new Date("2026-08-01T10:00:00.000Z"),
		);
		const second = await repository.createEnrollment(
			createSequenceEnrollment(
				updated,
				{ sequenceId: updated.id, subscriberId: 42 },
				new Date("2026-08-01T10:01:00.000Z"),
			),
		);

		expect(updated.revisions).toHaveLength(2);
		expect(first).toMatchObject({ revision: 1, currentStepId: "stop-v1" });
		expect(second).toMatchObject({ revision: 2, currentStepId: "stop-v2" });
		await expect(
			repository.createEnrollment(
				createSequenceEnrollment(
					updated,
					{ sequenceId: updated.id, subscriberId: 41 },
					new Date("2026-08-01T10:02:00.000Z"),
				),
			),
		).rejects.toBeInstanceOf(SequenceConflictError);
	});

	test("validates condition targets through the shared operation", async () => {
		expect(sequenceOperationCatalog.operations.map((operation) => operation.id))
			.toHaveLength(14);
		expect(sequenceReconcileOperation.safety.destructiveHint).toBe(true);
		await expect(
			invokeSequenceValidateOperation({}, {
				steps: [
					{
						id: "branch",
						type: "condition",
						path: "plan",
						operator: "equals",
						value: "pro",
						on_true: "missing",
						on_false: "stop",
					},
					{ id: "stop", type: "stop" },
				],
			}),
		).rejects.toThrow("references missing step");
		await expect(
			invokeSequenceValidateOperation({}, {
				steps: [
					{
						id: "branch-a",
						type: "condition",
						path: "plan",
						operator: "exists",
						on_true: "branch-b",
						on_false: "stop",
					},
					{
						id: "branch-b",
						type: "condition",
						path: "plan",
						operator: "exists",
						on_true: "branch-a",
						on_false: "stop",
					},
					{ id: "stop", type: "stop" },
				],
			}),
		).rejects.toThrow("must branch to a later step");
		await expect(
			invokeSequenceValidateOperation({}, {
				steps: [{ id: "wait", type: "wait", duration_seconds: 60 }],
			}),
		).rejects.toThrow("must be followed by another step");
	});

	test("claims the oldest due enrollment and removes terminal history on delete", async () => {
		const { repository, idempotencyStore } = await createStores();
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "ordered cleanup",
					steps: [{ id: "stop", type: "stop" }],
				},
				new Date("2026-08-01T08:00:00.000Z"),
			),
		);
		const newer = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{
					sequenceId: definition.id,
					subscriberId: 41,
					startAt: "2026-08-01T09:01:00.000Z",
				},
				new Date("2026-08-01T08:01:00.000Z"),
			),
		);
		const older = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{
					sequenceId: definition.id,
					subscriberId: 42,
					startAt: "2026-08-01T09:00:00.000Z",
				},
				new Date("2026-08-01T08:02:00.000Z"),
			),
		);
		const claimed = await repository.claimDue({
			limit: 1,
			now: new Date("2026-08-01T10:00:00.000Z"),
			leaseMs: 90_000,
		});
		expect(claimed[0]?.enrollment.id).toBe(older.id);
		await repository.completeClaim(
			claimed[0]!.enrollment,
			{
				...older,
				status: "completed",
				updatedAt: "2026-08-01T10:00:00.000Z",
				lastTransitionAt: "2026-08-01T10:00:00.000Z",
			},
		);
		await runSequenceTick(
			executionContext(repository, idempotencyStore),
			{ now: new Date("2026-08-01T10:00:00.000Z") },
		);

		await repository.deleteDefinition(definition.id);
		expect(
			await repository.listEnrollments({ sequenceId: definition.id }),
		).toEqual([]);
		expect(newer.id).not.toBe(older.id);
	});
});

describe("sequence execution", () => {
	test("branches, sends once with idempotency, and completes", async () => {
		const { repository, idempotencyStore } = await createStores();
		let sends = 0;
		const listmonk = client({
			send: async () => {
				sends += 1;
				return { data: true };
			},
		});
		const now = new Date("2026-08-01T09:00:00.000Z");
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "conditional welcome",
					steps: [
						{
							id: "branch",
							type: "condition",
							path: "profile.plan",
							operator: "equals",
							value: "pro",
							onTrue: "send",
							onFalse: "stop",
						},
						{ id: "send", type: "send", templateId: 9 },
						{ id: "stop", type: "stop" },
					],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{
					sequenceId: definition.id,
					subscriberId: 42,
					context: { profile: { plan: "pro" } },
				},
				now,
			),
		);
		const context = executionContext(repository, idempotencyStore, listmonk);

		expect(await runSequenceTick(context, { now })).toMatchObject({
			claimed: 1,
			advanced: 1,
		});
		expect(await runSequenceTick(context, { now })).toMatchObject({
			claimed: 1,
			advanced: 1,
		});
		expect(await runSequenceTick(context, { now })).toMatchObject({
			claimed: 1,
			completed: 1,
		});
		expect(sends).toBe(1);
		expect(await repository.getEnrollment(enrollment.id)).toMatchObject({
			status: "completed",
			currentStepId: "stop",
		});
		const document = await idempotencyStore.load();
		expect(
			document.records[
				`sequence:${enrollment.id}:revision:1:step:send`
			],
		).toMatchObject({ status: "accepted", sent: true });
	});

	test("executes independent claimed sends concurrently", async () => {
		const { repository, idempotencyStore } = await createStores();
		let sends = 0;
		let releaseBoth: (() => void) | undefined;
		const bothStarted = new Promise<void>((resolve) => {
			releaseBoth = resolve;
		});
		const now = new Date();
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "concurrent delivery",
					steps: [{ id: "send", type: "send", templateId: 9 }],
				},
				now,
			),
		);
		for (const subscriberId of [41, 42]) {
			await repository.createEnrollment(
				createSequenceEnrollment(
					definition,
					{ sequenceId: definition.id, subscriberId },
					now,
				),
			);
		}
		const listmonk = client({
			send: async () => {
				sends += 1;
				if (sends === 2) {
					releaseBoth?.();
				}
				await bothStarted;
				return { data: true };
			},
		});

		expect(
			await runSequenceTick(
				executionContext(repository, idempotencyStore, listmonk),
				{ now },
			),
		).toMatchObject({ claimed: 2, completed: 2 });
		expect(sends).toBe(2);
	});

	test("compares structured condition values independent of object key order", async () => {
		const { repository, idempotencyStore } = await createStores();
		const now = new Date();
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "structured condition",
					steps: [
						{
							id: "condition",
							type: "condition",
							path: "profile",
							operator: "equals",
							value: { plan: "pro", region: "kr" },
							onTrue: "matched",
							onFalse: "not-matched",
						},
						{ id: "matched", type: "stop" },
						{ id: "not-matched", type: "stop" },
					],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{
					sequenceId: definition.id,
					subscriberId: 42,
					context: { profile: { region: "kr", plan: "pro" } },
				},
				now,
			),
		);

		await runSequenceTick(
			executionContext(repository, idempotencyStore),
			{ now },
		);
		expect(await repository.getEnrollment(enrollment.id)).toMatchObject({
			status: "pending",
			currentStepId: "matched",
		});
	});

	test("does not traverse inherited properties in condition paths", async () => {
		const { repository, idempotencyStore } = await createStores();
		const now = new Date();
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "own property condition",
					steps: [
						{
							id: "condition",
							type: "condition",
							path: "constructor",
							operator: "exists",
							onTrue: "inherited",
							onFalse: "missing",
						},
						{ id: "inherited", type: "stop" },
						{ id: "missing", type: "stop" },
					],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42, context: {} },
				now,
			),
		);

		await runSequenceTick(
			executionContext(repository, idempotencyStore),
			{ now },
		);
		expect(await repository.getEnrollment(enrollment.id)).toMatchObject({
			currentStepId: "missing",
		});
	});

	test("cancels blocklisted subscribers before sending", async () => {
		const { repository, idempotencyStore } = await createStores();
		let sends = 0;
		const now = new Date("2026-08-01T09:00:00.000Z");
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "blocked",
					steps: [{ id: "send", type: "send", templateId: 9 }],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42 },
				now,
			),
		);
		const result = await runSequenceTick(
			executionContext(
				repository,
				idempotencyStore,
				client({
					status: "blocklisted",
					send: async () => {
						sends += 1;
						return { data: true };
					},
				}),
			),
			{ now },
		);

		expect(result.cancelled).toBe(1);
		expect(sends).toBe(0);
		expect(await repository.getEnrollment(enrollment.id)).toMatchObject({
			status: "cancelled",
			lastError: expect.stringContaining("blocklisted"),
		});
	});

	test("cancels an enrollment when its subscriber was deleted", async () => {
		const { repository, idempotencyStore } = await createStores();
		const now = new Date();
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "deleted subscriber",
					steps: [{ id: "send", type: "send", templateId: 9 }],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42 },
				now,
			),
		);

		expect(
			await runSequenceTick(
				executionContext(
					repository,
					idempotencyStore,
					client({
						subscriberGet: async () => ({
							error: new Error("subscriber not found"),
							response: { status: 404 },
						}),
					}),
				),
				{ now },
			),
		).toMatchObject({ cancelled: 1 });
		expect(await repository.getEnrollment(enrollment.id)).toMatchObject({
			status: "cancelled",
			lastError: expect.stringContaining("no longer exists"),
		});
	});

	test("retries a definitive pre-dispatch failure instead of terminalizing", async () => {
		const { repository, idempotencyStore } = await createStores();
		const now = new Date("2026-08-01T09:00:00.000Z");
		let attempts = 0;
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "retry outage",
					steps: [{ id: "send", type: "send", templateId: 9 }],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42 },
				now,
			),
		);
		const context = executionContext(
			repository,
			idempotencyStore,
			client({
				send: async () => {
					attempts += 1;
					if (attempts === 1) {
						throw Object.assign(new Error("connect ECONNREFUSED"), {
							code: "ECONNREFUSED",
						});
					}
					return { data: true };
				},
			}),
		);

		await runSequenceTick(context, { now });
		expect(await repository.getEnrollment(enrollment.id)).toMatchObject({
			status: "pending",
			lastError: expect.stringContaining("ECONNREFUSED"),
		});
		expect(
			await runSequenceTick(context, {
				now: new Date(now.getTime() + 5_000),
			}),
		).toMatchObject({ completed: 1 });
		expect(attempts).toBe(2);
	});

	test("recovers a pending replay after the original worker commits", async () => {
		const { repository, idempotencyStore } = await createStores();
		const firstNow = new Date("2026-08-01T09:00:00.000Z");
		let releaseSend: (() => void) | undefined;
		let signalStarted: (() => void) | undefined;
		const sendStarted = new Promise<void>((resolve) => {
			signalStarted = resolve;
		});
		const sendReleased = new Promise<void>((resolve) => {
			releaseSend = resolve;
		});
		let sends = 0;
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "pending replay",
					steps: [{ id: "send", type: "send", templateId: 9 }],
				},
				firstNow,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42 },
				firstNow,
			),
		);
		const context = executionContext(
			repository,
			idempotencyStore,
			client({
				send: async () => {
					sends += 1;
					signalStarted?.();
					await sendReleased;
					return { data: true };
				},
			}),
		);

		const firstTick = runSequenceTick(context, {
			now: firstNow,
			leaseMs: 1_000,
		});
		await sendStarted;
		const replayNow = new Date(firstNow.getTime() + 1_500);
		expect(
			await runSequenceTick(context, { now: replayNow, leaseMs: 1_000 }),
		).toMatchObject({ claimed: 1, advanced: 1, ambiguous: 0 });
		releaseSend?.();
		await expect(firstTick).rejects.toBeInstanceOf(AggregateError);
		expect(
			await runSequenceTick(context, {
				now: new Date(replayNow.getTime() + 5_000),
			}),
		).toMatchObject({ completed: 1, ambiguous: 0 });
		expect(await repository.getEnrollment(enrollment.id)).toMatchObject({
			status: "completed",
		});
		expect(sends).toBe(1);
	});

	test("keeps ambiguous sends active until an operator resolves them", async () => {
		const { repository, idempotencyStore } = await createStores();
		let fail = true;
		let sends = 0;
		const now = new Date("2026-08-01T09:00:00.000Z");
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "ambiguous",
					steps: [
						{ id: "send", type: "send", templateId: 9 },
						{ id: "stop", type: "stop" },
					],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42 },
				now,
			),
		);
		const context = executionContext(
			repository,
			idempotencyStore,
			client({
				send: async () => {
					sends += 1;
					if (fail) {
						throw new TypeError("fetch failed");
					}
					return { data: true };
				},
			}),
		);

		expect(await runSequenceTick(context, { now })).toMatchObject({
			ambiguous: 1,
		});
		await expect(
			repository.createEnrollment(
				createSequenceEnrollment(
					definition,
					{ sequenceId: definition.id, subscriberId: 42 },
					now,
				),
			),
		).rejects.toBeInstanceOf(SequenceConflictError);
		await expect(repository.deleteDefinition(definition.id)).rejects.toThrow(
			"non-terminal enrollments",
		);

		fail = false;
		expect(
			await reconcileAmbiguousSequenceEnrollment(
				context,
				enrollment.id,
				"not_sent",
				now,
			),
		).toMatchObject({ status: "pending", currentStepId: "send" });
		expect(await runSequenceTick(context, { now })).toMatchObject({
			advanced: 1,
		});
		expect(await runSequenceTick(context, { now })).toMatchObject({
			completed: 1,
		});
		expect(sends).toBe(2);
	});

	test("commits an operator-confirmed ambiguous send before advancing", async () => {
		const { repository, idempotencyStore } = await createStores();
		let sends = 0;
		const now = new Date();
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "confirmed ambiguous",
					steps: [
						{ id: "send", type: "send", templateId: 9 },
						{ id: "stop", type: "stop" },
					],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42 },
				now,
			),
		);
		const context = executionContext(
			repository,
			idempotencyStore,
			client({
				send: async () => {
					sends += 1;
					throw new TypeError("fetch failed after the server accepted it");
				},
			}),
		);

		expect(await runSequenceTick(context, { now })).toMatchObject({
			ambiguous: 1,
		});
		expect(
			await reconcileAmbiguousSequenceEnrollment(
				context,
				enrollment.id,
				"sent",
				now,
			),
		).toMatchObject({ status: "pending", currentStepId: "stop" });
		const record =
			(await idempotencyStore.load()).records[
				`sequence:${enrollment.id}:revision:1:step:send`
			];
		expect(record).toMatchObject({ status: "accepted", sent: true });
		expect(await runSequenceTick(context, { now })).toMatchObject({
			completed: 1,
		});
		expect(sends).toBe(1);
	});

	test("keeps the unknown send record when enrollment reconciliation fails", async () => {
		const { repository, idempotencyStore } = await createStores();
		const now = new Date();
		const definition = await repository.createDefinition(
			createSequenceDefinition(
				{
					name: "failed reconciliation",
					steps: [{ id: "send", type: "send", templateId: 9 }],
				},
				now,
			),
		);
		const enrollment = await repository.createEnrollment(
			createSequenceEnrollment(
				definition,
				{ sequenceId: definition.id, subscriberId: 42 },
				now,
			),
		);
		const context = executionContext(
			repository,
			idempotencyStore,
			client({
				send: async () => {
					throw new TypeError("fetch failed after dispatch");
				},
			}),
		);
		expect(await runSequenceTick(context, { now })).toMatchObject({
			ambiguous: 1,
		});
		const failingContext = {
			...context,
			repository: {
				...repository,
				async resolveAmbiguous() {
					throw new Error("sequence store unavailable");
				},
			},
		};

		await expect(
			reconcileAmbiguousSequenceEnrollment(
				failingContext,
				enrollment.id,
				"sent",
				now,
			),
		).rejects.toThrow("sequence store unavailable");
		expect(
			(await idempotencyStore.load()).records[
				`sequence:${enrollment.id}:revision:1:step:send`
			],
		).toMatchObject({ status: "unknown" });
	});
});

describe("sequence worker health", () => {
	test("heartbeats during a long tick and prunes abandoned worker records", async () => {
		const { repository: fileRepository, idempotencyStore } =
			await createStores();
		const old = "2026-06-01T00:00:00.000Z";
		await fileRepository.upsertWorker({
			id: "a8c00ca8-13d1-4b51-8442-ff5e992d2e2b",
			status: "running",
			startedAt: old,
			heartbeatAt: old,
		});
		await fileRepository.upsertWorker({
			id: "a15b4e27-1e77-4dcb-ab17-ed3f1b17a6ed",
			status: "stopped",
			startedAt: old,
			heartbeatAt: old,
			stoppedAt: old,
		});

		const writes: SequenceWorker[] = [];
		let activeWorkerWrites = 0;
		let maximumConcurrentWorkerWrites = 0;
		const repository: SequenceRepository = {
			...fileRepository,
			async claimDue() {
				await new Promise((resolve) => setTimeout(resolve, 550));
				return [];
			},
			async upsertWorker(worker) {
				activeWorkerWrites += 1;
				maximumConcurrentWorkerWrites = Math.max(
					maximumConcurrentWorkerWrites,
					activeWorkerWrites,
				);
				try {
					await new Promise((resolve) => setTimeout(resolve, 100));
					writes.push(worker);
					await fileRepository.upsertWorker(worker);
				} finally {
					activeWorkerWrites -= 1;
				}
			},
		};
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 320);
		await runSequenceWorker(
			executionContext(repository, idempotencyStore),
			{
				workerId: "ac8b3c1b-1990-4eab-97a9-b2f4fc576fb3",
				intervalMs: 250,
				heartbeatIntervalMs: 250,
				signal: controller.signal,
			},
		);

		expect(
			writes.filter((worker) => worker.status === "running").length,
		).toBeGreaterThanOrEqual(3);
		expect(maximumConcurrentWorkerWrites).toBe(1);
		const health = await fileRepository.getRuntimeHealth({
			now: new Date(),
			workerStaleMs: 90_000,
		});
		expect(health.workers).toMatchObject({
			running: 0,
			stopped: 1,
			failed: 0,
		});
	});
});
