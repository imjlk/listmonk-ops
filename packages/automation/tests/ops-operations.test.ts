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
	templateRegistrySyncOperation,
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
		expect(deliverabilityGuardOperation.safety).toMatchObject({
			destructiveHint: true,
			idempotentHint: true,
		});
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
		expect(
			templateRegistrySyncOperation.inputSchema.parse({ template_id: "7" }),
		).toEqual({ template_id: 7 });
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
				preview: async () => ({ data: '<p>Campaign</p><a href="https://newsletter.test/subscription/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000">Leave list</a>' }),
				getById: async () => ({
					data: {
						id: 42,
						name: "Welcome",
						updated_at: "2026-01-01T00:00:00Z",
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

	test("round-trips Listmonk offset timestamps through hygiene guards", async () => {
		// Listmonk serializes updated_at with the database session's offset;
		// a non-UTC Postgres yields +09:00, and JSON rows yield +00:00.
		for (const updatedAt of [
			"2020-01-01T09:00:00.123456+09:00",
			"2020-01-01T00:00:00.123456+00:00",
			"2020-01-01T00:00:00.123456Z",
		]) {
			const blocklisted: number[] = [];
			const client = {
				subscriber: {
					list: async () => ({
						data: {
							results: [
								{
									id: 7,
									email: "offset@example.com",
									status: "enabled",
									updated_at: updatedAt,
									lists: [{ id: 1, subscription_status: "confirmed" }],
								},
							],
						},
					}),
					manageBlocklistById: async ({ path }: { path: { id: number } }) => {
						blocklisted.push(path.id);
						return { data: true };
					},
				},
			} as unknown as ListmonkClient;

			const preview = await invokeSubscriberHygieneOperation(
				{ client },
				{ mode: "sunset", blocklist: true },
			);
			expect(preview.subscriberUpdatedAt).toEqual([updatedAt]);
			expect(preview.failedSubscribers).toBe(0);

			const applied = await invokeSubscriberHygieneOperation(
				{ client },
				{
					mode: "sunset",
					blocklist: true,
					dry_run: false,
					subscriber_ids: preview.subscriberIds,
					subscriber_guards: [
						{
							subscriber_id: 7,
							expected_updated_at: preview.subscriberUpdatedAt[0],
						},
					],
				},
			);
			expect(applied.processedSubscribers).toBe(1);
			expect(applied.skippedGuarded).toBe(0);
			expect(blocklisted).toEqual([7]);
		}

		await expect(
			invokeSubscriberHygieneOperation(context, {
				mode: "sunset",
				blocklist: true,
				dry_run: false,
				subscriber_ids: [7],
				subscriber_guards: [
					{ subscriber_id: 7, expected_updated_at: "2020-01-01 00:00:00" },
				],
			}),
		).rejects.toThrow();
	});
});
