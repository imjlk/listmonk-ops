import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	enqueueSuccessfulOperationLifecycleEvents,
	projectSuccessfulOperationLifecycleEvents,
} from "../src/outbound-webhook-domain-events";
import {
	createOutboundWebhookEndpoint,
	listOutboundWebhookDeliveries,
} from "../src/outbound-webhooks";

const directories: string[] = [];

async function createStorePath(): Promise<string> {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-domain-events-"),
	);
	directories.push(directory);
	return join(directory, "webhooks.json");
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("successful operation lifecycle projection", () => {
	test("projects campaign, subscriber, and A/B test events without PII", () => {
		const executionId = "execution-123";
		const campaign = projectSuccessfulOperationLifecycleEvents({
			executionId,
			operationId: "campaigns.schedule",
			operationInput: {
				id: 42,
				send_at: "2026-08-01T09:00:00.000Z",
			},
			operationOutput: { id: 42, status: "scheduled" },
		});
		const subscriber = projectSuccessfulOperationLifecycleEvents({
			executionId,
			operationId: "subscribers.create",
			operationInput: { email: "hidden@example.com" },
			operationOutput: {
				id: 7,
				email: "hidden@example.com",
				status: "enabled",
			},
		});
		const abtest = projectSuccessfulOperationLifecycleEvents({
			executionId,
			operationId: "abtest.analyze",
			operationInput: { test_id: "test-1" },
			operationOutput: {
				analysis: {
					testId: "test-1",
					winner: { id: "variant-a" },
				},
			},
		});

		expect(campaign).toMatchObject([
			{
				type: "campaign.scheduled",
				subject: { kind: "campaign", key: "42" },
				data: {
					operation_id: "campaigns.schedule",
					status: "scheduled",
				},
			},
		]);
		expect(subscriber).toMatchObject([
			{
				type: "subscriber.created",
				subject: { kind: "subscriber", key: "7" },
				data: { status: "enabled" },
			},
		]);
		expect(abtest).toMatchObject([
			{
				type: "abtest.winner-selected",
				subject: { kind: "experiment", key: "test-1" },
				data: { winner_variant_id: "variant-a" },
			},
		]);
		expect(JSON.stringify([...campaign, ...subscriber, ...abtest])).not.toContain(
			"hidden@example.com",
		);
	});

	test("uses stable event IDs and endpoint deduplication for one execution", async () => {
		const path = await createStorePath();
		await createOutboundWebhookEndpoint(
			{
				name: "campaign-events",
				url: "https://8.8.8.8/hooks",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_CAMPAIGNS",
				eventFilters: ["campaign.*"],
			},
			{ path },
		);
		const input = {
			executionId: "execution-stable",
			operationId: "campaigns.start",
			operationInput: { id: 19 },
			operationOutput: { id: 19, status: "running" },
		};

		expect(
			await enqueueSuccessfulOperationLifecycleEvents(input, { path }),
		).toMatchObject({
			projected: 1,
			queuedDeliveries: 1,
			duplicateDeliveries: 0,
		});
		expect(
			await enqueueSuccessfulOperationLifecycleEvents(input, { path }),
		).toMatchObject({
			projected: 1,
			queuedDeliveries: 0,
			duplicateDeliveries: 1,
		});
		const deliveries = await listOutboundWebhookDeliveries({ path });
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({
			event: {
				type: "campaign.started",
				correlationId: "execution-stable",
				subject: { kind: "campaign", key: "19" },
			},
		});
	});

	test("does not emit subscriber blocklist events for dry runs", () => {
		expect(
			projectSuccessfulOperationLifecycleEvents({
				executionId: "execution-preview",
				operationId: "subscribers.blocklist",
				operationInput: {
					subscriber_ids: [1, 2],
					dry_run: true,
				},
				operationOutput: {
					processed: 2,
					succeeded: 2,
					failed: 0,
				},
			}),
		).toEqual([]);
	});
});
