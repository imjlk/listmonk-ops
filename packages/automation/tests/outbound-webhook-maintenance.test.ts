import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFileOutboundWebhookRepository,
	createOutboundWebhookEndpoint,
	dispatchOutboundWebhooks,
	enqueueOutboundWebhookEvent,
	listOutboundWebhookDeliveries,
	pruneOutboundWebhookDeliveries,
	reconcileOutboundWebhookDeliveries,
	updateOutboundWebhookEndpoint,
} from "../src/outbound-webhooks";

const directories: string[] = [];

async function createRepository() {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-webhook-maintenance-"),
	);
	directories.push(directory);
	return createFileOutboundWebhookRepository({
		path: join(directory, "webhooks.json"),
	});
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("outbound webhook repository maintenance", () => {
	test("previews, recovers, delivers, and prunes an expired lease", async () => {
		const repository = await createRepository();
		await createOutboundWebhookEndpoint(
			{
				name: "worker",
				url: "https://8.8.8.8/hooks",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_WORKER",
				eventFilters: ["operation.*"],
			},
			{ repository },
		);
		const enqueuedAt = new Date("2026-07-29T00:00:00.000Z");
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.succeeded",
				source: "operation",
				data: {},
			},
			{ repository, now: enqueuedAt },
		);
		const [claimed] = await repository.claimDeliveries({
			limit: 1,
			now: enqueuedAt,
			leaseMs: 1_000,
		});
		expect(claimed?.delivery).toMatchObject({ status: "delivering" });

		expect(
			await reconcileOutboundWebhookDeliveries({
				repository,
				now: new Date("2026-07-29T00:00:02.000Z"),
				dryRun: true,
			}),
		).toMatchObject({
			scanned: 1,
			recovered: 1,
			dryRun: true,
		});
		expect(await listOutboundWebhookDeliveries({ repository })).toMatchObject([
			{ status: "delivering" },
		]);

		expect(
			await reconcileOutboundWebhookDeliveries({
				repository,
				now: new Date("2026-07-29T00:00:02.000Z"),
			}),
		).toMatchObject({
			recovered: 1,
			dryRun: false,
		});
		expect(
			await dispatchOutboundWebhooks({
				store: { repository },
				now: new Date("2026-07-29T00:00:03.000Z"),
				fetcher: mock(
					async () => new Response(null, { status: 204 }),
				) as typeof fetch,
				resolveSecret: () => "secret",
			}),
		).toMatchObject({ succeeded: 1 });

		const cutoff = new Date("2026-07-30T00:00:00.000Z");
		expect(
			await pruneOutboundWebhookDeliveries({
				repository,
				before: cutoff,
				dryRun: true,
			}),
		).toMatchObject({ eligible: 1, deleted: 0, dryRun: true });
		expect(
			await pruneOutboundWebhookDeliveries({
				repository,
				before: cutoff,
			}),
		).toMatchObject({ eligible: 1, deleted: 1, dryRun: false });
		expect(await listOutboundWebhookDeliveries({ repository })).toEqual([]);
	});

	test("exhausts an expired lease when its endpoint is disabled", async () => {
		const repository = await createRepository();
		const endpoint = await createOutboundWebhookEndpoint(
			{
				name: "disabled-worker",
				url: "https://8.8.8.8/hooks",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_DISABLED",
				eventFilters: ["operation.*"],
			},
			{ repository },
		);
		const at = new Date("2026-07-29T00:00:00.000Z");
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.succeeded",
				source: "operation",
				data: {},
			},
			{ repository, now: at },
		);
		await repository.claimDeliveries({
			limit: 1,
			now: at,
			leaseMs: 1_000,
		});
		await updateOutboundWebhookEndpoint(
			endpoint.id,
			{ enabled: false },
			{ repository },
		);

		expect(
			await reconcileOutboundWebhookDeliveries({
				repository,
				now: new Date("2026-07-29T00:00:02.000Z"),
			}),
		).toMatchObject({ recovered: 0, exhausted: 1 });
		expect(await listOutboundWebhookDeliveries({ repository })).toMatchObject([
			{
				status: "exhausted",
				lastError: expect.stringContaining("missing or disabled"),
			},
		]);
	});
});
