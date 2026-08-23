import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getSubscriber,
	isDefinitivePreDispatchError,
	isResourceMissingError,
	sendTransactionalMessage,
	transactionalFromEmailSchema,
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
	retryJitter?: () => number;
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

export const SEQUENCE_RETRY_BASE_DELAY_MS = 5_000;
export const SEQUENCE_RETRY_MAX_DELAY_MS = 5 * 60_000;
export const SEQUENCE_RETRY_MAX_ATTEMPTS = 24;

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
			!Object.hasOwn(current, segment)
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
	const equal = actual === step.value || isDeepStrictEqual(actual, step.value);
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
				retryCount: 0,
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
			retryCount: 0,
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

function retryEnrollment(
	enrollment: SequenceEnrollment,
	now: Date,
	error: unknown,
	jitter: number,
): Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt"> {
	const retryCount = enrollment.retryCount + 1;
	if (retryCount >= SEQUENCE_RETRY_MAX_ATTEMPTS) {
		return withoutLease(
			enrollment,
			{
				status: "failed",
				retryCount,
				lastError: `Sequence delivery failed after ${retryCount} retryable attempts: ${truncateError(error)}`,
			},
			now,
		);
	}
	const cappedDelayMs = Math.min(
		SEQUENCE_RETRY_BASE_DELAY_MS * 2 ** Math.min(retryCount - 1, 16),
		SEQUENCE_RETRY_MAX_DELAY_MS,
	);
	const normalizedJitter = Number.isFinite(jitter)
		? Math.min(Math.max(jitter, 0), 1)
		: 0.5;
	const delayMs = Math.round(
		cappedDelayMs / 2 + (cappedDelayMs / 2) * normalizedJitter,
	);
	return withoutLease(
		enrollment,
		{
			status: "pending",
			retryCount,
			nextRunAt: new Date(now.getTime() + delayMs).toISOString(),
			lastError: truncateError(error),
		},
		now,
	);
}

async function executeSendStep(
	context: SequenceExecutionContext,
	claimed: ClaimedSequenceEnrollment,
	step: Extract<SequenceStep, { type: "send" }>,
	now: Date,
): Promise<Omit<SequenceEnrollment, "leaseToken" | "leaseExpiresAt">> {
	try {
		const parsedFromEmail = transactionalFromEmailSchema
			.optional()
			.safeParse(step.fromEmail);
		if (!parsedFromEmail.success) {
			return withoutLease(
				claimed.enrollment,
				{
					status: "failed",
					retryCount: 0,
					lastError:
						"Sequence delivery failed because its stored From mailbox is invalid",
				},
				now,
			);
		}
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
					retryCount: 0,
					lastError: `Sequence delivery cancelled because ${cannotReceive}`,
				},
				now,
			);
		}
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
				from_email: parsedFromEmail.data,
				data: {
					...step.data,
					...claimed.enrollment.context,
					sequence_id: claimed.enrollment.sequenceId,
					sequence_revision: claimed.enrollment.revision,
					sequence_enrollment_id: claimed.enrollment.id,
					sequence_step_id: step.id,
				},
				content_type: step.contentType,
				messenger: step.messenger,
				subject: step.subject,
				altbody: step.altBody,
				idempotency_key: deterministicSendKey(claimed.enrollment),
			},
		);
		if (!result.sent) {
			return withoutLease(
				claimed.enrollment,
				{
					status: "failed",
					retryCount: 0,
					lastError: "Listmonk rejected the sequence message",
				},
				now,
			);
		}
		return transitionToNext(claimed, now);
	} catch (error) {
		if (error instanceof TransactionalReconcileError) {
			if (error.status === "pending") {
				return retryEnrollment(
					claimed.enrollment,
					now,
					error,
					context.retryJitter?.() ?? Math.random(),
				);
			}
			return withoutLease(
				claimed.enrollment,
				{
					status: "ambiguous",
					lastError: truncateError(error),
				},
				now,
			);
		}
		if (isResourceMissingError(error)) {
			return withoutLease(
				claimed.enrollment,
				{
					status: "cancelled",
					retryCount: 0,
					lastError:
						"Sequence delivery cancelled because the subscriber no longer exists",
				},
				now,
			);
		}
		if (isDefinitivePreDispatchError(error)) {
			return retryEnrollment(
				claimed.enrollment,
				now,
				error,
				context.retryJitter?.() ?? Math.random(),
			);
		}
		return withoutLease(
			claimed.enrollment,
			{
				status: "failed",
				retryCount: 0,
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
					retryCount: 0,
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
							retryCount: 0,
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
						{ status: "completed", retryCount: 0, lastError: undefined },
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
							retryCount: 0,
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
						{ status: "completed", retryCount: 0, lastError: undefined },
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
					retryCount: 0,
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
				{ status: "completed", retryCount: 0, lastError: undefined },
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

/** A tick that claimed enrollments but failed to complete them all. */
export class SequenceTickFailureError extends AggregateError {
	public readonly claimedSteps: readonly Readonly<{
		id: string;
		stepId: string;
	}>[];

	constructor(
		failures: readonly unknown[],
		message: string,
		claimedSteps: readonly Readonly<{ id: string; stepId: string }>[],
	) {
		super(failures, message);
		this.name = "SequenceTickFailureError";
		this.claimedSteps = claimedSteps;
	}
}

/**
 * Recovery pass over an echoed claim set: claim exactly the requested
 * enrollment ids when they are still claimable and execute them, skipping
 * entries that already advanced, completed, turned ambiguous, or hold a
 * live lease. Retrying with the same echoed set converges — each retry
 * only reworks still-claimable members and never claims new due work.
 */
export async function recoverSequenceTick(
	context: SequenceExecutionContext,
	options: {
		claims: readonly Readonly<{ id: string; stepId: string }>[];
		leaseMs?: number;
		now?: Date;
	},
): Promise<SequenceTickSummary & { requested: number; alreadyDone: number }> {
	const now = options.now ?? context.now?.() ?? new Date();
	const claimed = await context.repository.claimSpecific({
		claims: options.claims,
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
	const results = await Promise.allSettled(
		claimed.map((entry) => executeClaimedEnrollment(context, entry, now)),
	);
	for (const result of results) {
		if (result.status === "fulfilled") {
			countOutcome(counts, result.value.status);
		}
	}
	const failures = results
		.filter(
			(result): result is PromiseRejectedResult =>
				result.status === "rejected",
		)
		.map((result) => result.reason);
	if (failures.length > 0) {
		throw new SequenceTickFailureError(
			failures,
			`Failed to complete ${failures.length} claimed sequence enrollment(s)`,
			options.claims,
		);
	}
	return {
		requested: options.claims.length,
		claimed: claimed.length,
		claimedIds: claimed.map((entry) => entry.enrollment.id),
		claimedSteps: claimed.map((entry) => ({
			id: entry.enrollment.id,
			stepId: entry.enrollment.currentStepId,
		})),
		alreadyDone: options.claims.length - claimed.length,
		...counts,
		completedAt: now.toISOString(),
	};
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
	const results = await Promise.allSettled(
		claimed.map((entry) => executeClaimedEnrollment(context, entry, now)),
	);
	for (const result of results) {
		if (result.status === "fulfilled") {
			countOutcome(counts, result.value.status);
		}
	}
	const failures = results
		.filter(
			(result): result is PromiseRejectedResult =>
				result.status === "rejected",
		)
		.map((result) => result.reason);
	if (failures.length > 0) {
		throw new SequenceTickFailureError(
			failures,
			`Failed to complete ${failures.length} claimed sequence enrollment(s)`,
			claimed.map((entry) => ({
				id: entry.enrollment.id,
				stepId: entry.enrollment.currentStepId,
			})),
		);
	}
	return {
		claimed: claimed.length,
		claimedIds: claimed.map((entry) => entry.enrollment.id),
		claimedSteps: claimed.map((entry) => ({
			id: entry.enrollment.id,
			stepId: entry.enrollment.currentStepId,
		})),
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
	if (!record) {
		throw new Error(`Transactional idempotency record ${key} is missing`);
	}
	if (record.status === "pending") {
		throw new Error(
			`Transactional idempotency record ${key} is still pending and cannot be reconciled while delivery may be in flight`,
		);
	}
	if (record.status === "accepted" && resolution !== "sent") {
		throw new Error(
			`Transactional idempotency record ${key} was already accepted and must be reconciled as sent`,
		);
	}
	if (record.status === "failed" && resolution !== "not_sent") {
		throw new Error(
			`Transactional idempotency record ${key} was rejected and cannot be reconciled as sent`,
		);
	}
	if (resolution === "sent") {
		const following = nextStep(revision, step.id);
		const next = withoutLease(
			enrollment,
			following
				? {
						status: "pending",
						retryCount: 0,
						currentStepId: following.id,
						nextRunAt: now.toISOString(),
						lastError: undefined,
					}
				: { status: "completed", retryCount: 0, lastError: undefined },
			now,
		);
		const resolved = await forceCompleteAmbiguous(
			context.repository,
			enrollment,
			next,
		);
		if (record.status !== "accepted") {
			await context.idempotencyStore.commit({
				key,
				claimToken: record.claimToken,
				status: "accepted",
				sent: true,
				now: () => now,
			});
		}
		return resolved;
	}
	const next = withoutLease(
		enrollment,
		{
			status: "pending",
			retryCount: 0,
			nextRunAt: now.toISOString(),
			lastError: undefined,
		},
		now,
	);
	const resolved = await forceCompleteAmbiguous(
		context.repository,
		enrollment,
		next,
	);
	await context.idempotencyStore.release({
		key,
		claimToken: record.claimToken,
		now: () => now,
	});
	return resolved;
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
		const onAbort = (): void => {
			clearTimeout(timeout);
			resolve();
		};
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, intervalMs);
		signal?.addEventListener("abort", onAbort, { once: true });
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
	let workerWriteQueue = Promise.resolve();
	const persistWorker = (snapshot: SequenceWorker): Promise<void> => {
		const write = workerWriteQueue.then(() =>
			context.repository.upsertWorker(snapshot),
		);
		workerWriteQueue = write.catch(() => undefined);
		return write;
	};
	let heartbeatWrite = Promise.resolve();
	const heartbeatTimer = setInterval(() => {
		const heartbeatAt = (context.now?.() ?? new Date()).toISOString();
		worker = { ...worker, heartbeatAt };
		const snapshot = worker;
		heartbeatWrite = persistWorker(snapshot)
			.then(() => {
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
				await persistWorker(worker);
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
				await persistWorker(worker);
				heartbeatFailure = undefined;
			}
			if (!options.signal?.aborted) {
				await sleepUntilNextTick(intervalMs, options.signal);
			}
		}
		clearInterval(heartbeatTimer);
		await heartbeatWrite;
		const stoppedAt = (context.now?.() ?? new Date()).toISOString();
		await persistWorker({
			...worker,
			status: "stopped",
			heartbeatAt: stoppedAt,
			stoppedAt,
		});
	} catch (error) {
		clearInterval(heartbeatTimer);
		await heartbeatWrite;
		const failedAt = (context.now?.() ?? new Date()).toISOString();
		await persistWorker({
			...worker,
			status: "failed",
			heartbeatAt: failedAt,
			stoppedAt: failedAt,
			lastError: truncateError(error),
		});
		throw error;
	}
}
