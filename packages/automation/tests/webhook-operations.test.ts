import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	invokeWebhookCreateOperation,
	invokeWebhookDeleteOperation,
	invokeWebhookDeliveryListOperation,
	invokeWebhookDispatchOperation,
	invokeWebhookDlqListOperation,
	invokeWebhookDlqReplayOperation,
	invokeWebhookInboundIngestOperation,
	invokeWebhookListOperation,
	invokeWebhookOperationByMcpName,
	invokeWebhookPruneOperation,
	invokeWebhookReconcileOperation,
	invokeWebhookTestOperation,
	invokeWebhookTickOperation,
	invokeWebhookRuntimeStatusOperation,
	invokeWebhookCircuitResetOperation,
	invokeWebhookUpdateOperation,
	webhookOperationCatalog,
	webhookOperations,
} from "../src/webhook-operations";
import { ingestInboundDeliveryEvent } from "../src/inbound-delivery-events";

const directories: string[] = [];

async function createContext() {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-webhook-operations-"),
	);
	directories.push(directory);
	return {
		store: { path: join(directory, "webhooks.json") },
		fetcher: mock(async () => new Response(null, { status: 204 })) as typeof fetch,
		resolveSecret: () => "test-secret",
	};
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("webhook shared operations", () => {
	test("registers fully described runtime operations", () => {
		expect(webhookOperationCatalog.id).toBe("webhooks");
		expect(webhookOperations.map((operation) => operation.id)).toEqual([
			"webhooks.list",
			"webhooks.create",
			"webhooks.update",
			"webhooks.delete",
			"webhooks.test",
			"webhooks.dispatch",
			"webhooks.delivery.list",
			"webhooks.delivery.retry",
			"webhooks.reconcile",
			"webhooks.prune",
			"webhooks.tick",
			"webhooks.runtime.status",
			"webhooks.inbound.ingest",
			"webhooks.dlq.list",
			"webhooks.dlq.replay",
			"webhooks.circuit.reset",
		]);
		for (const operation of webhookOperations) {
			expect(operation.spec?.id).toBe(operation.id);
			expect(operation.specMigration).toBeUndefined();
		}
		expect(
			webhookOperations.find((operation) => operation.id === "webhooks.test")
				?.safety,
		).toMatchObject({
			destructiveHint: true,
			openWorldHint: true,
			idempotentHint: false,
		});
	});

	test("ingests provider events idempotently and exposes health, DLQ, and circuit controls", async () => {
		const context = await createContext();
		const endpoint = await invokeWebhookCreateOperation(context, {
			name: "provider-events",
			url: "https://8.8.8.8/hooks",
			secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PROVIDER",
			event_filters: ["delivery.*"],
			circuit_failure_threshold: 1,
		});
		const input = {
			provider: "ses",
			provider_event_id: "provider-event-1",
			kind: "rejected" as const,
			message_id: "message-1",
			metadata: { recipient_email: "hidden@example.com", reason: "policy" },
		};
		const first = await invokeWebhookInboundIngestOperation(context, input);
		const duplicate = await invokeWebhookInboundIngestOperation(context, input);
		expect(first).toMatchObject({
			event_type: "delivery.rejected",
			queued_deliveries: 1,
		});
		expect(duplicate).toMatchObject({
			event_id: first.event_id,
			queued_deliveries: 0,
			duplicate_deliveries: 1,
		});

		await invokeWebhookDispatchOperation(
			{ ...context, fetcher: mock(async () => new Response(null, { status: 400 })) as typeof fetch },
			{ limit: 10 },
		);
		const deadLetters = await invokeWebhookDlqListOperation(context, {});
		expect(deadLetters).toMatchObject({
			deliveries: [{ status: "exhausted" }],
		});
		expect(deadLetters.deliveries[0]).toMatchObject({
			last_error_present: true,
		});
		const deadLetterJson = JSON.stringify(deadLetters);
		expect(deadLetterJson).not.toContain('"last_error":');
		expect(deadLetterJson).not.toContain(
			"LISTMONK_OPS_WEBHOOK_SECRET_PROVIDER",
		);
		expect(deadLetterJson).not.toContain("https://8.8.8.8/hooks");
		expect(deadLetterJson).not.toContain("hidden@example.com");
		expect(
			await invokeWebhookDlqReplayOperation(context, { dry_run: true }),
		).toMatchObject({ eligible: 1, replayed: 0, dry_run: true });
		const exhaustedHealth = await invokeWebhookRuntimeStatusOperation(
			context,
			{},
		);
		expect(exhaustedHealth).toMatchObject({
			store: "file",
			schema_version: 2,
			endpoints: { circuit_open: 1 },
			deliveries: { dead_letter: 1 },
		});
		const exhaustedHealthJson = JSON.stringify(exhaustedHealth);
		expect(exhaustedHealthJson).not.toContain(
			"LISTMONK_OPS_WEBHOOK_SECRET_PROVIDER",
		);
		expect(exhaustedHealthJson).not.toContain("https://8.8.8.8/hooks");
		expect(exhaustedHealthJson).not.toContain("hidden@example.com");
		expect(
			await invokeWebhookTestOperation(context, { id: endpoint.endpoint.id }),
		).toMatchObject({
			dispatch: { claimed: 1, succeeded: 1, exhausted: 0, retried: 0 },
		});
		expect(await invokeWebhookRuntimeStatusOperation(context, {})).toMatchObject({
			endpoints: { circuit_open: 0 },
		});
		expect(
			await invokeWebhookCircuitResetOperation(context, {
				id: endpoint.endpoint.id,
			}),
		).toEqual({
			endpoint_id: endpoint.endpoint.id,
			circuit_state: "closed",
			consecutive_failures: 0,
		});
		expect(
			await invokeWebhookDlqReplayOperation(context, {
				dry_run: false,
				limit: 10,
			}),
		).toMatchObject({ eligible: 1, replayed: 1, failed: 0 });
		expect(await invokeWebhookRuntimeStatusOperation(context, {})).toMatchObject({
			endpoints: { circuit_open: 0 },
			deliveries: { dead_letter: 0, pending: 1 },
		});
	});

	test("rejects ambiguous unsubscribe events and oversized provider metadata", async () => {
		const context = await createContext();
		const subscriberUuid = "0e9a8b67-1e4a-4c2d-9102-6ee29048a50c";
		expect(
			await ingestInboundDeliveryEvent(
				{
					provider: "ses",
					providerEventId: "delivery-with-subscriber",
					kind: "delivered",
					subscriberUuid,
				},
				context.store,
			),
		).toMatchObject({
			event: {
				data: { subscriber_uuid: subscriberUuid },
			},
		});
		await expect(
			invokeWebhookInboundIngestOperation(context, {
				provider: "ses",
				provider_event_id: "unsubscribe-without-subscriber",
				kind: "unsubscribed",
				message_id: "message-1",
			}),
		).rejects.toThrow("Missing required parameter: subscriber_uuid");
		await expect(
			invokeWebhookInboundIngestOperation(context, {
				provider: "ses",
				provider_event_id: "oversized-metadata",
				kind: "bounced",
				message_id: "message-2",
				metadata: { payload: "x".repeat(16_385) },
			}),
		).rejects.toThrow("metadata must be JSON serializable");
		await expect(
			ingestInboundDeliveryEvent(
				{
					provider: "ses",
					providerEventId: "invalid-subscriber-uuid",
					kind: "unsubscribed",
					subscriberUuid: "not-a-uuid",
				},
				context.store,
			),
		).rejects.toThrow("subscriberUuid must be a valid UUID");
		await expect(
			ingestInboundDeliveryEvent(
				{
					provider: "ses",
					providerEventId: "invalid-optional-subscriber-uuid",
					kind: "delivered",
					subscriberUuid: "not-a-uuid",
				},
				context.store,
			),
		).rejects.toThrow("subscriberUuid must be a valid UUID");
		await expect(
			ingestInboundDeliveryEvent(
				{
					provider: "ses",
					providerEventId: "x".repeat(201),
					kind: "bounced",
				},
				context.store,
			),
		).rejects.toThrow("providerEventId must not exceed 200 characters");
		await expect(
			invokeWebhookInboundIngestOperation(context, {
				provider: "ses",
				provider_event_id: "x".repeat(201),
				kind: "bounced",
			}),
		).rejects.toThrow("provider_event_id");
	});

	test("runs typed reconcile, prune preview, and worker tick operations", async () => {
		const context = await createContext();
		expect(
			await invokeWebhookReconcileOperation(context, {
				limit: 10,
			}),
		).toEqual({
			scanned: 0,
			recovered: 0,
			exhausted: 0,
			unchanged: 0,
			dry_run: true,
		});
		expect(
			await invokeWebhookPruneOperation(context, {
				older_than_days: 30,
				limit: 10,
				dry_run: true,
			}),
		).toMatchObject({
			eligible: 0,
			deleted: 0,
			dry_run: true,
		});
		expect(
			await invokeWebhookTickOperation(context, {
				dispatch_limit: 10,
				reconcile_limit: 10,
			}),
		).toMatchObject({
			reconcile: { scanned: 0, dry_run: false },
			dispatch: { claimed: 0 },
		});
	});

	test("honors an explicit prune cutoff and requires it for destructive runs", async () => {
		const context = await createContext();
		const before = "2026-01-01T00:00:00.000Z";
		const first = await invokeWebhookPruneOperation(context, {
			older_than_days: 30,
			before,
			limit: 10,
			dry_run: true,
		});
		expect(first.before).toBe(before);
		const second = await invokeWebhookPruneOperation(context, {
			older_than_days: 30,
			before,
			ids: first.ids,
			limit: 10,
			dry_run: false,
		});
		expect(second).toEqual({
			eligible: first.eligible,
			deleted: first.eligible,
			dry_run: false,
			before,
			ids: first.ids,
		});
		await expect(
			invokeWebhookPruneOperation(context, {
				before: "not-a-timestamp",
			}),
		).rejects.toThrow();
		const offsetCutoff = await invokeWebhookPruneOperation(context, {
			before: "2026-01-01T00:00:00.000+02:00",
			dry_run: true,
		});
		expect(offsetCutoff.before).toBe("2025-12-31T22:00:00.000Z");
		await expect(
			invokeWebhookPruneOperation(context, {
				older_than_days: 30,
				dry_run: false,
			}),
		).rejects.toThrow(/before/);
	});

	test("deletes exactly the echoed prune set and retries as a no-op", async () => {
		const context = await createContext();
		const endpoint = await invokeWebhookCreateOperation(context, {
			name: "prune-target",
			url: "https://8.8.8.8/hooks",
			secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PRUNE",
			event_filters: ["delivery.*"],
			circuit_failure_threshold: 1,
		});
		await invokeWebhookInboundIngestOperation(context, {
			provider: "ses",
			provider_event_id: "prune-event-1",
			kind: "rejected" as const,
			message_id: "prune-message-1",
			metadata: { recipient_email: "hidden@example.com", reason: "policy" },
		});
		await invokeWebhookDispatchOperation(
			{
				...context,
				fetcher: mock(
					async () => new Response(null, { status: 400 }),
				) as typeof fetch,
			},
			{ limit: 10 },
		);
		const deadLetters = await invokeWebhookDlqListOperation(context, {});
		const deliveryId = deadLetters.deliveries[0]?.id;
		expect(deliveryId).toBeDefined();

		const before = "2030-01-01T00:00:00.000Z";
		const preview = await invokeWebhookPruneOperation(context, {
			before,
			limit: 10,
			dry_run: true,
		});
		expect(preview).toMatchObject({
			eligible: 1,
			deleted: 0,
			dry_run: true,
			before,
		});
		expect(preview.ids).toEqual([deliveryId]);

		const deleted = await invokeWebhookPruneOperation(context, {
			before,
			ids: preview.ids,
			dry_run: false,
		});
		expect(deleted).toEqual({
			eligible: 1,
			deleted: 1,
			dry_run: false,
			before,
			ids: [deliveryId],
		});

		const retried = await invokeWebhookPruneOperation(context, {
			before,
			ids: preview.ids,
			dry_run: false,
		});
		expect(retried).toEqual({
			eligible: 0,
			deleted: 0,
			dry_run: false,
			before,
			ids: [],
		});

		await expect(
			invokeWebhookPruneOperation(context, {
				before,
				dry_run: false,
			}),
		).rejects.toThrow(/ids/);
		expect(endpoint.endpoint.enabled).toBe(true);
	});

	test("creates, filters, updates, and deletes endpoints through named invokers", async () => {
		const context = await createContext();
		const created = await invokeWebhookCreateOperation(context, {
			name: "primary",
			url: "https://8.8.8.8/hooks",
			secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PRIMARY",
			event_filters: ["operation.*"],
		});
		const id = created.endpoint.id;
		expect(created.endpoint).toMatchObject({
			name: "primary",
			url_origin: "https://8.8.8.8",
			secret_reference_configured: true,
			enabled: true,
		});
		expect(created.endpoint.url_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(created.endpoint).not.toHaveProperty("url");
		expect(created.endpoint).not.toHaveProperty("secret_ref");
		expect(created.endpoint).not.toHaveProperty("secret");

		expect(await invokeWebhookListOperation(context, {})).toMatchObject({
			endpoints: [
				{
					id,
					url_fingerprint: created.endpoint.url_fingerprint,
				},
			],
		});
		expect(
			await invokeWebhookListOperation(context, { enabled: false }),
		).toEqual({ endpoints: [] });
		expect(
			await invokeWebhookUpdateOperation(context, {
				id,
				enabled: false,
				event_filters: ["campaign.*"],
			}),
		).toMatchObject({
			endpoint: { id, enabled: false, event_filters: ["campaign.*"] },
		});
		expect(await invokeWebhookDeleteOperation(context, { id })).toMatchObject({
			deleted: true,
			endpoint: { id },
		});
	});

	test("uses the canonical event filter contract at the operation boundary", async () => {
		const context = await createContext();
		await expect(
			invokeWebhookCreateOperation(context, {
				name: "invalid-filter",
				url: "https://8.8.8.8/hooks",
				secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_INVALID",
				event_filters: ["operation.started.*"],
			}),
		).rejects.toThrow("Unsupported event filter");

		const created = await invokeWebhookCreateOperation(context, {
			name: "valid-filters",
			url: "https://8.8.8.8/hooks",
			secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_VALID",
			event_filters: [" operation.started ", "operation.*", "*"],
		});
		expect(created.endpoint.event_filters).toEqual([
			"operation.started",
			"operation.*",
			"*",
		]);
		expect(await invokeWebhookListOperation(context, {})).toMatchObject({
			endpoints: [
				{
					event_filters: ["operation.started", "operation.*", "*"],
				},
			],
		});
	});

	test("sends a targeted signed test and exposes redacted delivery state", async () => {
		const context = await createContext();
		const created = await invokeWebhookCreateOperation(context, {
			name: "primary",
			url: "https://8.8.8.8/hooks",
			secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PRIMARY",
			event_filters: ["campaign.*"],
		});
		const result = await invokeWebhookTestOperation(context, {
			id: created.endpoint.id,
			correlation_id: "operator-check",
		});
		expect(result).toMatchObject({
			dispatch: {
				claimed: 1,
				succeeded: 1,
			},
		});
		expect(context.fetcher).toHaveBeenCalledTimes(1);

		const deliveries = await invokeWebhookDeliveryListOperation(context, {
			event_type: "webhook.test",
		});
		expect(deliveries).toMatchObject({
			deliveries: [
				{
					id: result.delivery_id,
					status: "succeeded",
					event: {
						id: result.event_id,
						type: "webhook.test",
						correlation_id_present: true,
						subject: {
							kind: "webhook",
							key_redacted: true,
						},
					},
					last_error_present: false,
				},
			],
		});
		expect(deliveries.deliveries[0]?.event).not.toHaveProperty("data");
		expect(deliveries.deliveries[0]?.event).not.toHaveProperty("correlation_id");
		expect(deliveries.deliveries[0]?.event.subject).not.toHaveProperty("key");
		expect(deliveries.deliveries[0]).not.toHaveProperty("last_error");
	});

	test("projects dispatch failures as bounded codes without secret references", async () => {
		const baseContext = await createContext();
		const secretReference = "LISTMONK_OPS_WEBHOOK_SECRET_PRIVATE";
		const context = {
			...baseContext,
			resolveSecret: () => undefined,
		};
		const created = await invokeWebhookCreateOperation(context, {
			name: "missing-secret",
			url: "https://8.8.8.8/hooks",
			secret_ref: secretReference,
			event_filters: ["webhook.test"],
		});
		const result = await invokeWebhookTestOperation(context, {
			id: created.endpoint.id,
		});
		expect(result.dispatch).toMatchObject({
			claimed: 1,
			retried: 1,
			results: [
				{
					status: "retry",
					error_code: "signing_secret_unavailable",
				},
			],
		});
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain(secretReference);
		expect(serialized).not.toContain('"error":');
	});

	test("dispatches by MCP name and rejects invalid update and limits", async () => {
		const context = await createContext();
		expect(
			await invokeWebhookOperationByMcpName(
				context,
				"listmonk_webhooks_list",
				{},
			),
		).toMatchObject({
			operation: { id: "webhooks.list" },
			output: { endpoints: [] },
		});
		expect(
			await invokeWebhookOperationByMcpName(context, "unknown", {}),
		).toBeUndefined();
		await expect(
			invokeWebhookUpdateOperation(context, {
				id: "03b73791-da72-43eb-89e0-b0b803081618",
			}),
		).rejects.toThrow("At least one endpoint field");
		await expect(
			invokeWebhookDispatchOperation(context, { limit: 101 }),
		).rejects.toThrow("Dispatch limit");
		await expect(
			invokeWebhookDeliveryListOperation(context, { limit: 1_001 }),
		).rejects.toThrow("Delivery list limit");
		await expect(
			invokeWebhookCreateOperation(context, {
				name: "invalid-delivery-policy",
				url: "https://8.8.8.8/hooks",
				secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PRIMARY",
				event_filters: ["operation.*"],
				timeout_ms: 99,
				max_attempts: 13,
			}),
		).rejects.toThrow();
		for (const url of [
			"http://8.8.8.8/hooks",
			"https://user:pass@8.8.8.8/hooks",
			"https://8.8.8.8/hooks?token=secret",
			"https://8.8.8.8/hooks#fragment",
		]) {
			await expect(
				invokeWebhookCreateOperation(context, {
					name: url,
					url,
					secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PRIMARY",
					event_filters: ["operation.*"],
				}),
			).rejects.toThrow();
		}
	});
});
