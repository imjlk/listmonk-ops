import { beforeEach, describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { AbTestService } from "../src/abtest-service";
import {
	ListmonkAbTestIntegration,
	type ProvisionedAbTestResources,
} from "../src/listmonk-integration";
import type { AbTest, AbTestConfig } from "../src/types";

function createTestConfig(): AbTestConfig {
	return {
		name: "Provisioning Test",
		campaignId: "campaign-1",
		variants: [
			{
				name: "A",
				percentage: 50,
				contentOverrides: {
					subject: "A subject",
					body: "A body",
				},
			},
			{
				name: "B",
				percentage: 50,
				contentOverrides: {
					subject: "B subject",
					body: "B body",
				},
			},
		],
		metrics: [
			{ name: "Open Rate", type: "open_rate" },
			{ name: "Click Rate", type: "click_rate" },
		],
		baseConfig: {
			subject: "Base subject",
			body: "Base body",
			lists: [1],
		},
		testingMode: "holdout",
		testGroupPercentage: 10,
	};
}

function createAbTestFixture(): AbTest {
	const now = new Date();

	return {
		id: "test_fixture",
		name: "Fixture",
		campaignId: "campaign-1",
		variants: [
			{
				id: "variant-a",
				name: "A",
				percentage: 50,
				contentOverrides: {},
			},
			{
				id: "variant-b",
				name: "B",
				percentage: 50,
				contentOverrides: {},
			},
		],
		metrics: [],
		status: "draft",
		createdAt: now,
		updatedAt: now,
		baseConfig: {
			subject: "Base subject",
			body: "Base body",
			lists: [1],
		},
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 0,
		holdoutGroupSize: 0,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [],
		testListMappings: [],
	};
}

describe("A/B test provisioning", () => {
	beforeEach(() => {
		process.env.LISTMONK_OPS_ABTEST_SILENT = "1";
	});

	test("createTestCampaigns rolls back previously created campaigns on partial failure", async () => {
		const deletedCampaigns: number[] = [];
		let createCount = 0;

		const client = {
			campaign: {
				create: async () => {
					createCount += 1;
					if (createCount === 1) {
						return { data: { id: 101 } };
					}
					return { error: "second campaign failed" };
				},
				delete: async ({ path }: { path: { id: number } }) => {
					deletedCampaigns.push(path.id);
					return { data: true };
				},
			},
		} as unknown as ListmonkClient;

		const integration = new ListmonkAbTestIntegration(client);

		await expect(
			integration.createTestCampaigns(createAbTestFixture(), {
				subject: "Base subject",
				body: "Base body",
				lists: [1],
			}),
		).rejects.toThrow(
			"Failed to create campaign for variant B: second campaign failed",
		);
		expect(deletedCampaigns).toEqual([101]);
	});

	test("createTest rejects and does not keep failed provisioning in memory", async () => {
		let rollbackResources: ProvisionedAbTestResources | undefined;

		const integration = {
			getTotalSubscribers: async () => 1000,
			createTestCampaigns: async () => [
				{ variantId: "variant-a", campaignId: 201 },
				{ variantId: "variant-b", campaignId: 202 },
			],
			segmentSubscribersForHoldout: async () => {
				throw new Error("segmentation failed");
			},
			rollbackProvisioning: async (resources: ProvisionedAbTestResources) => {
				rollbackResources = resources;
			},
		} as unknown as ListmonkAbTestIntegration;

		const service = new AbTestService(integration);

		await expect(service.createTest(createTestConfig())).rejects.toThrow(
			"segmentation failed",
		);

		expect(rollbackResources).toBeDefined();
		expect(rollbackResources?.campaignIds).toEqual([201, 202]);
		expect(rollbackResources?.testListIds).toEqual([]);
		expect(rollbackResources?.holdoutListId).toBeUndefined();
		expect(rollbackResources?.testId).toContain("test_");
		await expect(service.getAllTests()).resolves.toHaveLength(0);
	});
});
