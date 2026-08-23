import { beforeEach, describe, expect, test } from "bun:test";
import { createMCPTestSuite } from "../mcp-helper.js";
import { buildTestEmail, buildTestName } from "../setup.js";

describe("Campaigns MCP Tools", () => {
	const { client, utils } = createMCPTestSuite();
	let testCampaignId: number;
	let testListId: number;
	let testTemplateId: number;

	beforeEach(async () => {
		// Create test dependencies
		const testList = await utils.createTestList();
		testListId = testList.id;

		// Use default template (ID 1) instead of creating a new one
		testTemplateId = 1;
	});

	test("should list all campaigns", async () => {
		const result = await client.callTool("listmonk_get_campaigns", {
			page: 1,
			per_page: 10,
		});

		const data = utils.assertSuccess(result, "Failed to get campaigns");
		expect(data).toHaveProperty("results");
		expect(Array.isArray(data.results)).toBe(true);
	});

	test("should filter campaigns by status", async () => {
		const result = await client.callTool("listmonk_get_campaigns", {
			page: 1,
			per_page: 10,
			status: "draft",
		});

		const data = utils.assertSuccess(
			result,
			"Failed to filter campaigns by status",
		);
		expect(data).toHaveProperty("results");

		// All returned campaigns should have draft status
		if (data.results && data.results.length > 0) {
			for (const campaign of data.results) {
				expect(campaign.status).toBe("draft");
			}
		}
	});

	test("should create a new campaign", async () => {
		const campaignName = buildTestName("campaign");

		const result = await client.callTool("listmonk_create_campaign", {
			name: campaignName,
			subject: "Test Campaign Subject",
			from_email: "test@example.com",
			body: "<h1>Test Campaign</h1><p>This is a test campaign.</p>",
			type: "regular",
			template_id: testTemplateId,
			lists: [testListId],
			tags: ["test", "e2e"],
		});

		const createdCampaign = utils.assertSuccess<{
			campaign?: {
				id?: number;
				name?: string;
				subject?: string;
				status?: string;
			};
			created?: boolean;
		}>(result, "Failed to create campaign");

		expect(createdCampaign.created).toBe(true);
		expect(createdCampaign.campaign).toHaveProperty("id");
		expect(createdCampaign.campaign?.name).toBe(campaignName);
		expect(createdCampaign.campaign?.subject).toBe("Test Campaign Subject");
		expect(createdCampaign.campaign?.status).toBe("draft");

		testCampaignId = createdCampaign.campaign?.id ?? 0;
	});

	test("should get a specific campaign by ID", async () => {
		// First create a campaign
		const campaignName = buildTestName("campaign");
		const createResult = await client.callTool("listmonk_create_campaign", {
			name: campaignName,
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

		const createdCampaign = utils.assertSuccess<{ campaign?: { id?: number } }>(
			createResult,
		);
		testCampaignId = createdCampaign.campaign?.id ?? 0;
		expect(testCampaignId).toBeGreaterThan(0);

		// Then get it by ID
		const result = await client.callTool("listmonk_get_campaign", {
			id: testCampaignId.toString(),
		});

		const retrievedCampaign = utils.assertSuccess(
			result,
			"Failed to get campaign by ID",
		);

		expect(retrievedCampaign.id).toBe(testCampaignId);
		expect(retrievedCampaign.name).toBe(campaignName);
	});

	test("should replay an identical keyed clone without duplicating", async () => {
		// Create the clone source inside the test so the case also runs when
		// the suite is selected independently.
		const sourceName = buildTestName("keyed-clone-source");
		const sourceCreate = utils.assertSuccess<{ campaign?: { id?: number } }>(
			await client.callTool("listmonk_create_campaign", {
				name: sourceName,
				subject: "Keyed clone source",
				from_email: "ops@example.com",
				body: "<p>Keyed clone source</p>",
				template_id: testTemplateId,
				lists: [testListId],
			}),
			"Failed to create the clone source",
		);
		const sourceId = sourceCreate.campaign?.id ?? 0;
		expect(sourceId).toBeGreaterThan(0);
		const cloneName = buildTestName("keyed-clone");
		const idempotencyKey = `e2e:${cloneName}`;
		const request = {
			id: sourceId,
			name: cloneName,
			idempotency_key: idempotencyKey,
		};

		const first = utils.assertSuccess<{
			campaign?: { id?: number };
			created?: boolean;
		}>(
			await client.callTool("listmonk_clone_campaign", request),
			"Failed to run the first keyed clone",
		);
		expect(first.created).toBe(true);
		expect(first.campaign?.id).toBeGreaterThan(0);
		expect(first.campaign?.id).not.toBe(sourceId);

		const retried = utils.assertSuccess<{
			campaign?: { id?: number };
			created?: boolean;
		}>(
			await client.callTool("listmonk_clone_campaign", request),
			"Failed to replay the keyed clone",
		);
		expect(retried.created).toBe(false);
		expect(retried.campaign?.id).toBe(first.campaign?.id);

		// A different request under the same key is rejected.
		const conflicting = await client.callTool("listmonk_clone_campaign", {
			...request,
			name: `${cloneName}-conflict`,
		});
		utils.assertError(conflicting, "different create request");

		// Clean up the clone and the source.
		await client.callTool("listmonk_delete_campaign", {
			id: String(first.campaign?.id),
			confirm: true,
		});
		await client.callTool("listmonk_delete_campaign", {
			id: String(sourceId),
			confirm: true,
		});
	});

	test("should replay an identical keyed create without duplicating", async () => {
		const campaignName = buildTestName("keyed-campaign");
		const idempotencyKey = `e2e:${campaignName}`;
		const request = {
			name: campaignName,
			subject: "Keyed create E2E fixture",
			from_email: "ops@example.com",
			body: "<p>Keyed campaign fixture</p>",
			template_id: testTemplateId,
			lists: [testListId],
			idempotency_key: idempotencyKey,
		};

		const first = utils.assertSuccess<{
			campaign?: { id?: number };
			created?: boolean;
		}>(
			await client.callTool("listmonk_create_campaign", request),
			"Failed to run the first keyed campaign create",
		);
		expect(first.created).toBe(true);
		expect(first.campaign?.id).toBeGreaterThan(0);

		const retried = utils.assertSuccess<{
			campaign?: { id?: number };
			created?: boolean;
		}>(
			await client.callTool("listmonk_create_campaign", request),
			"Failed to replay the keyed campaign create",
		);
		expect(retried.created).toBe(false);
		expect(retried.campaign?.id).toBe(first.campaign?.id);

		// A different payload under the same key is rejected.
		const conflicting = await client.callTool("listmonk_create_campaign", {
			...request,
			name: `${campaignName}-conflict`,
		});
		utils.assertError(conflicting, "different create request");

		testCampaignId = first.campaign?.id ?? 0;
	});

	test("should send test campaign", async () => {
			// First create a campaign
			const createResult = await client.callTool("listmonk_create_campaign", {
			name: buildTestName("campaign"),
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

			const createdCampaign = utils.assertSuccess<{
				campaign?: { id?: number };
			}>(createResult);
			testCampaignId = createdCampaign.campaign?.id ?? 0;
			expect(testCampaignId).toBeGreaterThan(0);

			const testEmail = buildTestEmail("campaign-test");
			const subscriberResult = await client.callTool(
				"listmonk_create_subscriber",
				{
					email: testEmail,
					name: buildTestName("campaign-test-subscriber"),
					status: "enabled",
					lists: [testListId],
				},
			);
			utils.assertSuccess(subscriberResult, "Failed to create test subscriber");

			// Send test email
			const result = await client.callTool("listmonk_test_campaign", {
				id: testCampaignId.toString(),
				emails: [testEmail],
			});

		utils.assertSuccess(result, "Failed to send test campaign");
	});

	test("should delete a campaign", async () => {
		// First create a campaign
		const createResult = await client.callTool("listmonk_create_campaign", {
			name: buildTestName("campaign"),
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

		const createdCampaign = utils.assertSuccess<{ campaign?: { id?: number } }>(
			createResult,
		);
		testCampaignId = createdCampaign.campaign?.id ?? 0;
		expect(testCampaignId).toBeGreaterThan(0);

		// Delete it
		const result = await client.callTool("listmonk_delete_campaign", {
			id: testCampaignId.toString(),
			confirm: true,
		});

		utils.assertSuccess(result, "Failed to delete campaign");

		// Verify it's gone
		const getResult = await client.callTool("listmonk_get_campaign", {
			id: testCampaignId.toString(),
		});

		utils.assertError(getResult);
	});

	test("should handle validation errors", async () => {
		// Test missing required fields
		const result = await client.callTool("listmonk_create_campaign", {
			name: "Test Campaign",
			// Missing other required fields
		});

		utils.assertError(result, "Missing required parameter");
	});

	test("should validate required params for analytics tools", async () => {
		const runningStatsResult = await client.callTool(
			"listmonk_get_campaign_running_stats",
			{},
		);
		utils.assertError(
			runningStatsResult,
			"Missing required parameter: campaign_id",
		);

		const analyticsResult = await client.callTool(
			"listmonk_get_campaign_analytics",
			{
				type: "views",
			},
		);
		utils.assertError(analyticsResult, "Missing required parameter");
	});
});
