import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createMCPTestSuite } from "../mcp-helper.js";
import "../setup.js";

const SUFFIX = `${process.pid}-${Date.now()}`;
const SEGMENT_STORE = `/tmp/listmonk-ops-segment-${SUFFIX}.json`;
const TEMPLATE_REGISTRY_STORE = `/tmp/listmonk-ops-template-registry-${SUFFIX}.json`;
process.env.LISTMONK_OPS_SEGMENT_STORE = SEGMENT_STORE;
process.env.LISTMONK_OPS_TEMPLATE_REGISTRY = TEMPLATE_REGISTRY_STORE;

describe("Ops MCP Tools", () => {
	const { client, utils } = createMCPTestSuite();
	let campaignId: number | null = null;
	let templateId: number | null = null;

	afterAll(async () => {
		if (campaignId) {
			await client.callTool("listmonk_delete_campaign", {
				id: String(campaignId),
			});
		}
		if (templateId && templateId !== 3) {
			await client.callTool("listmonk_delete_template", {
				id: String(templateId),
			});
		}
		await rm(SEGMENT_STORE, { force: true });
		await rm(TEMPLATE_REGISTRY_STORE, { force: true });
	});

	test("should run ops workflows end-to-end", async () => {
		const stamp = Date.now();

		templateId = 3;

		const campaignCreateResult = await client.callTool(
			"listmonk_create_campaign",
			{
				name: `Ops-E2E-Campaign-${stamp}`,
				subject: `Ops E2E Campaign ${stamp}`,
				from_email: "ops@example.com",
				body: `<p>Visit https://example.com and unsubscribe here</p>`,
				template_id: 3,
				lists: [1],
				type: "regular",
			},
		);
		const createdCampaign = utils.assertSuccess<{ id: number }>(
			campaignCreateResult,
			"Failed to create campaign",
		);
		campaignId = createdCampaign.id;

		const preflightResult = await client.callTool("listmonk_ops_preflight", {
			campaign_id: String(campaignId),
			check_links: false,
		});
		const preflight = utils.assertSuccess<{
			campaignId: number;
			summary: { fail: number };
		}>(preflightResult, "Preflight tool failed");
		expect(preflight.campaignId).toBe(campaignId);
		expect(typeof preflight.summary.fail).toBe("number");

		const guardResult = await client.callTool(
			"listmonk_ops_deliverability_guard",
			{
				campaign_id: String(campaignId),
				pause_on_breach: false,
			},
		);
		const guard = utils.assertSuccess<{
			campaignId: number;
			breaches: string[];
		}>(guardResult, "Deliverability guard tool failed");
		expect(guard.campaignId).toBe(campaignId);
		expect(Array.isArray(guard.breaches)).toBe(true);

		const hygieneResult = await client.callTool(
			"listmonk_ops_subscriber_hygiene",
			{
				mode: "winback",
				dry_run: true,
				inactivity_days: 30,
				max_subscribers: 10,
			},
		);
		const hygiene = utils.assertSuccess<{ dryRun: boolean; mode: string }>(
			hygieneResult,
			"Subscriber hygiene tool failed",
		);
		expect(hygiene.dryRun).toBe(true);
		expect(hygiene.mode).toBe("winback");

		const driftResult = await client.callTool("listmonk_ops_segment_drift", {
			threshold: 0.2,
			min_absolute_change: 1,
			lookback_days: 7,
		});
		const drift = utils.assertSuccess<{ comparisons: unknown[] }>(
			driftResult,
			"Segment drift tool failed",
		);
		expect(Array.isArray(drift.comparisons)).toBe(true);

		const syncOne = await client.callTool(
			"listmonk_ops_template_registry_sync",
			{
				template_ids: [templateId],
				note: "initial snapshot",
			},
		);
		utils.assertSuccess(syncOne, "Template registry sync failed");

		const historyResult = await client.callTool(
			"listmonk_ops_template_registry_history",
			{
				template_id: String(templateId),
			},
		);
		const history = utils.assertSuccess<{
			versions: Array<{ versionId: string }>;
		}>(historyResult, "Template registry history failed");
		expect(history.versions.length).toBeGreaterThanOrEqual(1);
		const latestVersion = history.versions[history.versions.length - 1];
		expect(latestVersion).toBeDefined();

		if (latestVersion) {
			const promoteResult = await client.callTool(
				"listmonk_ops_template_registry_promote",
				{
					template_id: String(templateId),
					version_id: latestVersion.versionId,
				},
			);
			const promoted = utils.assertSuccess<{ templateId: number }>(
				promoteResult,
				"Template promote tool failed",
			);
			expect(promoted.templateId).toBe(templateId);
		}

		const digestResult = await client.callTool("listmonk_ops_daily_digest", {
			hours: 24,
		});
		const digest = utils.assertSuccess<{ markdown: string }>(
			digestResult,
			"Daily digest tool failed",
		);
		expect(digest.markdown).toContain("Listmonk Ops Daily Digest");
	});

	test("should validate required params for ops tools", async () => {
		const testCases = [
			{
				tool: "listmonk_ops_preflight",
				args: {},
				expectedError: "Missing required parameter: campaign_id",
			},
			{
				tool: "listmonk_ops_deliverability_guard",
				args: {},
				expectedError: "Missing required parameter: campaign_id",
			},
			{
				tool: "listmonk_ops_template_registry_history",
				args: {},
				expectedError: "Missing required parameter: template_id",
			},
			{
				tool: "listmonk_ops_template_registry_promote",
				args: { template_id: "1" },
				expectedError: "Missing required parameter: version_id",
			},
		];

		for (const testCase of testCases) {
			const result = await client.callTool(testCase.tool, testCase.args);
			utils.assertError(result, testCase.expectedError);
		}
	});
});
