import {
	createOutboundWebhookEndpoint,
	listOutboundWebhookDeliveries,
} from "@listmonk-ops/automation";
import { listOperationAuditEntries } from "@listmonk-ops/common";
import { OperationConfirmationRequiredError } from "@listmonk-ops/operations";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CliOperationAuditStartError,
	executeCliOperation,
	getCliOperationExecution,
	UnknownCliOperationError,
} from "../src/operation-execution";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

async function createAuditStorePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-cli-audit-"));
	tempDirectories.push(directory);
	return join(directory, "operation-audit.json");
}

describe("CLI operation execution safety", () => {
	test("resolves shared policy and preserves dry-run defaults through CLI flags", () => {
		expect(
			getCliOperationExecution("ops.subscribers.hygiene", {}),
		).toMatchObject({
			operation: { id: "ops.subscribers.hygiene" },
			policy: {
				confirmationRequired: true,
				auditRequired: true,
				dryRunSupported: true,
			},
				dryRun: true,
			});
		expect(
			getCliOperationExecution("ops.campaign.deliverability-guard", {}),
		).toMatchObject({
			operation: { id: "ops.campaign.deliverability-guard" },
			policy: {
				confirmationRequired: true,
				auditRequired: true,
				dryRunSupported: false,
			},
		});

		expect(
			getCliOperationExecution("ops.subscribers.hygiene", {
				"source-list-ids": "1,2",
				"dry-run": true,
			}),
		).toMatchObject({ dryRun: true });
		expect(() => getCliOperationExecution("missing.operation", {})).toThrow(
			UnknownCliOperationError,
		);
	});

	test("blocks an unconfirmed destructive command before invoking it", async () => {
		const auditStorePath = await createAuditStorePath();
		let invoked = false;

		await expect(
			executeCliOperation({
				operationId: "lists.delete",
				input: { id: 8 },
				invoke: async () => {
					invoked = true;
				},
				auditStoreOptions: { path: auditStorePath },
			}),
		).rejects.toThrow("Operation lists.delete requires explicit confirmation");
		expect(invoked).toBe(false);

		const entries = await listOperationAuditEntries({ path: auditStorePath });
		expect(entries.map((entry) => entry.event)).toEqual(["started", "blocked"]);
		expect(entries.every((entry) => entry.surface === "cli")).toBe(true);
		expect(entries.every((entry) => entry.confirmed === false)).toBe(true);
		expect(entries[0]?.executionId).toBe(entries[1]?.executionId);
	});

	test("records successful and failed writes without storing remote error text", async () => {
		const auditStorePath = await createAuditStorePath();
		await expect(
			executeCliOperation({
				operationId: "lists.create",
				input: { name: "CLI audit test" },
				invoke: async () => "created",
				auditStoreOptions: { path: auditStorePath },
			}),
		).resolves.toBe("created");

		await expect(
			executeCliOperation({
				operationId: "lists.create",
				input: { name: "CLI audit test" },
				invoke: async () => {
					throw new Error("remote secret failure");
				},
				auditStoreOptions: { path: auditStorePath },
			}),
		).rejects.toThrow("remote secret failure");

		const entries = await listOperationAuditEntries({ path: auditStorePath });
		expect(entries.map((entry) => entry.event)).toEqual([
			"started",
			"succeeded",
			"started",
			"failed",
		]);
		expect(JSON.stringify(entries)).not.toContain("remote secret failure");
	});

	test("projects audited execution events into the outbound webhook outbox", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "listmonk-ops-cli-lifecycle-"),
		);
		tempDirectories.push(directory);
		const auditStorePath = join(directory, "operation-audit.json");
		const webhookStorePath = join(directory, "outbound-webhooks.json");
		await createOutboundWebhookEndpoint(
			{
				name: "operations",
				url: "https://8.8.8.8/hooks",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_OPERATIONS",
				eventFilters: ["operation.*"],
			},
			{ path: webhookStorePath },
		);

		await expect(
			executeCliOperation({
				operationId: "lists.create",
				input: { name: "CLI lifecycle test" },
				invoke: async () => "created",
				auditStoreOptions: { path: auditStorePath },
				webhookStoreOptions: { path: webhookStorePath },
			}),
		).resolves.toBe("created");

		const audit = await listOperationAuditEntries({ path: auditStorePath });
		const deliveries = await listOutboundWebhookDeliveries({
			path: webhookStorePath,
		});
		expect(deliveries.map((delivery) => delivery.event.type).sort()).toEqual([
			"operation.started",
			"operation.succeeded",
		]);
		expect(
			deliveries.every(
				(delivery) =>
					delivery.event.correlationId === audit[0]?.executionId &&
					delivery.event.data.surface === "cli",
			),
		).toBe(true);
	});

	test("projects successful campaign lifecycle events from the shared CLI boundary", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "listmonk-ops-cli-domain-lifecycle-"),
		);
		tempDirectories.push(directory);
		const auditStorePath = join(directory, "operation-audit.json");
		const webhookStorePath = join(directory, "outbound-webhooks.json");
		await createOutboundWebhookEndpoint(
			{
				name: "campaigns",
				url: "https://8.8.8.8/hooks",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_CAMPAIGNS",
				eventFilters: ["campaign.*"],
			},
			{ path: webhookStorePath },
		);

		await expect(
			executeCliOperation({
				operationId: "campaigns.start",
				input: { id: 42 },
				confirmed: true,
				invoke: async () => ({ id: 42, status: "running" }),
				auditStoreOptions: { path: auditStorePath },
				webhookStoreOptions: { path: webhookStorePath },
			}),
		).resolves.toEqual({ id: 42, status: "running" });

		const audit = await listOperationAuditEntries({ path: auditStorePath });
		const deliveries = await listOutboundWebhookDeliveries({
			path: webhookStorePath,
		});
		expect(deliveries).toMatchObject([
			{
				event: {
					type: "campaign.started",
					correlationId: audit[0]?.executionId,
					subject: { kind: "campaign", key: "42" },
					data: {
						operation_id: "campaigns.start",
						status: "running",
					},
				},
			},
		]);
	});

	test("does not invoke a mutation when its started audit event cannot persist", async () => {
		const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-cli-audit-"));
		tempDirectories.push(directory);
		let invoked = false;

		await expect(
			executeCliOperation({
				operationId: "lists.delete",
				input: { id: 8 },
				confirmed: true,
				invoke: async () => {
					invoked = true;
				},
				auditStoreOptions: { path: directory },
			}),
		).rejects.toThrow(CliOperationAuditStartError);
		expect(invoked).toBe(false);
	});

	test("preserves the confirmation error when the blocked audit event fails", async () => {
		const events: string[] = [];
		const auditErrors: string[] = [];
		let invoked = false;

		await expect(
			executeCliOperation({
				operationId: "lists.delete",
				input: { id: 8 },
				invoke: async () => {
					invoked = true;
				},
				recordAudit: async (input) => {
					events.push(input.event);
					if (input.event === "blocked") {
						throw new Error("blocked audit unavailable");
					}
				},
				onAuditError: (message) => auditErrors.push(message),
			}),
		).rejects.toBeInstanceOf(OperationConfirmationRequiredError);
		expect(invoked).toBe(false);
		expect(events).toEqual(["started", "blocked"]);
		expect(auditErrors).toEqual([
			expect.stringContaining("blocked audit unavailable"),
		]);
	});

	test("preserves a remote result when its terminal audit event fails", async () => {
		const events: string[] = [];
		const auditErrors: string[] = [];

		await expect(
			executeCliOperation({
				operationId: "lists.create",
				input: { name: "CLI audit test" },
				invoke: async () => "created",
				recordAudit: async (input) => {
					events.push(input.event);
					if (input.event === "succeeded") {
						throw new Error("terminal audit unavailable");
					}
				},
				onAuditError: (message) => auditErrors.push(message),
			}),
		).resolves.toBe("created");
		expect(events).toEqual(["started", "succeeded"]);
		expect(auditErrors).toEqual([
			expect.stringContaining("terminal audit unavailable"),
		]);
	});
});
