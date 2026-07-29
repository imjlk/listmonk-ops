import { randomUUID } from "node:crypto";
import {
	dispatchOutboundWebhooks,
	reconcileOutboundWebhookDeliveries,
	truncateOutboundWebhookError,
	upsertOutboundWebhookWorker,
	type DispatchOutboundWebhooksResult,
	type OutboundWebhookStoreOptions,
	type OutboundWebhookWorker,
	type ReconcileOutboundWebhooksResult,
} from "./outbound-webhooks";

export const DEFAULT_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS = 5_000;
export const MIN_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS = 250;
export const MAX_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS = 90_000;
export const DEFAULT_OUTBOUND_WEBHOOK_WORKER_FAILURE_LIMIT = 5;
export const DEFAULT_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS = 1_000;
export const MIN_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS = 250;
export const MAX_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS = 30_000;

export interface RunOutboundWebhookWorkerOptions {
	store: OutboundWebhookStoreOptions;
	signal?: AbortSignal;
	workerId?: string;
	intervalMs?: number;
	dispatchLimit?: number;
	reconcileLimit?: number;
	fetcher?: typeof fetch;
	resolveSecret?: (secretRef: string) => string | undefined;
	onTick?: (result: OutboundWebhookWorkerTickResult) => void;
	onTickError?: (result: OutboundWebhookWorkerTickError) => void;
	failureLimit?: number;
	failureBackoffMs?: number;
}

export interface OutboundWebhookWorkerTickResult {
	reconcile: ReconcileOutboundWebhooksResult;
	dispatch: DispatchOutboundWebhooksResult;
	completedAt: string;
}

export interface OutboundWebhookWorkerTickError {
	error: string;
	consecutiveFailures: number;
	retryInMs: number;
	failedAt: string;
}

export interface RunOutboundWebhookWorkerResult {
	workerId: string;
	startedAt: string;
	stoppedAt: string;
	ticks: number;
	claimed: number;
	succeeded: number;
	retried: number;
	exhausted: number;
}

function waitForWorkerInterval(
	intervalMs: number,
	signal: AbortSignal | undefined,
): Promise<void> {
	if (signal?.aborted) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		let settled = false;
		const finish = () => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timeout);
			signal?.removeEventListener("abort", finish);
			resolve();
		};
		const timeout = setTimeout(finish, intervalMs);
		signal?.addEventListener("abort", finish, { once: true });
	});
}

/**
 * Run a lease-safe long-lived outbox worker. The worker records durable
 * heartbeats, reconciles abandoned leases before each dispatch batch, and
 * marks its final state during graceful shutdown.
 */
export async function runOutboundWebhookWorker(
	options: RunOutboundWebhookWorkerOptions,
): Promise<RunOutboundWebhookWorkerResult> {
	const workerId = options.workerId ?? randomUUID();
	const intervalMs =
		options.intervalMs ?? DEFAULT_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS;
	if (
		!Number.isInteger(intervalMs) ||
		intervalMs < MIN_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS ||
		intervalMs > MAX_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS
	) {
		throw new RangeError(
			`Webhook worker interval must be between ${MIN_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS} and ${MAX_OUTBOUND_WEBHOOK_WORKER_INTERVAL_MS}ms`,
		);
	}
	const failureLimit =
		options.failureLimit ?? DEFAULT_OUTBOUND_WEBHOOK_WORKER_FAILURE_LIMIT;
	if (!Number.isInteger(
		failureLimit,
	) || failureLimit < 1 || failureLimit > 100) {
		throw new RangeError(
			"Webhook worker failure limit must be between 1 and 100",
		);
	}
	const failureBackoffMs =
		options.failureBackoffMs ??
		DEFAULT_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS;
	if (
		!Number.isInteger(failureBackoffMs) ||
		failureBackoffMs < MIN_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS ||
		failureBackoffMs > MAX_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS
	) {
		throw new RangeError(
			`Webhook worker failure backoff must be between ${MIN_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS} and ${MAX_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS}ms`,
		);
	}
	const dispatchLimit = options.dispatchLimit ?? 25;
	const reconcileLimit = options.reconcileLimit ?? 100;
	const startedAt = new Date().toISOString();
	let ticks = 0;
	let claimed = 0;
	let succeeded = 0;
	let retried = 0;
	let exhausted = 0;
	let consecutiveFailures = 0;
	let lastTick: OutboundWebhookWorker["lastTick"];

	await upsertOutboundWebhookWorker(
		{
			id: workerId,
			status: "running",
			startedAt,
			heartbeatAt: startedAt,
		},
		options.store,
	);

	try {
		while (!options.signal?.aborted) {
			try {
				const reconcile = await reconcileOutboundWebhookDeliveries({
					...options.store,
					limit: reconcileLimit,
					dryRun: false,
				});
				const dispatch = await dispatchOutboundWebhooks({
					store: options.store,
					limit: dispatchLimit,
					signal: options.signal,
					fetcher: options.fetcher,
					resolveSecret: options.resolveSecret,
				});
				const completedAt = new Date().toISOString();
				const tick = { reconcile, dispatch, completedAt };
				ticks += 1;
				claimed += dispatch.claimed;
				succeeded += dispatch.succeeded;
				retried += dispatch.retried;
				exhausted += dispatch.exhausted;
				consecutiveFailures = 0;
				lastTick = {
					claimed: dispatch.claimed,
					succeeded: dispatch.succeeded,
					retried: dispatch.retried,
					exhausted: dispatch.exhausted,
					completedAt,
				};
				await upsertOutboundWebhookWorker(
					{
						id: workerId,
						status: "running",
						startedAt,
						heartbeatAt: completedAt,
						lastTick,
					},
					options.store,
				);
				options.onTick?.(tick);
				await waitForWorkerInterval(intervalMs, options.signal);
			} catch (error) {
				if (options.signal?.aborted) {
					break;
				}
				consecutiveFailures += 1;
				if (consecutiveFailures >= failureLimit) {
					throw error;
				}
				const failedAt = new Date().toISOString();
				const retryInMs = Math.min(
					MAX_OUTBOUND_WEBHOOK_WORKER_FAILURE_BACKOFF_MS,
					failureBackoffMs * 2 ** (consecutiveFailures - 1),
				);
				try {
					await upsertOutboundWebhookWorker(
						{
							id: workerId,
							status: "running",
							startedAt,
							heartbeatAt: failedAt,
							lastError: truncateOutboundWebhookError(error),
							...(lastTick === undefined ? {} : { lastTick }),
						},
						options.store,
					);
				} catch (persistenceError) {
					throw new AggregateError(
						[error, persistenceError],
						"Webhook tick failed and its error heartbeat could not be persisted",
					);
				}
				options.onTickError?.({
					error: truncateOutboundWebhookError(error),
					consecutiveFailures,
					retryInMs,
					failedAt,
				});
				await waitForWorkerInterval(retryInMs, options.signal);
			}
		}
	} catch (error) {
		const failedAt = new Date().toISOString();
		try {
			await upsertOutboundWebhookWorker(
				{
					id: workerId,
					status: "failed",
					startedAt,
					heartbeatAt: failedAt,
					stoppedAt: failedAt,
					lastError: truncateOutboundWebhookError(error),
					...(lastTick === undefined ? {} : { lastTick }),
				},
				options.store,
			);
		} catch (persistenceError) {
			throw new AggregateError(
				[error, persistenceError],
				"Webhook worker failed and its final state could not be persisted",
			);
		}
		throw error;
	}

	const stoppedAt = new Date().toISOString();
	await upsertOutboundWebhookWorker(
		{
			id: workerId,
			status: "stopped",
			startedAt,
			heartbeatAt: stoppedAt,
			stoppedAt,
			...(lastTick === undefined ? {} : { lastTick }),
		},
		options.store,
	);
	return {
		workerId,
		startedAt,
		stoppedAt,
		ticks,
		claimed,
		succeeded,
		retried,
		exhausted,
	};
}
