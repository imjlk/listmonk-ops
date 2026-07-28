import { describe, expect, test } from "bun:test";
import {
	campaignOperationCatalog,
	composeOperationCatalogs,
	controlCapabilitiesOperation,
	discoveryOperationCatalog,
	invokeControlCapabilitiesOperation,
	invokeControlPrimeOperation,
	invokeControlStatusOperation,
	invokePlaybookGetOperation,
	invokePlaybookListOperation,
	invokeSpecDescribeOperation,
	invokeSpecSearchOperation,
	listOperationCatalog,
	subscriberOperationCatalog,
} from "../src";

const catalog = composeOperationCatalogs([
	listOperationCatalog,
	subscriberOperationCatalog,
	campaignOperationCatalog,
	discoveryOperationCatalog,
]);

const context = { catalog };

describe("agent discovery operations", () => {
	test("searches by intent and exposes agent safety guidance", async () => {
		const result = await invokeSpecSearchOperation(context, {
			query: "schedule campaign",
			limit: 5,
		});

		expect(result.total).toBeGreaterThan(0);
		expect(result.results[0]).toMatchObject({
			id: "campaigns.schedule",
			coverage: "described",
			resource: "campaign",
			verb: "schedule",
			safety: {
				read_only: false,
				destructive: true,
				confirmation_required: true,
				audit_required: true,
			},
		});
		expect(result.results[0]?.use_when.length).toBeGreaterThan(0);
	});

	test("describes operations by ID or MCP name, including migration coverage", async () => {
		const described = await invokeSpecDescribeOperation(context, {
			operation: "listmonk_schedule_campaign",
		});
		expect(described.operation).not.toHaveProperty("score");
		expect(described.operation).toMatchObject({
			id: "campaigns.schedule",
			coverage: "described",
			spec: {
				retry: {
					kind: "reconcile",
					reconcileWith: "campaigns.get",
				},
			},
		});

		const migration = await invokeSpecDescribeOperation(context, {
			operation: "lists.list",
		});
		expect(migration.operation).toMatchObject({
			coverage: "migration",
			migration: {
				operationId: "lists.list",
			},
		});

		await expect(
			invokeSpecDescribeOperation(context, { operation: "missing.operation" }),
		).rejects.toThrow("Unknown operation");
	});

	test("returns typed playbooks with their referenced operations", async () => {
		const listed = await invokePlaybookListOperation(context, {});
		expect(listed.playbooks).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "campaign.safe-start",
					step_count: 4,
				}),
			]),
		);

		const result = await invokePlaybookGetOperation(context, {
			id: "campaign.safe-start",
		});
		expect(result.operations.map(({ operation }) => operation.id)).toEqual([
			"campaigns.get",
			"ops.campaign.preflight",
			"campaigns.start",
			"campaigns.get",
		]);
		expect(result.operations[2]?.approval).toBe("human");
	});

	test("summarizes capabilities and primes an agent without live credentials", async () => {
		const capabilities = await invokeControlCapabilitiesOperation(context, {});
		expect(capabilities.operations).toBe(catalog.entries.length);
		expect(capabilities.families).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "discovery",
					operations: 7,
					described: 7,
				}),
			]),
		);

		const prime = await invokeControlPrimeOperation(context, {
			goal: "schedule campaign",
			limit: 1,
		});
		expect(prime.recommended_operations[0]?.id).toBe("campaigns.schedule");
		expect(prime.recommended_playbooks).toHaveLength(1);
		expect(prime.guidance).toEqual(
			expect.arrayContaining([
				expect.stringContaining("control.status"),
				expect.stringContaining("confirmation"),
			]),
		);
	});

	test("reports runtime and live readiness while keeping health failures structured", async () => {
		const ready = await invokeControlStatusOperation(
			{
				...context,
				surface: "cli",
				version: "test",
				runtime: { platform: "test" },
				target: { url: "http://127.0.0.1:9000/api", auth: "token" },
				probeListmonk: async () => true,
			},
			{},
		);
		expect(ready).toMatchObject({
			surface: "cli",
			listmonk: { configured: true, reachable: true },
			readiness: { catalog: true, specs: true, listmonk: true },
		});

		const unavailable = await invokeControlStatusOperation(
			{
				...context,
				surface: "mcp",
				version: "test",
				runtime: { node: "test" },
				probeListmonk: async () => {
					throw new Error("connection refused");
				},
			},
			{},
		);
		expect(unavailable.listmonk).toEqual({
			configured: true,
			reachable: false,
			health_error: "connection refused",
		});
	});

	test("publishes object schemas and read-only MCP metadata", () => {
		expect(controlCapabilitiesOperation.inputJsonSchema.type).toBe("object");
		expect(controlCapabilitiesOperation.outputJsonSchema.type).toBe("object");
		expect(controlCapabilitiesOperation.safety).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		});
	});
});
