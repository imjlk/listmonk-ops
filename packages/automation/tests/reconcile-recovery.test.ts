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
