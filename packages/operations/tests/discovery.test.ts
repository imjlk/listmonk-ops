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

	test("describes every public operation by ID or MCP name", async () => {
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

		const stableDiscovery = await invokeSpecDescribeOperation(context, {
			operation: "specs.search",
		});
		expect(stableDiscovery.operation).toMatchObject({
			id: "specs.search",
			stability: "stable",
		});

		const standalone = await invokeSpecDescribeOperation(context, {
			operation: "listmonk_create_subscriber",
		});
		expect(standalone.operation).toMatchObject({
			coverage: "described",
			stability: "stable",
			spec: {
				resource: "subscriber",
				contract: {
					input: { source: "typescript" },
					output: { source: "typescript" },
				},
			},
		});
		expect(standalone.operation).not.toHaveProperty("migration");

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
		expect(result.playbook).toHaveProperty("recovery_operation");
		expect(result.playbook).not.toHaveProperty("recoveryOperation");
		expect(result.playbook.steps[1]).toHaveProperty("depends_on");

		const specOnly = await invokePlaybookGetOperation(
			{ catalog: composeOperationCatalogs([discoveryOperationCatalog]) },
			{ id: "campaign.safe-start" },
		);
		expect(
			specOnly.operations.find(
				({ operation }) => operation.id === "campaigns.start",
			)?.operation.safety,
		).toMatchObject({
			destructive: true,
			confirmation_required: true,
		});
	});

	test("summarizes capabilities and primes an agent without live credentials", async () => {
		const capabilities = await invokeControlCapabilitiesOperation(context, {});
		expect(capabilities.operations).toBe(catalog.entries.length);
		expect(capabilities.families).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "discovery",
					operations: 8,
					described: 8,
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

		const defaultPrime = await invokeControlPrimeOperation(context, {
			limit: 3,
		});
		expect(
			defaultPrime.recommended_operations.map(({ id }) => id),
		).toEqual(["control.status", "specs.search", "playbooks.list"]);
	});

	test("reports runtime and live readiness while keeping health failures structured", async () => {
		const ready = await invokeControlStatusOperation(
			{
				...context,
				surface: "cli",
				version: "test",
				runtime: { platform: "test" },
				target: { url: "http://127.0.0.1:9000/api", auth: "token" },
				probeReadiness: async () => ({
					connectivity: "reachable", health: { state: "ok" }, authentication: { state: "ok" }, permissions: [],
				}),
			},
			{},
		);
		expect(ready).toMatchObject({
			surface: "cli",
			listmonk: { configured: true, reachable: true },
			readiness: { catalog: true, specs: true, listmonk: true },
		});

		const sanitized = await invokeControlStatusOperation(
			{
				...context,
				surface: "cli",
				version: "test",
				runtime: { platform: "test" },
				target: {
					url: "https://inline-user:inline-password@example.com/api",
					auth: "token",
				},
			},
			{},
		);
		expect(sanitized.target).toEqual({
			url: "https://example.com/api",
			auth: "token",
		});

		const invalidTarget = await invokeControlStatusOperation(
			{
				...context,
				surface: "cli",
				version: "test",
				runtime: { platform: "test" },
				target: {
					url: "https://inline-user:inline-password@invalid host",
					auth: "token",
				},
			},
			{},
		);
		expect(invalidTarget.target).toEqual({
			url: "[invalid URL]",
			auth: "token",
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
		expect(unavailable.listmonk).toMatchObject({
			configured: false,
			reachable: false,
			health_error: "Listmonk readiness probe failed",
		});

		const probeOnly = await invokeControlStatusOperation(
			{
				...context,
				surface: "mcp",
				version: "test",
				runtime: { node: "test" },
				probeListmonk: async () => true,
			},
			{},
		);
		expect(probeOnly).toMatchObject({
			listmonk: {
				configured: false,
				reachable: true,
			},
			readiness: {
				listmonk: false,
			},
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

describe("status readiness policy", () => {
	const statusContext = { ...context, surface: "cli" as const, version: "test", runtime: {}, target: { url: "https://example.test/api", auth: "token" as const } };
	test("does not infer authentication from a legacy public health probe", async () => {
		const status = await invokeControlStatusOperation({ ...statusContext, probeListmonk: async () => true }, {});
		expect(status.listmonk.reachable).toBe(true);
		expect(status.listmonk.authentication.state).toBe("not_checked");
		expect(status.readiness.listmonk).toBe(false);
	});
	test("requires affirmative access for every selected collection", async () => {
		for (const state of ["ok", "denied", "unavailable", "not_checked"] as const) {
			const status = await invokeControlStatusOperation({
				...statusContext,
				probeReadiness: async (resources) => ({
					connectivity: "reachable", health: { state: "ok" }, authentication: { state: "ok" },
					permissions: resources.map((resource) => ({ resource, state })),
				}),
			}, { permissions: ["subscribers"] });
			expect(status.listmonk.authentication.state).toBe("ok");
			expect(status.readiness.listmonk).toBe(state === "ok");
		}
	});
	test("sanitizes URL query credentials and rejects unsupported checks before probing", async () => {
		const status = await invokeControlStatusOperation({ ...statusContext, target: { url: "https://user:secret@example.test/api?token=secret#secret", auth: "token" } }, {});
		expect(status.target?.url).toBe("https://example.test/api");
		let called = false;
		await expect(invokeControlStatusOperation({ ...statusContext, probeListmonk: async () => { called = true; return true; } }, { permissions: ["../settings"] })).rejects.toThrow();
		expect(called).toBe(false);
	});
});
