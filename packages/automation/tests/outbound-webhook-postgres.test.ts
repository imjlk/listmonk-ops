import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { createPostgresOutboundWebhookRepository } from "../src/outbound-webhook-postgres";
import {
	createOutboundWebhookEndpoint,
	enqueueOutboundWebhookEvent,
	listOutboundWebhookDeliveries,
	pruneOutboundWebhookDeliveries,
	reconcileOutboundWebhookDeliveries,
	type OutboundWebhookRepository,
	updateOutboundWebhookEndpoint,
} from "../src/outbound-webhooks";

const databaseUrl =
	process.env.LISTMONK_OPS_TEST_WEBHOOK_DATABASE_URL?.trim();
const postgresTest = databaseUrl ? test : test.skip;
const repositories: OutboundWebhookRepository[] = [];
const deliveryIds = new Set<string>();
const endpointIds = new Set<string>();

async function cleanup(): Promise<void> {
	if (!databaseUrl) {
		return;
	}
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	try {
		if (deliveryIds.size > 0) {
			for (const id of deliveryIds) {
				await sql`
					DELETE FROM listmonk_ops.webhook_deliveries
					WHERE id = ${id}
				`;
			}
		}
		if (endpointIds.size > 0) {
			for (const id of endpointIds) {
				await sql`
					DELETE FROM listmonk_ops.webhook_endpoints
					WHERE id = ${id}
				`;
			}
		}
	} finally {
		await sql.end({ timeout: 5 });
	}
}

beforeAll(async () => {
	if (!databaseUrl) {
		return;
	}
	const repository = createPostgresOutboundWebhookRepository({
		connectionString: databaseUrl,
		maxConnections: 2,
	});
	repositories.push(repository);
	await repository.listEndpoints();
	const sql = postgres(databaseUrl, { max: 1, prepare: false });
	try {
		await sql`
			TRUNCATE TABLE
				listmonk_ops.webhook_deliveries,
				listmonk_ops.webhook_endpoints,
				listmonk_ops.webhook_workers
		`;
	} finally {
		await sql.end({ timeout: 5 });
	}
});

afterAll(async () => {
	await cleanup();
	await Promise.all(repositories.map((repository) => repository.close?.()));
});

describe("Postgres outbound webhook repository", () => {
	postgresTest(
		"coordinates workers, fences stale leases, recovers crashes, and prunes history",
		async () => {
			if (!databaseUrl) {
				throw new Error("Postgres integration database is unavailable");
			}
			const first = repositories[0]!;
			const second = createPostgresOutboundWebhookRepository({
				connectionString: databaseUrl,
				maxConnections: 2,
			});
			repositories.push(second);
			const endpoint = await createOutboundWebhookEndpoint(
				{
					name: `postgres-worker-${randomUUID()}`,
					url: "https://8.8.8.8/hooks",
					secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_POSTGRES",
					eventFilters: ["operation.*"],
				},
				{ repository: first },
			);
			endpointIds.add(endpoint.id);
			const concurrentName = `postgres-worker-updated-${randomUUID()}`;
			await Promise.all([
				updateOutboundWebhookEndpoint(
					endpoint.id,
					{ name: concurrentName },
					{
						repository: first,
						now: new Date("2026-07-28T23:59:58.000Z"),
					},
				),
				updateOutboundWebhookEndpoint(
					endpoint.id,
					{ timeoutMs: 12_345 },
					{
						repository: second,
						now: new Date("2026-07-28T23:59:59.000Z"),
					},
				),
			]);
			expect(await first.getEndpoint(endpoint.id)).toMatchObject({
				name: concurrentName,
				timeoutMs: 12_345,
			});
			const initialAt = new Date("2026-07-29T00:00:00.000Z");
			for (let index = 0; index < 8; index += 1) {
				const enqueued = await enqueueOutboundWebhookEvent(
					{
						id: randomUUID(),
						type: "operation.succeeded",
						source: "operation",
						correlationId: `postgres-worker-${index}`,
						data: {},
					},
					{ repository: first, now: initialAt },
				);
				for (const id of enqueued.deliveryIds) {
					deliveryIds.add(id);
				}
			}

			const [firstClaims, secondClaims] = await Promise.all([
				first.claimDeliveries({
					limit: 4,
					now: initialAt,
					leaseMs: 1_000,
				}),
				second.claimDeliveries({
					limit: 4,
					now: initialAt,
					leaseMs: 1_000,
				}),
			]);
			expect(firstClaims).toHaveLength(4);
			expect(secondClaims).toHaveLength(4);
			expect(
				new Set(
					[...firstClaims, ...secondClaims].map(
						(claimed) => claimed.delivery.id,
					),
				).size,
			).toBe(8);
			const staleWorkerId = randomUUID();
			await first.upsertWorker({
				id: staleWorkerId,
				status: "running",
				startedAt: "2026-07-28T23:59:58.000Z",
				heartbeatAt: "2026-07-28T23:59:58.000Z",
			});
			expect(
				await first.getRuntimeHealth({
					now: new Date("2026-07-29T00:00:02.000Z"),
					workerStaleMs: 1_000,
				}),
			).toMatchObject({
				healthy: false,
				deliveries: { due: 8 },
				workers: { running: 0, stale: 1 },
			});
			await first.upsertWorker({
				id: randomUUID(),
				status: "running",
				startedAt: "2026-07-29T00:00:01.500Z",
				heartbeatAt: "2026-07-29T00:00:01.500Z",
			});
			expect(
				await first.getRuntimeHealth({
					now: new Date("2026-07-29T00:00:02.000Z"),
					workerStaleMs: 1_000,
				}),
			).toMatchObject({
				healthy: true,
				deliveries: { due: 8 },
				workers: { running: 1, stale: 1 },
			});

			const stale = firstClaims[0]!;
			const reclaimed = await second.claimDeliveries({
				limit: 1,
				now: new Date("2026-07-29T00:00:02.000Z"),
				leaseMs: 1_000,
				deliveryIds: [stale.delivery.id],
			});
			expect(reclaimed).toHaveLength(1);
			await expect(
				first.completeDelivery(
					stale.delivery,
					{ success: true, retryable: false, statusCode: 204 },
					stale.endpoint,
					{
						now: new Date("2026-07-29T00:00:02.100Z"),
						baseRetryDelayMs: 1_000,
					},
				),
			).rejects.toThrow("lease is no longer owned");
			await second.completeDelivery(
				reclaimed[0]!.delivery,
				{ success: true, retryable: false, statusCode: 204 },
				reclaimed[0]!.endpoint,
				{
					now: new Date("2026-07-29T00:00:02.100Z"),
					baseRetryDelayMs: 1_000,
				},
			);

			expect(
				await reconcileOutboundWebhookDeliveries({
					repository: first,
					now: new Date("2026-07-29T00:00:02.100Z"),
					limit: 20,
				}),
			).toMatchObject({
				scanned: 7,
				recovered: 7,
				exhausted: 0,
			});
			expect(
				await listOutboundWebhookDeliveries({
					repository: second,
					status: "retry",
					limit: 20,
				}),
			).toHaveLength(7);

			expect(
				await pruneOutboundWebhookDeliveries({
					repository: first,
					before: new Date("2026-07-30T00:00:00.000Z"),
					limit: 20,
				}),
			).toMatchObject({ eligible: 1, deleted: 1 });

			const attemptLimitedEndpoint =
				await createOutboundWebhookEndpoint(
					{
						name: `postgres-attempt-limit-${randomUUID()}`,
						url: "https://8.8.8.8/hooks",
						secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_POSTGRES_LIMIT",
						eventFilters: ["operation.*"],
						maxAttempts: 1,
					},
					{ repository: first },
				);
			endpointIds.add(attemptLimitedEndpoint.id);
			const limitedEnqueue = await enqueueOutboundWebhookEvent(
				{
					id: randomUUID(),
					type: "operation.succeeded",
					source: "operation",
					data: {},
				},
				{
					repository: first,
					endpointIds: [attemptLimitedEndpoint.id],
					now: initialAt,
				},
			);
			limitedEnqueue.deliveryIds.forEach((id) => deliveryIds.add(id));
			await first.claimDeliveries({
				limit: 1,
				deliveryIds: limitedEnqueue.deliveryIds,
				now: initialAt,
				leaseMs: 1_000,
			});
			expect(
				await reconcileOutboundWebhookDeliveries({
					repository: second,
					now: new Date("2026-07-29T00:00:02.000Z"),
					limit: 20,
				}),
			).toMatchObject({ recovered: 0, exhausted: 1 });
			expect(
				await listOutboundWebhookDeliveries({
					repository: first,
					endpointId: attemptLimitedEndpoint.id,
					limit: 20,
				}),
			).toMatchObject([
				{
					status: "exhausted",
					attemptCount: 1,
					lastError: expect.stringContaining("Maximum delivery attempts"),
				},
			]);

			const concurrencyEvent = await enqueueOutboundWebhookEvent(
				{
					id: randomUUID(),
					type: "operation.succeeded",
					source: "operation",
					data: {},
				},
				{
					repository: first,
					endpointIds: [endpoint.id],
					now: initialAt,
				},
			);
			concurrencyEvent.deliveryIds.forEach((id) => deliveryIds.add(id));
			const [concurrencyClaim] = await first.claimDeliveries({
				limit: 1,
				deliveryIds: concurrencyEvent.deliveryIds,
				now: initialAt,
				leaseMs: 1_000,
			});
			await first.completeDelivery(
				concurrencyClaim!.delivery,
				{ success: true, retryable: false, statusCode: 204 },
				concurrencyClaim!.endpoint,
				{ now: initialAt, baseRetryDelayMs: 1_000 },
			);
			const concurrentEnqueue = enqueueOutboundWebhookEvent(
				{
					id: randomUUID(),
					type: "operation.succeeded",
					source: "operation",
					data: {},
				},
				{
					repository: first,
					endpointIds: [endpoint.id],
					now: initialAt,
				},
			);
			const concurrentPrune = pruneOutboundWebhookDeliveries({
				repository: second,
				before: new Date("2026-07-30T00:00:00.000Z"),
				limit: 20,
			});
			const [enqueueResult, pruneResult] = await Promise.all([
				concurrentEnqueue,
				concurrentPrune,
			]);
			enqueueResult.deliveryIds.forEach((id) => deliveryIds.add(id));
			expect(enqueueResult.queuedDeliveries).toBe(1);
			expect(pruneResult.deleted).toBeGreaterThanOrEqual(1);
		},
	);

	postgresTest(
		"migrates an existing v1 schema to v2 under the initialization lock",
		async () => {
			if (!databaseUrl) {
				throw new Error("Postgres integration database is unavailable");
			}
			const sql = postgres(databaseUrl, { max: 1, prepare: false });
			try {
				await sql`
					TRUNCATE TABLE
						listmonk_ops.webhook_deliveries,
						listmonk_ops.webhook_endpoints,
						listmonk_ops.webhook_workers
				`;
				await sql`DROP TABLE listmonk_ops.webhook_workers`;
				await sql`
					ALTER TABLE listmonk_ops.webhook_endpoints
						DROP COLUMN circuit_failure_threshold,
						DROP COLUMN circuit_cooldown_ms,
						DROP COLUMN consecutive_failures,
						DROP COLUMN circuit_state,
						DROP COLUMN circuit_opened_at,
						DROP COLUMN circuit_open_until,
						DROP COLUMN last_failure_at,
						DROP COLUMN last_success_at
				`;
				await sql`
					UPDATE listmonk_ops.webhook_runtime_meta
					SET value = '1'
					WHERE key = 'schema_version'
				`;
			} finally {
				await sql.end({ timeout: 5 });
			}

			const migrated = createPostgresOutboundWebhookRepository({
				connectionString: databaseUrl,
				maxConnections: 1,
			});
			repositories.push(migrated);
			expect(
				await migrated.getRuntimeHealth({
					now: new Date(),
					workerStaleMs: 90_000,
				}),
			).toMatchObject({
				store: "postgres",
				schemaVersion: 2,
			});
			const verify = postgres(databaseUrl, { max: 1, prepare: false });
			try {
				const versions = await verify<{ value: string }[]>`
					SELECT value
					FROM listmonk_ops.webhook_runtime_meta
					WHERE key = 'schema_version'
				`;
				expect(versions[0]?.value).toBe("2");
				const columns = await verify<{ column_name: string }[]>`
					SELECT column_name
					FROM information_schema.columns
					WHERE table_schema = 'listmonk_ops'
						AND table_name = 'webhook_endpoints'
						AND column_name = 'circuit_state'
				`;
				expect(columns).toHaveLength(1);
			} finally {
				await verify.end({ timeout: 5 });
			}
		},
	);
});
