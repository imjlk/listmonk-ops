import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFileOutboundWebhookRepository,
	createOutboundWebhookEndpoint,
	enqueueOperationLifecycleEvent,
	reconcileOutboundWebhookDeliveries,
	type OutboundWebhookRepository,
} from "../src/outbound-webhooks";

const directories: string[] = [];

async function createRepository(): Promise<OutboundWebhookRepository> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-reconcile-"));
	directories.push(directory);
	return createFileOutboundWebhookRepository({
		path: join(directory, "webhooks.json"),
	});
}

describe("webhook reconcile echoed-set recovery", () => {
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
	});

	test("a retry with a smaller limit still covers the echoed batch", async () => {
		const repository = await createRepository();
		await createOutboundWebhookEndpoint(
			{
				name: "recon-limit",
				url: "https://8.8.8.8/hook",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_RECON",
				eventFilters: ["operation.*"],
			},
			{ repository },
		);
		const now = new Date("2026-08-01T09:00:00.000Z");
		const ids: string[] = [];
		for (let index = 0; index < 3; index += 1) {
			const event = await enqueueOperationLifecycleEvent(
				{
					executionId: `exec-l${index}-${Math.random().toString(36).slice(2, 8)}`,
					operationId: "lists.list",
					event: "succeeded",
					at: now.toISOString(),
				},
				{ repository, now },
			);
			ids.push(...event.deliveryIds);
			await repository.claimDeliveries({
				limit: 1,
				now,
				leaseMs: 60_000,
				deliveryIds: event.deliveryIds,
			});
		}

		const later = new Date(now.getTime() + 120_000);
		const first = await reconcileOutboundWebhookDeliveries({
			repository,
			now: later,
			limit: 100,
		});
		expect(first.scanned).toBe(3);

		// Claim the second batch again so a retry has work to re-examine,
		// then recover with the echoed set under a limit SMALLER than the
		// batch — every echoed member must still be considered.
		await repository.claimDeliveries({
			limit: 3,
			now: later,
			leaseMs: 60_000,
			deliveryIds: ids,
		});
		const muchLater = new Date(later.getTime() + 120_000);
		const recovery = await reconcileOutboundWebhookDeliveries({
			repository,
			now: muchLater,
			limit: 1,
			deliveryIds: first.scannedIds,
		});
		expect(recovery).toMatchObject({ scanned: 3, recovered: 3 });
	});

	test("echoes scanned ids and a bounded retry converges", async () => {
		const repository = await createRepository();
		await createOutboundWebhookEndpoint(
			{
				name: "recon",
				url: "https://8.8.8.8/hook",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_RECON",
				eventFilters: ["operation.*"],
			},
			{ repository },
		);
		const now = new Date("2026-08-01T09:00:00.000Z");
		const event = await enqueueOperationLifecycleEvent(
			{
				executionId: `exec-${Math.random().toString(36).slice(2, 8)}`,
				operationId: "lists.list",
				event: "succeeded",
				at: now.toISOString(),
			},
			{ repository, now },
		);

		// A live worker claim whose lease later expires (the crash window).
		await repository.claimDeliveries({
			limit: 1,
			now,
			leaseMs: 60_000,
			deliveryIds: event.deliveryIds,
		});

		const later = new Date(now.getTime() + 120_000);
		const first = await reconcileOutboundWebhookDeliveries({
			repository,
			now: later,
			limit: 100,
		});
		expect(first).toMatchObject({ scanned: 1, recovered: 1 });
		expect([...first.scannedIds]).toEqual(event.deliveryIds);

		// A bounded retry over the echoed set: the lease is already
		// recovered, so nothing is delivering — one retry converges.
		const recovery = await reconcileOutboundWebhookDeliveries({
			repository,
			now: later,
			limit: 100,
			deliveryIds: first.scannedIds,
		});
		expect(recovery).toMatchObject({
			scanned: 0,
			recovered: 0,
			scannedIds: [],
		});

		// A NEW delivery expiring later is outside the echoed set: the
		// bounded retry must not touch it.
		const secondEvent = await enqueueOperationLifecycleEvent(
			{
				executionId: `exec2-${Math.random().toString(36).slice(2, 8)}`,
				operationId: "lists.list",
				event: "succeeded",
				at: now.toISOString(),
			},
			{ repository, now },
		);
		await repository.claimDeliveries({
			limit: 1,
			now,
			leaseMs: 60_000,
			deliveryIds: secondEvent.deliveryIds,
		});
		const stillBounded = await reconcileOutboundWebhookDeliveries({
			repository,
			now: later,
			limit: 100,
			deliveryIds: first.scannedIds,
		});
		expect(stillBounded).toMatchObject({ scanned: 0, recovered: 0 });
	});
});
