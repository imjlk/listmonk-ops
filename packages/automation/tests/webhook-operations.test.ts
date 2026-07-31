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
		expect(await invokeWebhookDlqListOperation(context, {})).toMatchObject({
			deliveries: [{ status: "exhausted" }],
		});
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
			secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PRIMARY",
			enabled: true,
		});
		expect(created.endpoint).not.toHaveProperty("secret");

		expect(await invokeWebhookListOperation(context, {})).toMatchObject({
			endpoints: [{ id }],
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
						correlation_id: "operator-check",
					},
				},
			],
		});
		expect(deliveries.deliveries[0]?.event).not.toHaveProperty("data");
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
