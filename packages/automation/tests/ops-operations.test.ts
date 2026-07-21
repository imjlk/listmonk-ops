import { describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	campaignPreflightOperation,
	deliverabilityGuardOperation,
	getOpsOperationByMcpName,
	invokeCampaignPreflightOperation,
	invokeDailyDigestOperation,
	invokeDeliverabilityGuardOperation,
	invokeSegmentDriftOperation,
	invokeSubscriberHygieneOperation,
	invokeTemplateRegistryHistoryOperation,
	invokeTemplateRegistryPromoteOperation,
	invokeTemplateRegistryRollbackOperation,
	invokeTemplateRegistrySyncOperation,
	opsOperations,
	segmentDriftOperation,
	templateRegistryRollbackOperation,
} from "../src/ops-operations";

const context = { client: {} as ListmonkClient };

describe("automation operation registry", () => {
	test("exposes every ops MCP tool with shared metadata", () => {
		expect(opsOperations).toHaveLength(9);
		expect(new Set(opsOperations.map((operation) => operation.mcp.name)).size).toBe(
			9,
		);
		expect(getOpsOperationByMcpName("listmonk_ops_preflight")).toBe(
			campaignPreflightOperation,
		);
		expect(deliverabilityGuardOperation.safety.destructiveHint).toBe(true);
		expect(campaignPreflightOperation.outputJsonSchema.type).toBe("object");
		expect(segmentDriftOperation.safety.idempotentHint).toBe(false);
		expect(templateRegistryRollbackOperation.safety).toMatchObject({
			destructiveHint: true,
			idempotentHint: false,
		});
	});

	test("normalizes shared defaults and string inputs", () => {
		const parsed = campaignPreflightOperation.inputSchema.parse({
			campaign_id: "42",
		});

		expect(parsed).toEqual({
			campaign_id: 42,
			max_audience: 200_000,
			check_links: false,
			link_check_timeout_ms: 4_000,
		});
		expect(
			deliverabilityGuardOperation.inputSchema.parse({ campaign_id: "42" }),
		).toMatchObject({
			campaign_id: 42,
			bounce_threshold: 0.05,
			open_threshold: 0.08,
			click_threshold: 0.01,
			pause_on_breach: false,
		});
	});

	test("rejects unsafe threshold and boolean values", () => {
		for (const value of [1.1, null, "", false]) {
			expect(() =>
				deliverabilityGuardOperation.inputSchema.parse({
					campaign_id: 42,
					bounce_threshold: value,
				}),
			).toThrow();
		}
		expect(() =>
			deliverabilityGuardOperation.inputSchema.parse({
				campaign_id: 42,
				pause_on_breach: "sometimes",
			}),
		).toThrow();
	});

	test("keeps named invokers as direct graph anchors", async () => {
		await expect(invokeCampaignPreflightOperation(context, {})).rejects.toThrow();
		await expect(invokeDeliverabilityGuardOperation(context, {})).rejects.toThrow();
		await expect(
			invokeSubscriberHygieneOperation(context, { mode: "invalid" }),
		).rejects.toThrow();
		await expect(
			invokeSegmentDriftOperation(context, { threshold: -1 }),
		).rejects.toThrow();
		await expect(
			invokeTemplateRegistrySyncOperation(context, { template_ids: [0] }),
		).rejects.toThrow();
		await expect(invokeTemplateRegistryHistoryOperation(context, {})).rejects.toThrow();
		await expect(
			invokeTemplateRegistryPromoteOperation(context, { template_id: 1 }),
		).rejects.toThrow();
		await expect(invokeTemplateRegistryRollbackOperation(context, {})).rejects.toThrow();
		await expect(invokeDailyDigestOperation(context, { hours: 0 })).rejects.toThrow();
	});

	test("executes a preflight through the shared context", async () => {
		const client = {
			campaign: {
				getById: async () => ({
					data: {
						id: 42,
						name: "Welcome",
						status: "draft",
						subject: "Hello",
						body: "Unsubscribe",
						lists: [{ id: 7 }],
					},
				}),
			},
			list: {
				getById: async () => ({
					data: { id: 7, name: "Audience", subscriber_count: 10 },
				}),
			},
			template: {
				getById: async () => ({ data: { id: 3 } }),
			},
		} as unknown as ListmonkClient;

		const result = await invokeCampaignPreflightOperation(
			{ client },
			{ campaign_id: "42" },
		);

		expect(result.campaignId).toBe(42);
		expect(result.summary.fail).toBe(0);
	});
});
