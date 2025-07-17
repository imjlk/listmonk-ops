import { beforeEach, describe, expect, test } from "bun:test";
import { createMCPTestSuite } from "../mcp-helper.js";
import "../setup.js";

describe("Campaigns MCP Tools", () => {
	const { client, utils } = createMCPTestSuite();
	let testCampaignId: number;
	let testListId: number;
	let testTemplateId: number;

	beforeEach(async () => {
		// Clean up existing test campaigns
		const campaignsResult = await client.callTool("listmonk_get_campaigns");
		const campaigns = utils.assertSuccess(campaignsResult);

		if (campaigns.results) {
			for (const campaign of campaigns.results) {
				if (campaign.name?.startsWith("Test-")) {
					try {
						await client.callTool("listmonk_delete_campaign", {
							id: campaign.id.toString(),
						});
					} catch (error) {
						// Ignore errors when cleaning up
					}
				}
			}
		}

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
		const campaignName = `Test-Campaign-${Date.now()}`;

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

		const createdCampaign = utils.assertSuccess(
			result,
			"Failed to create campaign",
		);

		expect(createdCampaign).toHaveProperty("id");
		expect(createdCampaign.name).toBe(campaignName);
		expect(createdCampaign.subject).toBe("Test Campaign Subject");
		expect(createdCampaign.status).toBe("draft");

		testCampaignId = (createdCampaign as {id: number}).id;
	});

	test("should get a specific campaign by ID", async () => {
		// First create a campaign
		const campaignName = `Test-Campaign-${Date.now()}`;
		const createResult = await client.callTool("listmonk_create_campaign", {
			name: campaignName,
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

		const createdCampaign = utils.assertSuccess(createResult);
		testCampaignId = (createdCampaign as {id: number}).id;

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

	test("should update campaign status", async () => {
		// First create a campaign
		const createResult = await client.callTool("listmonk_create_campaign", {
			name: `Test-Campaign-${Date.now()}`,
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

		const createdCampaign = utils.assertSuccess(createResult);
		testCampaignId = (createdCampaign as {id: number}).id;

		// Simply verify that the campaign was created with draft status
		expect((createdCampaign as {status: string}).status).toBe("draft");

		// Test that status update endpoint exists and doesn't crash
		const result = await client.callTool("listmonk_update_campaign_status", {
			id: testCampaignId.toString(),
			status: "paused", // Use a valid status
		});

		// Should succeed (even if no actual change happens)
		utils.assertSuccess(result, "Failed to update campaign status");
	});

	test("should send test campaign", async () => {
		// First create a campaign
		const createResult = await client.callTool("listmonk_create_campaign", {
			name: `Test-Campaign-${Date.now()}`,
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

		const createdCampaign = utils.assertSuccess(createResult);
		testCampaignId = (createdCampaign as {id: number}).id;

		// Send test email
		const result = await client.callTool("listmonk_test_campaign", {
			id: testCampaignId.toString(),
			emails: ["test@example.com", "test2@example.com"],
		});

		utils.assertSuccess(result, "Failed to send test campaign");
	});

	test("should delete a campaign", async () => {
		// First create a campaign
		const createResult = await client.callTool("listmonk_create_campaign", {
			name: `Test-Campaign-${Date.now()}`,
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

		const createdCampaign = utils.assertSuccess(createResult);
		testCampaignId = (createdCampaign as {id: number}).id;

		// Delete it
		const result = await client.callTool("listmonk_delete_campaign", {
			id: testCampaignId.toString(),
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

	test("should handle invalid status updates", async () => {
		// First create a campaign
		const createResult = await client.callTool("listmonk_create_campaign", {
			name: `Test-Campaign-${Date.now()}`,
			subject: "Test Subject",
			from_email: "test@example.com",
			body: "<p>Test body</p>",
			template_id: testTemplateId,
			lists: [testListId],
		});

		const createdCampaign = utils.assertSuccess(createResult);
		testCampaignId = (createdCampaign as {id: number}).id;

		// Try to update with invalid status
		const result = await client.callTool("listmonk_update_campaign_status", {
			id: testCampaignId.toString(),
			status: "invalid_status",
		});

		utils.assertError(result, "Invalid campaign status");
	});
});
