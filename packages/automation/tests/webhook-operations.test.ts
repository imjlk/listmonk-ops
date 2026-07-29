import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	invokeWebhookCreateOperation,
	invokeWebhookDeleteOperation,
	invokeWebhookDeliveryListOperation,
	invokeWebhookDispatchOperation,
	invokeWebhookListOperation,
	invokeWebhookOperationByMcpName,
	invokeWebhookPruneOperation,
	invokeWebhookReconcileOperation,
	invokeWebhookTestOperation,
	invokeWebhookTickOperation,
	invokeWebhookUpdateOperation,
	webhookOperationCatalog,
	webhookOperations,
} from "../src/webhook-operations";

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

	test("runs typed reconcile, prune preview, and worker tick operations", async () => {
		const context = await createContext();
		expect(
			await invokeWebhookReconcileOperation(context, {
				limit: 10,
				dry_run: true,
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
