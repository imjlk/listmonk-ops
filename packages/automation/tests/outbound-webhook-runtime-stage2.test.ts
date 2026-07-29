import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createFileOutboundWebhookRepository,
	getOutboundWebhookRuntimeHealth,
	listOutboundWebhookEndpoints,
	upsertOutboundWebhookWorker,
} from "../src/outbound-webhooks";
import { runOutboundWebhookWorker } from "../src/outbound-webhook-worker";

const directories: string[] = [];

async function createStorePath(): Promise<string> {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-webhook-stage2-"),
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

describe("outbound webhook runtime stage 2", () => {
	test("reads a v1 file store and persists the compatible v2 runtime shape", async () => {
		const path = await createStorePath();
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				endpoints: [
					{
						id: "03b73791-da72-43eb-89e0-b0b803081618",
						name: "legacy",
						url: "https://8.8.8.8/hooks",
						secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_LEGACY",
						eventFilters: ["delivery.*"],
						enabled: true,
						timeoutMs: 10_000,
						maxAttempts: 6,
						createdAt: "2026-07-29T00:00:00.000Z",
						updatedAt: "2026-07-29T00:00:00.000Z",
					},
				],
				deliveries: [],
			}),
		);

		expect(await listOutboundWebhookEndpoints({ path })).toMatchObject([
			{
				name: "legacy",
				circuitFailureThreshold: 5,
				circuitCooldownMs: 300_000,
			},
		]);
		const controller = new AbortController();
		await runOutboundWebhookWorker({
			store: { path },
			workerId: "5d2cc008-f92d-493c-a444-8ba08b217dc8",
			intervalMs: 250,
			signal: controller.signal,
			onTick: () => controller.abort(),
		});

		const persisted = JSON.parse(await readFile(path, "utf8")) as {
			version: number;
			endpointRuntime: unknown[];
			workers: { status: string }[];
		};
		expect(persisted).toMatchObject({
			version: 2,
			endpointRuntime: [],
			workers: [{ status: "stopped" }],
		});
	});

	test("records a graceful worker heartbeat and reports no stale worker", async () => {
		const path = await createStorePath();
		const controller = new AbortController();
		const result = await runOutboundWebhookWorker({
			store: { path },
			intervalMs: 250,
			signal: controller.signal,
			onTick: () => controller.abort(),
		});
		expect(result).toMatchObject({
			ticks: 1,
			claimed: 0,
			succeeded: 0,
		});
		expect(
			await getOutboundWebhookRuntimeHealth({
				path,
				workerStaleMs: 1_000,
			}),
		).toMatchObject({
			healthy: true,
			workers: {
				running: 0,
				stale: 0,
				stopped: 1,
			},
		});
	});

	test("expires abandoned running workers without making an idle runtime unhealthy", async () => {
		const path = await createStorePath();
		await upsertOutboundWebhookWorker(
			{
				id: "53818fe6-989f-4d42-914a-7090d58374fb",
				status: "running",
				startedAt: "2026-07-29T00:00:00.000Z",
				heartbeatAt: "2026-07-29T00:00:00.000Z",
			},
			{ path },
		);

		expect(
			await getOutboundWebhookRuntimeHealth({
				path,
				now: new Date("2026-07-29T00:00:02.000Z"),
				workerStaleMs: 1_000,
			}),
		).toMatchObject({
			healthy: true,
			workers: {
				running: 0,
				stale: 1,
				lastHeartbeatAt: undefined,
			},
		});
	});

	test("prunes terminal worker history after the retention window", async () => {
		const path = await createStorePath();
		await upsertOutboundWebhookWorker(
			{
				id: "e71c465a-b980-44a2-a7c8-c671d4d5374c",
				status: "stopped",
				startedAt: "2026-06-01T00:00:00.000Z",
				heartbeatAt: "2026-06-01T00:00:01.000Z",
				stoppedAt: "2026-06-01T00:00:01.000Z",
			},
			{ path },
		);
		await upsertOutboundWebhookWorker(
			{
				id: "7f6a4b5d-a0e5-4eae-9e9e-64d522c40b83",
				status: "running",
				startedAt: "2026-07-29T00:00:00.000Z",
				heartbeatAt: "2026-07-29T00:00:00.000Z",
			},
			{ path },
		);

		expect(
			await getOutboundWebhookRuntimeHealth({
				path,
				now: new Date("2026-07-29T00:00:00.000Z"),
			}),
		).toMatchObject({
			workers: { running: 1, stopped: 0, failed: 0 },
		});
	});

	test("refreshes its heartbeat while a delivery tick is still running", async () => {
		const path = await createStorePath();
		const repository = createFileOutboundWebhookRepository({ path });
		let releaseReconcile!: () => void;
		let markReconcileStarted!: () => void;
		const reconcileStarted = new Promise<void>((resolve) => {
			markReconcileStarted = resolve;
		});
		const reconcileGate = new Promise<void>((resolve) => {
			releaseReconcile = resolve;
		});
		const controller = new AbortController();
		const running = runOutboundWebhookWorker({
			store: {
				repository: {
					...repository,
					async reconcile(options) {
						markReconcileStarted();
						await reconcileGate;
						return repository.reconcile(options);
					},
				},
			},
			heartbeatIntervalMs: 250,
			signal: controller.signal,
			onTick: () => controller.abort(),
		});
		await reconcileStarted;
		const initial = JSON.parse(await readFile(path, "utf8")) as {
			workers: { heartbeatAt: string }[];
		};
		await new Promise((resolve) => setTimeout(resolve, 350));
		const refreshed = JSON.parse(await readFile(path, "utf8")) as {
			workers: { heartbeatAt: string }[];
		};
		expect(Date.parse(refreshed.workers[0]!.heartbeatAt)).toBeGreaterThan(
			Date.parse(initial.workers[0]!.heartbeatAt),
		);
		releaseReconcile();
		await running;
	});

	test("backs off and recovers from a transient tick failure", async () => {
		const path = await createStorePath();
		const repository = createFileOutboundWebhookRepository({ path });
		let reconcileAttempts = 0;
		const controller = new AbortController();
		const tickErrors: string[] = [];
		const result = await runOutboundWebhookWorker({
			store: {
				repository: {
					...repository,
					async reconcile(options) {
						reconcileAttempts += 1;
						if (reconcileAttempts === 1) {
							throw new Error("temporary store outage");
						}
						return repository.reconcile(options);
					},
				},
			},
			intervalMs: 250,
			failureBackoffMs: 250,
			signal: controller.signal,
			onTickError: ({ error }) => tickErrors.push(error),
			onTick: () => controller.abort(),
		});

		expect(tickErrors).toEqual(["temporary store outage"]);
		expect(reconcileAttempts).toBe(2);
		expect(result.ticks).toBe(1);
	});

	test("persists and reports a worker after its failure limit is reached", async () => {
		const path = await createStorePath();
		const repository = createFileOutboundWebhookRepository({ path });
		await expect(
			runOutboundWebhookWorker({
				store: {
					repository: {
						...repository,
						async reconcile() {
							throw new Error("persistent store outage");
						},
					},
				},
				workerId: "4fb7fd67-f8ec-4652-b6ee-fc4f4a8c459a",
				failureLimit: 1,
			}),
		).rejects.toThrow("persistent store outage");
		expect(await getOutboundWebhookRuntimeHealth({ path })).toMatchObject({
			workers: {
				running: 0,
				stopped: 0,
				failed: 1,
			},
		});
	});
});
