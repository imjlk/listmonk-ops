import { describe, expect, test } from "bun:test";
import { AbTestService } from "../src/abtest-service";
import { SimulatedMetricsCollector } from "../src/metrics";
import type { AbTest, TestResults } from "../src/types";

function makeTest(): AbTest {
	return {
		id: "test-1",
		name: "Winner adopt",
		status: "analyzing",
		variants: [
			{ id: "A", name: "A", percentage: 50, contentOverrides: {} },
			{ id: "B", name: "B", percentage: 50, contentOverrides: {} },
		],
		campaignId: "campaign-1",
		baseConfig: { subject: "s", body: "b", lists: [1] },
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 10,
		holdoutGroupSize: 90,
		holdoutListId: 55,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		startedAt: "2026-07-01T00:00:00Z",
		endsAt: "2026-07-23T00:00:00Z",
		campaignMappings: [
			{ variantId: "A", campaignId: 100 },
			{ variantId: "B", campaignId: 101 },
		],
		testListMappings: [],
		metrics: [],
		createdAt: new Date("2026-07-01T00:00:00Z"),
		updatedAt: new Date("2026-07-23T00:00:00Z"),
	} as unknown as AbTest;
}

// A decisive A/B split that passes the fixed-horizon gate at n=1000.
function decisiveResults(): TestResults[] {
	return [
		{
			variantId: "A",
			sampleSize: 1000,
			opens: 500,
			clicks: 50,
			conversions: 150,
			openRate: 50,
			clickRate: 5,
			conversionRate: 15,
		},
		{
			variantId: "B",
			sampleSize: 1000,
			opens: 100,
			clicks: 10,
			conversions: 5,
			openRate: 10,
			clickRate: 1,
			conversionRate: 0.5,
		},
	];
}

type IntegrationLike = {
	findCampaignsByTestTag: (
		testId: string,
	) => Promise<Array<{ id: number; tags: string[] }>>;
	deployWinnerToHoldout: (
		winner: unknown,
		holdoutListId: number,
		baseConfig: unknown,
		testId: string,
	) => Promise<number>;
	autoDeployWinner: (campaignId: number) => Promise<void>;
};

function integrationWith(
	tagged: Array<{ id: number; tags: string[] }>,
	onCreate: () => number,
): IntegrationLike {
	return {
		findCampaignsByTestTag: async () => tagged,
		deployWinnerToHoldout: async () => onCreate(),
		autoDeployWinner: async () => {},
	};
}

describe("abtest deploy-winner tag adoption", () => {
	test("adopts an already-deployed winner campaign instead of duplicating", async () => {
		let creates = 0;
		const integration = integrationWith(
			[
				{
					id: 777,
					tags: [
						"abtest:test-1",
						"variant:A",
						"winner:deployed",
						"holdout:group",
					],
				},
			],
			() => {
				creates += 1;
				return 900 + creates;
			},
		);
		const service = new AbTestService(
			integration as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		await service.hydrateTests([makeTest()]);

		await service.deployWinner("test-1");

		expect(creates).toBe(0);
		const persisted = await service.getTest("test-1");
		expect(persisted?.winnerCampaignId).toBe(777);
		expect(persisted?.status).toBe("completed");
	});

	test("creates a winner campaign when none is tagged", async () => {
		let creates = 0;
		const integration = integrationWith([], () => {
			creates += 1;
			return 512;
		});
		const service = new AbTestService(
			integration as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		await service.hydrateTests([makeTest()]);

		await service.deployWinner("test-1");

		expect(creates).toBe(1);
		const persisted = await service.getTest("test-1");
		expect(persisted?.winnerCampaignId).toBe(512);
		expect(persisted?.status).toBe("completed");
	});
});
