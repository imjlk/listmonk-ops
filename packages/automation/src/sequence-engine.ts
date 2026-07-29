import { randomUUID } from "node:crypto";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getSubscriber,
	sendTransactionalMessage,
	TransactionalReconcileError,
	type TransactionalIdempotencyStore,
} from "@listmonk-ops/operations";
import { DEFAULT_SEQUENCE_LEASE_MS } from "./sequences";
import type {
	ClaimedSequenceEnrollment,
	SequenceEnrollment,
	SequenceEnrollmentStatus,
	SequenceRepository,
	SequenceRevision,
	SequenceStep,
	SequenceTickSummary,
	SequenceWorker,
} from "./sequences";

export interface SequenceExecutionContext {
	repository: SequenceRepository;
	client: Pick<ListmonkClient, "subscriber" | "transactional">;
	idempotencyStore: TransactionalIdempotencyStore;
	hashPayload: (serialized: string) => string;
	target?: {
		baseUrl?: string;
		username?: string;
	};
	now?: () => Date;
}

export interface RunSequenceTickOptions {
	limit?: number;
	leaseMs?: number;
	now?: Date;
}

export interface RunSequenceWorkerOptions {
	intervalMs?: number;
	heartbeatIntervalMs?: number;
	limit?: number;
	leaseMs?: number;
	workerId?: string;
	signal?: AbortSignal;
	onTick?: (summary: SequenceTickSummary) => void | Promise<void>;
	onError?: (error: unknown) => void | Promise<void>;
}

export type SequenceAmbiguousResolution = "sent" | "not_sent";

function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function truncateError(error: unknown): string {
	return toErrorMessage(error).slice(0, 1_000);
}

function nextStep(
	revision: SequenceRevision,
	currentStepId: string,
): SequenceStep | undefined {
	const index = revision.steps.findIndex((step) => step.id === currentStepId);
	if (index < 0) {
		throw new Error(
			`Sequence revision ${revision.revision} does not contain current step ${currentStepId}`,
		);
	}
	return revision.steps[index + 1];
}

function resolvePath(
	value: Readonly<Record<string, unknown>>,
	path: string,
): unknown {
	let current: unknown = value;
	for (const segment of path.split(".")) {
		if (
			typeof current !== "object" ||
			current === null ||
			Array.isArray(current) ||
			!(segment in current)
		) {
			return undefined;
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}

function evaluateCondition(
	step: Extract<SequenceStep, { type: "condition" }>,
	context: Readonly<Record<string, unknown>>,
): boolean {
	const actual = resolvePath(context, step.path);
	if (step.operator === "exists") {
		return actual !== undefined;
	}
	const equal =
		actual === step.value ||
		JSON.stringify(actual) === JSON.stringify(step.value);
	return step.operator === "equals" ? equal : !equal;
}

function withoutLease(
	enrollment: SequenceEnrollment,
	changes: Partial<SequenceEnrollment>,
	now: Date,
): Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt"> {
	const {
		leaseToken: _leaseToken,
		leaseExpiresAt: _leaseExpiresAt,
		...rest
	} = enrollment;
	return {
		...rest,
		...changes,
		lastTransitionAt: now.toISOString(),
		updatedAt: now.toISOString(),
	};
}

function transitionToNext(
	claimed: ClaimedSequenceEnrollment,
	now: Date,
	overrides: Partial<SequenceEnrollment> = {},
): Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt"> {
	const step = nextStep(claimed.revision, claimed.enrollment.currentStepId);
	if (!step) {
		return withoutLease(
			claimed.enrollment,
			{
				status: "completed",
				lastError: undefined,
				...overrides,
			},
			now,
		);
	}
	return withoutLease(
		claimed.enrollment,
		{
			status: "pending",
			currentStepId: step.id,
			nextRunAt: now.toISOString(),
			lastError: undefined,
			...overrides,
		},
		now,
	);
}

function subscriberCannotReceive(subscriber: {
	status?: string;
	lists?: Array<Record<string, unknown>>;
}): string | undefined {
	const status = subscriber.status?.toLowerCase();
	if (status === "blocklisted" || status === "disabled") {
		return `subscriber is ${status}`;
	}
	const lists = subscriber.lists ?? [];
	if (
		lists.length > 0 &&
		lists.every(
			(list) =>
				typeof list.subscription_status === "string" &&
				list.subscription_status.toLowerCase() === "unsubscribed",
		)
	) {
		return "subscriber is unsubscribed from every list";
	}
	return undefined;
}

function deterministicSendKey(enrollment: SequenceEnrollment): string {
	return `sequence:${enrollment.id}:revision:${enrollment.revision}:step:${enrollment.currentStepId}`;
}

async function executeSendStep(
	context: SequenceExecutionContext,
	claimed: ClaimedSequenceEnrollment,
	step: Extract<SequenceStep, { type: "send" }>,
	now: Date,
): Promise<Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt">> {
	const subscriber = await getSubscriber(
		{ client: context.client },
		{ id: claimed.enrollment.subscriberId },
	);
	const cannotReceive = subscriberCannotReceive(
		subscriber as {
			status?: string;
			lists?: Array<Record<string, unknown>>;
		},
	);
	if (cannotReceive) {
		return withoutLease(
			claimed.enrollment,
			{
				status: "cancelled",
				lastError: `Sequence delivery cancelled because ${cannotReceive}`,
			},
			now,
		);
	}

	try {
		const result = await sendTransactionalMessage(
			{
				client: context.client,
				idempotencyStore: context.idempotencyStore,
				hashPayload: context.hashPayload,
				target: context.target,
			},
			{
				template_id: step.templateId,
				subscriber_id: claimed.enrollment.subscriberId,
				from_email: step.fromEmail,
				data: {
					...step.data,
					...claimed.enrollment.context,
					sequence_id: claimed.enrollment.sequenceId,
					sequence_revision: claimed.enrollment.revision,
					sequence_enrollment_id: claimed.enrollment.id,
					sequence_step_id: step.id,
				},
				content_type: step.contentType,
				idempotency_key: deterministicSendKey(claimed.enrollment),
			},
		);
		if (!result.sent) {
			return withoutLease(
				claimed.enrollment,
				{
					status: "failed",
					lastError: "Listmonk rejected the sequence message",
				},
				now,
			);
		}
		return transitionToNext(claimed, now);
	} catch (error) {
		if (error instanceof TransactionalReconcileError) {
			return withoutLease(
				claimed.enrollment,
				{
					status: "ambiguous",
					lastError: truncateError(error),
				},
				now,
			);
		}
		return withoutLease(
			claimed.enrollment,
			{
				status: "failed",
				lastError: truncateError(error),
			},
			now,
		);
	}
}

async function executeClaimedEnrollment(
	context: SequenceExecutionContext,
	claimed: ClaimedSequenceEnrollment,
	now: Date,
): Promise<SequenceEnrollment> {
	const step = claimed.revision.steps.find(
		(candidate) => candidate.id === claimed.enrollment.currentStepId,
	);
	if (!step) {
		return context.repository.completeClaim(
			claimed.enrollment,
			withoutLease(
				claimed.enrollment,
				{
					status: "failed",
					lastError: `Current step ${claimed.enrollment.currentStepId} is missing from revision ${claimed.revision.revision}`,
				},
				now,
			),
		);
	}

	let next: Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt">;
	switch (step.type) {
		case "send":
			next = await executeSendStep(context, claimed, step, now);
			break;
		case "wait": {
			const following = nextStep(claimed.revision, step.id);
			next = following
				? withoutLease(
						claimed.enrollment,
						{
							status: "waiting",
							currentStepId: following.id,
							nextRunAt: new Date(
								now.getTime() + step.durationSeconds * 1_000,
							).toISOString(),
							lastError: undefined,
						},
						now,
					)
				: withoutLease(
						claimed.enrollment,
						{ status: "completed", lastError: undefined },
						now,
					);
			break;
		}
		case "wait_until": {
			const following = nextStep(claimed.revision, step.id);
			const at = new Date(step.at);
			next = following
				? withoutLease(
						claimed.enrollment,
						{
							status:
								at.getTime() > now.getTime() ? "waiting" : "pending",
							currentStepId: following.id,
							nextRunAt:
								at.getTime() > now.getTime()
									? at.toISOString()
									: now.toISOString(),
							lastError: undefined,
						},
						now,
					)
				: withoutLease(
						claimed.enrollment,
						{ status: "completed", lastError: undefined },
						now,
					);
			break;
		}
		case "condition": {
			const targetId = evaluateCondition(step, claimed.enrollment.context)
				? step.onTrue
				: step.onFalse;
			next = withoutLease(
				claimed.enrollment,
				{
					status: "pending",
					currentStepId: targetId,
					nextRunAt: now.toISOString(),
					lastError: undefined,
				},
				now,
			);
			break;
		}
		case "stop":
			next = withoutLease(
				claimed.enrollment,
				{ status: "completed", lastError: undefined },
				now,
			);
			break;
		default:
			step satisfies never;
			throw new Error("Unsupported sequence step");
	}
	return context.repository.completeClaim(claimed.enrollment, next);
}

function countOutcome(
	summary: {
		advanced: number;
		waiting: number;
		completed: number;
		failed: number;
		ambiguous: number;
		cancelled: number;
	},
	status: SequenceEnrollmentStatus,
): void {
	if (status === "waiting") {
		summary.waiting += 1;
	} else if (status === "completed") {
		summary.completed += 1;
	} else if (status === "failed") {
		summary.failed += 1;
	} else if (status === "ambiguous") {
		summary.ambiguous += 1;
	} else if (status === "cancelled") {
		summary.cancelled += 1;
	} else {
		summary.advanced += 1;
	}
}

export async function runSequenceTick(
	context: SequenceExecutionContext,
	options: RunSequenceTickOptions = {},
): Promise<SequenceTickSummary> {
	const now = options.now ?? context.now?.() ?? new Date();
	const claimed = await context.repository.claimDue({
		limit: options.limit ?? 25,
		now,
		leaseMs: options.leaseMs ?? DEFAULT_SEQUENCE_LEASE_MS,
	});
	const counts = {
		advanced: 0,
		waiting: 0,
		completed: 0,
		failed: 0,
		ambiguous: 0,
		cancelled: 0,
	};
	for (const entry of claimed) {
		const result = await executeClaimedEnrollment(context, entry, now);
		countOutcome(counts, result.status);
	}
	return {
		claimed: claimed.length,
		...counts,
		completedAt: now.toISOString(),
	};
}

export async function reconcileAmbiguousSequenceEnrollment(
	context: SequenceExecutionContext,
	enrollmentId: string,
	resolution: SequenceAmbiguousResolution,
	now = context.now?.() ?? new Date(),
): Promise<SequenceEnrollment> {
	const enrollment = await context.repository.getEnrollment(enrollmentId);
	if (enrollment.status !== "ambiguous") {
		throw new Error(
			`Sequence enrollment ${enrollmentId} is not ambiguous (status: ${enrollment.status})`,
		);
	}
	const definition = await context.repository.getDefinition(
		enrollment.sequenceId,
	);
	const revision = definition.revisions.find(
		(candidate) => candidate.revision === enrollment.revision,
	);
	if (!revision) {
		throw new Error(
			`Sequence enrollment ${enrollmentId} references missing revision ${enrollment.revision}`,
		);
	}
	const step = revision.steps.find(
		(candidate) => candidate.id === enrollment.currentStepId,
	);
	if (step?.type !== "send") {
		throw new Error(
			`Ambiguous sequence enrollment ${enrollmentId} is not positioned on a send step`,
		);
	}
	const key = deterministicSendKey(enrollment);
	const document = await context.idempotencyStore.load();
	const record = document.records[key];
	if (!record || record.status !== "unknown") {
		throw new Error(
			`Transactional idempotency record ${key} is missing or not unknown`,
		);
	}
	if (resolution === "not_sent") {
		await context.idempotencyStore.release({
			key,
			claimToken: record.claimToken,
			now: () => now,
		});
	}

	if (resolution === "sent") {
		await context.idempotencyStore.commit({
			key,
			claimToken: record.claimToken,
			status: "accepted",
			sent: true,
			now: () => now,
		});
		const following = nextStep(revision, step.id);
		const next = withoutLease(
			enrollment,
			following
				? {
						status: "pending",
						currentStepId: following.id,
						nextRunAt: now.toISOString(),
						lastError: undefined,
					}
				: { status: "completed", lastError: undefined },
			now,
		);
		return forceCompleteAmbiguous(context.repository, enrollment, next);
	}
	const next = withoutLease(
		enrollment,
		{
			status: "pending",
			nextRunAt: now.toISOString(),
			lastError: undefined,
		},
		now,
	);
	return forceCompleteAmbiguous(context.repository, enrollment, next);
}

async function forceCompleteAmbiguous(
	repository: SequenceRepository,
	enrollment: SequenceEnrollment,
	next: Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt">,
): Promise<SequenceEnrollment> {
	return repository.resolveAmbiguous(enrollment, next);
}

function sleepUntilNextTick(
	intervalMs: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (signal?.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const timeout = setTimeout(resolve, intervalMs);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timeout);
				resolve();
			},
			{ once: true },
		);
	});
}

export async function runSequenceWorker(
	context: SequenceExecutionContext,
	options: RunSequenceWorkerOptions = {},
): Promise<void> {
	const workerId = options.workerId ?? randomUUID();
	const intervalMs = Math.max(250, options.intervalMs ?? 5_000);
	const startedAt = (context.now?.() ?? new Date()).toISOString();
	let worker: SequenceWorker = {
		id: workerId,
		status: "running",
		startedAt,
		heartbeatAt: startedAt,
	};
	await context.repository.upsertWorker(worker);
	const heartbeatIntervalMs = Math.max(
		250,
		options.heartbeatIntervalMs ?? 30_000,
	);
	let heartbeatFailure: Error | undefined;
	let heartbeatWrite = Promise.resolve();
	const heartbeatTimer = setInterval(() => {
		heartbeatWrite = heartbeatWrite
			.then(async () => {
				const heartbeatAt = (context.now?.() ?? new Date()).toISOString();
				worker = { ...worker, heartbeatAt };
				await context.repository.upsertWorker(worker);
				heartbeatFailure = undefined;
			})
			.catch((error: unknown) => {
				heartbeatFailure =
					error instanceof Error ? error : new Error(String(error));
			});
	}, heartbeatIntervalMs);
	try {
		while (!options.signal?.aborted) {
			try {
				if (heartbeatFailure) {
					throw heartbeatFailure;
				}
				const tick = await runSequenceTick(context, {
					limit: options.limit,
					leaseMs: options.leaseMs,
				});
				if (heartbeatFailure) {
					throw heartbeatFailure;
				}
				const heartbeatAt = (context.now?.() ?? new Date()).toISOString();
				const { lastError: _lastError, ...healthyWorker } = worker;
				worker = { ...healthyWorker, heartbeatAt, lastTick: tick };
				await context.repository.upsertWorker(worker);
				heartbeatFailure = undefined;
				await options.onTick?.(tick);
			} catch (error) {
				await options.onError?.(error);
				const heartbeatAt = (context.now?.() ?? new Date()).toISOString();
				worker = {
					...worker,
					heartbeatAt,
					lastError: truncateError(error),
				};
				await context.repository.upsertWorker(worker);
				heartbeatFailure = undefined;
			}
			if (!options.signal?.aborted) {
				await sleepUntilNextTick(intervalMs, options.signal);
			}
		}
		clearInterval(heartbeatTimer);
		await heartbeatWrite;
		const stoppedAt = (context.now?.() ?? new Date()).toISOString();
		await context.repository.upsertWorker({
			...worker,
			status: "stopped",
			heartbeatAt: stoppedAt,
			stoppedAt,
		});
	} catch (error) {
		clearInterval(heartbeatTimer);
		await heartbeatWrite;
		const failedAt = (context.now?.() ?? new Date()).toISOString();
		await context.repository.upsertWorker({
			...worker,
			status: "failed",
			heartbeatAt: failedAt,
			stoppedAt: failedAt,
			lastError: truncateError(error),
		});
		throw error;
	}
}
