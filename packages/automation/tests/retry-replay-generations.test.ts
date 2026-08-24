import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFileOutboundWebhookRepository,
	createOutboundWebhookEndpoint,
	enqueueOperationLifecycleEvent,
	replayOutboundWebhookDeadLetters,
	retryOutboundWebhookDelivery,
	type OutboundWebhookRepository,
} from "../src/outbound-webhooks";

const directories: string[] = [];

async function createRepository(): Promise<OutboundWebhookRepository> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-generations-"));
	directories.push(directory);
	return createFileOutboundWebhookRepository({
		path: join(directory, "webhooks.json"),
	});
}

const refusedFetcher = (async () => {
	throw new Error("connection refused");
}) as unknown as typeof fetch;

const okFetcher = (async () =>
	new Response("ok", { status: 200 })) as unknown as typeof fetch;

describe("webhook delivery retry generation binding", () => {
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
	});

	test("an echoed generation converges a repeated retry", async () => {
		const repository = await createRepository();
		await createOutboundWebhookEndpoint(
			{
				name: "gen",
				url: "https://8.8.8.8/hook",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_GEN",
				eventFilters: ["operation.*"],
				maxAttempts: 1,
			},
			{ repository },
		);
		const now = new Date("2026-08-01T09:00:00.000Z");
		const event = await enqueueOperationLifecycleEvent(
			{
				executionId: `exec-g-${Math.random().toString(36).slice(2, 8)}`,
				operationId: "lists.list",
				event: "succeeded",
				at: now.toISOString(),
			},
			{ repository, now },
		);
		const id = event.deliveryIds[0]!;

		// Exhaust the delivery (maxAttempts 1).
		const { dispatchOutboundWebhooks } = await import(
			"../src/outbound-webhooks"
		);
		await dispatchOutboundWebhooks({
			store: { repository },
			now,
			fetcher: refusedFetcher,
			resolveSecret: () => "whsec",
			deliveryIds: [id],
		});

		// Retry bound to the pre-retry generation (0): fires and moves to
		// pending with manualRetryCount 1, echoing the pre-request
		// generation for the repeat.
		const first = await retryOutboundWebhookDelivery(id, {
			repository,
			now,
			expectedManualRetryCount: 0,
		});
		expect(first.retried).toBe(true);
		expect(first.delivery.manualRetryCount).toBe(1);
		expect(first.retryGeneration).toBe(0);

		// The identical repeat while pending is rejected: the echo was
		// consumed by the still-in-flight retry, so a later repeat after a
		// worker cycle cannot silently re-pass the same generation.
		await expect(
			retryOutboundWebhookDelivery(id, {
				repository,
				now,
				expectedManualRetryCount: 0,
			}),
		).rejects.toThrow(/already pending at the echoed generation/);

		// A dispatcher completes and re-exhausts it: the generation moved to
		// 1, so the echoed-0 repeat reports unmodified instead of another
		// cycle.
		await dispatchOutboundWebhooks({
			store: { repository },
			now,
			fetcher: refusedFetcher,
			resolveSecret: () => "whsec",
			deliveryIds: [id],
		});
		const afterCycle = await retryOutboundWebhookDelivery(id, {
			repository,
			now,
			expectedManualRetryCount: 0,
		});
		expect(afterCycle.retried).toBe(false);
		expect(afterCycle.delivery.manualRetryCount).toBe(1);
		// Echoing the POST-RETRY count (1) passes the guard and starts a
		// second cycle — exactly why the guidance and the retry_generation
		// echo carry the PRE-request count instead.
		const hazardous = await retryOutboundWebhookDelivery(id, {
			repository,
			now,
			expectedManualRetryCount: 1,
		});
		expect(hazardous.retried).toBe(true);
		expect(hazardous.retryGeneration).toBe(1);
		expect(hazardous.delivery.manualRetryCount).toBe(2);
	});
});

describe("webhook dlq replay generation binding", () => {
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
	});

	test("an echoed generation never replays a re-exhausted record", async () => {
		const repository = await createRepository();
		await createOutboundWebhookEndpoint(
			{
				name: "dlq",
				url: "https://8.8.8.8/hook",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_DLQ",
				eventFilters: ["operation.*"],
				maxAttempts: 1,
			},
			{ repository },
		);
		const now = new Date("2026-08-01T09:00:00.000Z");
		const event = await enqueueOperationLifecycleEvent(
			{
				executionId: `exec-d-${Math.random().toString(36).slice(2, 8)}`,
				operationId: "lists.list",
				event: "succeeded",
				at: now.toISOString(),
			},
			{ repository, now },
		);
		const id = event.deliveryIds[0]!;
		const { dispatchOutboundWebhooks } = await import(
			"../src/outbound-webhooks"
		);
		await dispatchOutboundWebhooks({
			store: { repository },
			now,
			fetcher: refusedFetcher,
			resolveSecret: () => "whsec",
			deliveryIds: [id],
		});

		// Destructive replay of the dead letter; the result echoes the
		// pre-replay generation (0).
		const first = await replayOutboundWebhookDeadLetters({
			repository,
			now,
			dryRun: false,
			deliveryIds: [id],
		});
		expect(first.replayed).toBe(1);
		expect(first.replayedGenerations).toEqual([
			{ id, manualRetryCount: 0 },
		]);

		// A worker re-exhausts the replayed record.
		await dispatchOutboundWebhooks({
			store: { repository },
			now,
			fetcher: refusedFetcher,
			resolveSecret: () => "whsec",
			deliveryIds: [id],
		});

		// The identical echoed request (ids + generations) skips it: the
		// record moved past generation 0.
		const repeat = await replayOutboundWebhookDeadLetters({
			repository,
			now,
			dryRun: false,
			deliveryIds: [id],
			expectedManualRetryCounts: new Map([[id, 0]]),
		});
		expect(repeat).toMatchObject({ eligible: 0, replayed: 0 });

		// A dry run echoes the CURRENT generation (1) for the next cycle.
		const preview = await replayOutboundWebhookDeadLetters({
			repository,
			now,
			dryRun: true,
			deliveryIds: [id],
		});
		expect(preview.replayedGenerations).toEqual([
			{ id, manualRetryCount: 1 },
		]);
	});
});
