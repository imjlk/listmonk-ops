import { describe, expect, test } from "bun:test";
import {
	AbTestService,
	resolveWinnerDeployment,
	WINNER_DEPLOYMENT_STATUSES,
} from "../src/abtest-service";
import { AbTestInvalidStatusError } from "../src/errors";
import { SimulatedMetricsCollector } from "../src/metrics";
import { lockHypothesis } from "../src/hypothesis";
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

type TaggedCampaign = { id: number; tags: string[]; status: string };

type IntegrationLike = {
	findCampaignsByTestTag: (testId: string) => Promise<TaggedCampaign[]>;
	deployWinnerToHoldout: (
		winner: unknown,
		holdoutListId: number,
		baseConfig: unknown,
		testId: string,
	) => Promise<number>;
	autoDeployWinner: (campaignId: number) => Promise<void>;
};

function integrationWith(
	tagged: Array<{ id: number; tags: string[]; status?: string }>,
	onCreate: () => number,
): IntegrationLike {
	return {
		findCampaignsByTestTag: async () =>
			tagged.map((campaign) => ({
				id: campaign.id,
				tags: campaign.tags,
				status: campaign.status ?? "running",
			})),
		deployWinnerToHoldout: async () => onCreate(),
		autoDeployWinner: async () => {},
	};
}

describe("abtest deploy-winner tag adoption", () => {
	test("waits for the pre-registered attribution tail before manual deployment", async () => {
		let creates = 0;
		const service = new AbTestService(
			integrationWith([], () => { creates += 1; return 512; }) as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		const test = makeTest();
		test.endsAt = new Date(Date.now() - 3_600_000).toISOString();
		test.hypothesis = lockHypothesis({
			objective: "Track purchases",
			hypothesis: "Variant A improves conversion",
			primaryMetric: { type: "conversion_rate", direction: "maximize" },
			expectedLift: { kind: "relative", value: 0.1 },
			owner: { id: "operator" },
			experimentScope: {
				channel: "email",
				experimentFamilyKey: "conversion.test",
				attributionWindowHours: 24,
				exclusionWindowHours: 48,
			},
			createdAt: test.startedAt!,
		}, test.startedAt!);
		await service.hydrateTests([test]);

		await expect(service.deployWinner(test.id)).rejects.toThrow("attribution window");
		expect(creates).toBe(0);
		expect((await service.getTest(test.id))?.status).toBe("analyzing");
	});

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

	test("finishes a configured auto-launch the first attempt could not", async () => {
		const test = { ...makeTest(), autoDeployWinner: true };
		let created: number | undefined;
		let campaignStatus = "draft";
		const launches: number[] = [];
		let launchAttempts = 0;
		const integration: IntegrationLike = {
			findCampaignsByTestTag: async () =>
				created === undefined
					? []
					: [
							{
								id: created,
								tags: [
									"abtest:test-1",
									"variant:A",
									"winner:deployed",
									"holdout:group",
								],
								status: campaignStatus,
							},
						],
			deployWinnerToHoldout: async () => {
				created = 640;
				return created;
			},
			autoDeployWinner: async (campaignId) => {
				launchAttempts += 1;
				if (launchAttempts === 1) {
					throw new Error("launch endpoint unavailable");
				}
				launches.push(campaignId);
				campaignStatus = "running";
			},
		};
		const service = new AbTestService(
			integration as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		await service.hydrateTests([test]);

		// First attempt: campaign creation and tagging succeed, the launch
		// fails, so the test must stay analyzing instead of completing.
		await expect(service.deployWinner("test-1")).rejects.toThrow(
			/launch endpoint unavailable/,
		);
		const afterFailure = await service.getTest("test-1");
		expect(afterFailure?.status).toBe("analyzing");
		expect(afterFailure?.winnerCampaignId).toBeUndefined();

		// Retry: adoption finds the tagged draft and must launch it before
		// completing the test.
		await service.deployWinner("test-1");

		expect(launches).toEqual([640]);
		const persisted = await service.getTest("test-1");
		expect(persisted?.winnerCampaignId).toBe(640);
		expect(persisted?.status).toBe("completed");
	});

	test("rejects adoption when the deployed campaign carries another variant", async () => {
		const integration = integrationWith([
			{
				id: 771,
				tags: [
					"abtest:test-1",
					"variant:B",
					"winner:deployed",
					"holdout:group",
				],
			},
		]);
		const service = new AbTestService(
			integration as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		await service.hydrateTests([makeTest()]);

		// The decisive results select variant A; a campaign that already
		// delivered variant B must not be recorded as A's deployment.
		await expect(service.deployWinner("test-1")).rejects.toThrow(
			/deployed variant B, but the current analysis selected variant A/,
		);
		const afterRejection = await service.getTest("test-1");
		expect(afterRejection?.status).toBe("analyzing");
		expect(afterRejection?.winnerCampaignId).toBeUndefined();
	});

	test("rejects adoption when the deployed campaign has ambiguous variant tags", async () => {
		const integration = integrationWith([
			{
				id: 772,
				tags: ["abtest:test-1", "winner:deployed", "holdout:group"],
			},
		]);
		const service = new AbTestService(
			integration as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		await service.hydrateTests([makeTest()]);

		await expect(service.deployWinner("test-1")).rejects.toThrow(
			/ambiguous variant tags/,
		);
	});

	test("rejects adoption when multiple campaigns claim winner:deployed", async () => {
		const integration = integrationWith([
			{
				id: 773,
				tags: ["abtest:test-1", "variant:A", "winner:deployed"],
			},
			{
				id: 774,
				tags: ["abtest:test-1", "variant:A", "winner:deployed"],
			},
		]);
		const service = new AbTestService(
			integration as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		await service.hydrateTests([makeTest()]);

		await expect(service.deployWinner("test-1")).rejects.toThrow(
			/2 campaigns tagged winner:deployed/,
		);
	});

	test("keeps a completed test completed when an adoption lookup fails", async () => {
		let lookupFails = true;
		let creates = 0;
		const integration: IntegrationLike = {
			findCampaignsByTestTag: async () => {
				if (lookupFails) {
					throw new Error("campaign list unavailable");
				}
				return [];
			},
			deployWinnerToHoldout: async () => {
				creates += 1;
				return 780;
			},
			autoDeployWinner: async () => {},
		};
		const service = new AbTestService(
			integration as never,
			new SimulatedMetricsCollector(new Map([["test-1", decisiveResults()]])),
		);
		// run/tick finalized a significant winner without auto-deploying it,
		// so the operator deploys it manually from `completed`.
		await service.hydrateTests([{ ...makeTest(), status: "completed" }]);

		// A deployment whose campaign lookup fails transiently must reject
		// without rewriting the terminal status: restoring `analyzing` would
		// make run/tick eligible to process the finished test again.
		await expect(service.deployWinner("test-1")).rejects.toThrow(
			/campaign list unavailable/,
		);
		const afterFailure = await service.getTest("test-1");
		expect(afterFailure?.status).toBe("completed");
		expect(afterFailure?.winnerCampaignId).toBeUndefined();

		lookupFails = false;
		await service.deployWinner("test-1");
		expect(creates).toBe(1);
		const persisted = await service.getTest("test-1");
		expect(persisted?.status).toBe("completed");
		expect(persisted?.winnerCampaignId).toBe(780);
	});
});

// Every lifecycle status outside WINNER_DEPLOYMENT_STATUSES. `completed`
// is only deployable while it has no recorded winner campaign.
const REJECTED_DEPLOYMENT_STATUSES = [
	"draft",
	"testing",
	"scheduled",
	"running",
	"deploying",
	"cancelling",
	"inconclusive",
	"cancelled",
	"failed",
] as const satisfies readonly AbTest["status"][];

type RecordedCalls = {
	lookups: number;
	creates: number;
	launches: number;
	collections: number;
};

function recordingService(): { service: AbTestService; calls: RecordedCalls } {
	const calls: RecordedCalls = {
		lookups: 0,
		creates: 0,
		launches: 0,
		collections: 0,
	};
	const integration: IntegrationLike = {
		findCampaignsByTestTag: async () => {
			calls.lookups += 1;
			return [];
		},
		deployWinnerToHoldout: async () => {
			calls.creates += 1;
			return 900 + calls.creates;
		},
		autoDeployWinner: async () => {
			calls.launches += 1;
		},
	};
	const service = new AbTestService(integration as never, {
		collect: async () => {
			calls.collections += 1;
			return decisiveResults();
		},
	});
	return { service, calls };
}

describe("abtest deploy-winner status guard", () => {
	for (const status of REJECTED_DEPLOYMENT_STATUSES) {
		test(`rejects a ${status} test before analysis or any remote call`, async () => {
			const { service, calls } = recordingService();
			await service.hydrateTests([
				{ ...makeTest(), status, autoDeployWinner: true },
			]);

			const rejection = await service.deployWinner("test-1").then(
				() => undefined,
				(error: unknown) => error,
			);

			expect(rejection).toBeInstanceOf(AbTestInvalidStatusError);
			expect(rejection).toMatchObject({
				testId: "test-1",
				status,
				allowedStatuses: ["analyzing", "completed"],
			});
			expect((rejection as Error).message).toContain(`status "${status}"`);
			expect(calls).toEqual({
				lookups: 0,
				creates: 0,
				launches: 0,
				collections: 0,
			});
			const unchanged = await service.getTest("test-1");
			expect(unchanged?.status).toBe(status);
			expect(unchanged?.winnerCampaignId).toBeUndefined();
			expect(unchanged?.winnerVariantId).toBeUndefined();
		});
	}

	test("deploys from a completed test whose winner has not been deployed", async () => {
		const { service, calls } = recordingService();
		await service.hydrateTests([
			{ ...makeTest(), status: "completed", autoDeployWinner: true },
		]);

		await service.deployWinner("test-1");

		expect(calls).toMatchObject({ creates: 1, launches: 1 });
		const persisted = await service.getTest("test-1");
		expect(persisted?.status).toBe("completed");
		expect(persisted?.winnerCampaignId).toBe(901);
		expect(persisted?.winnerVariantId).toBe("A");
	});

	test("replays a completed deployment without another holdout delivery", async () => {
		const { service, calls } = recordingService();
		await service.hydrateTests([
			{
				...makeTest(),
				status: "completed",
				autoDeployWinner: true,
				winnerCampaignId: 777,
				winnerVariantId: "A",
			},
		]);

		await service.deployWinner("test-1");

		expect(calls).toEqual({
			lookups: 0,
			creates: 0,
			launches: 0,
			collections: 0,
		});
		const persisted = await service.getTest("test-1");
		expect(persisted?.status).toBe("completed");
		expect(persisted?.winnerCampaignId).toBe(777);
	});
});

describe("resolveWinnerDeployment", () => {
	test("allows analyzing and undeployed completed tests only", () => {
		expect(WINNER_DEPLOYMENT_STATUSES).toEqual(["analyzing", "completed"]);
		expect(
			resolveWinnerDeployment({ id: "t", status: "analyzing" }),
		).toBe("deploy");
		expect(
			resolveWinnerDeployment({ id: "t", status: "completed" }),
		).toBe("deploy");
		expect(
			resolveWinnerDeployment({
				id: "t",
				status: "completed",
				winnerCampaignId: 12,
			}),
		).toBe("already-deployed");
	});

	test("explains the refusal with structured details", () => {
		let refusal: unknown;
		try {
			resolveWinnerDeployment({ id: "t-9", status: "cancelled" });
		} catch (error) {
			refusal = error;
		}
		expect(refusal).toBeInstanceOf(AbTestInvalidStatusError);
		expect((refusal as Error).message).toBe(
			'Cannot deploy the winner for A/B test t-9 in status "cancelled": the test was stopped, so its holdout must not receive a winner. Only "analyzing" tests, or "completed" tests without a deployed winner campaign, can deploy a winner',
		);
		expect(
			(refusal as AbTestInvalidStatusError).toStructuredDetails(),
		).toEqual({
			test_id: "t-9",
			status: "cancelled",
			allowed_statuses: ["analyzing", "completed"],
		});
	});
});
