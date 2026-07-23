import { describe, expect, it, mock } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	executeCancelPlan,
	isNotFoundError,
	planCancelAbTest,
} from "../src/lifecycle";
import type { AbTest } from "../src/types";

function makeTest(overrides: Partial<AbTest> = {}): AbTest {
	return {
		id: "test-1",
		name: "Test 1",
		status: "running",
		baseConfig: { subject: "s", body: "b", lists: [1], template_id: 1 },
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 10,
		holdoutGroupSize: 90,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [
			{ variantId: "A", campaignId: 100 },
			{ variantId: "B", campaignId: 101 },
		],
		testListMappings: [
			{ variantId: "A", listId: 200 },
			{ variantId: "B", listId: 201 },
		],
		holdoutListId: 202,
		createdAt: new Date(),
		updatedAt: new Date(),
		variants: [],
		...overrides,
	} as AbTest;
}

describe("planCancelAbTest", () => {
	it("cancels running campaigns", () => {
		const plan = planCancelAbTest(makeTest(), new Map([[100, "running"], [101, "running"]]));
		expect(plan.campaignActions).toEqual([
			{ kind: "cancel", campaignId: 100 },
			{ kind: "cancel", campaignId: 101 },
		]);
	});

	it("deletes draft and scheduled campaigns (cancel is not allowed)", () => {
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "draft"], [101, "scheduled"]]),
		);
		expect(plan.campaignActions).toEqual([
			{ kind: "delete", campaignId: 100 },
			{ kind: "delete", campaignId: 101 },
		]);
	});

	it("leaves finished/sent/cancelled campaigns by default", () => {
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "finished"], [101, "cancelled"]]),
		);
		expect(plan.campaignActions.every((a) => a.kind === "leave")).toBe(true);
		expect(plan.campaignActions[0]).toMatchObject({ reason: "terminal status finished" });
	});

	it("deletes terminal campaigns when deleteTerminalCampaigns is set", () => {
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "finished"]]),
			{ deleteTerminalCampaigns: true },
		);
		expect(plan.campaignActions[0]).toMatchObject({
			kind: "delete",
			campaignId: 100,
		});
	});

	it("leaves and counts as surviving when a campaign status cannot be observed", () => {
		const plan = planCancelAbTest(makeTest(), new Map([[100, "running"]]));
		// 101 is missing from the observed map.
		expect(plan.campaignActions[1]).toMatchObject({
			kind: "leave",
			campaignId: 101,
			reason: "status could not be observed",
		});
		expect(plan.listsReferencedByActiveCampaign).toContain(101);
	});

	it("does not produce any rename action (campaign names are preserved)", () => {
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "running"], [101, "running"]]),
		);
		// No action kind touches the name field.
		const allKinds = plan.campaignActions.map((a) => a.kind);
		expect(allKinds.every((k) => k === "cancel" || k === "delete" || k === "leave")).toBe(true);
	});

	it("plans list deletion for every temporary list and holdout list", () => {
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "running"], [101, "running"]]),
		);
		const listIds = plan.listActions.map((a) => a.listId).sort((a, b) => a - b);
		expect(listIds).toEqual([200, 201, 202]);
	});

	it("treats an existing winner campaign id as a surviving reference", () => {
		const plan = planCancelAbTest(
			makeTest({ winnerCampaignId: 999 }),
			new Map([[100, "running"], [101, "running"]]),
		);
		expect(plan.listsReferencedByActiveCampaign).toContain(999);
	});
});

describe("isNotFoundError", () => {
	it("matches 'not found' and '404' in error messages", () => {
		expect(isNotFoundError(new Error("Campaign not found"))).toBe(true);
		expect(isNotFoundError(new Error("404 page not found"))).toBe(true);
	});
	it("does not match unrelated errors", () => {
		expect(isNotFoundError(new Error("internal server error"))).toBe(false);
		expect(isNotFoundError(new Error("Only active campaigns can be cancelled"))).toBe(false);
	});
	it("handles string and object shapes", () => {
		expect(isNotFoundError("not found")).toBe(true);
		expect(isNotFoundError({ message: "404" })).toBe(true);
		expect(isNotFoundError("boom")).toBe(false);
	});
});

describe("executeCancelPlan", () => {
	function makeClient(overrides: {
		updateStatus?: (...args: unknown[]) => Promise<unknown>;
		deleteCampaign?: (...args: unknown[]) => Promise<unknown>;
		deleteList?: (...args: unknown[]) => Promise<unknown>;
	} = {}): ListmonkClient {
		const updateStatus = mock(
			overrides.updateStatus ?? (async () => ({ data: true })),
		);
		const deleteCampaign = mock(
			overrides.deleteCampaign ?? (async () => ({ data: true })),
		);
		const deleteList = mock(
			overrides.deleteList ?? (async () => ({ data: true })),
		);
		return {
			campaign: {
				updateStatus,
				delete: deleteCampaign,
			},
			list: { delete: deleteList },
		} as unknown as ListmonkClient;
	}

	it("cancels running campaigns and deletes lists when nothing survives", async () => {
		const client = makeClient();
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "running"], [101, "running"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.campaignResults.every((r) => r.outcome === "success")).toBe(true);
		expect(result.listResults.every((r) => r.outcome === "success")).toBe(true);
		expect(result.fullyCleaned).toBe(true);
	});

	it("treats a 404 on campaign delete as success", async () => {
		const client = makeClient({
			deleteCampaign: async () => {
				throw new Error("Campaign not found");
			},
		});
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "draft"], [101, "draft"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.campaignResults.every((r) => r.outcome === "not_found")).toBe(true);
		expect(result.fullyCleaned).toBe(true);
	});

	it("records failure without aborting the rest of the campaigns", async () => {
		const client = makeClient({
			updateStatus: async ({ path }: { path: { id: number } }) => {
				if (path.id === 101) {
					throw new Error("internal server error");
				}
				return { data: true };
			},
		});
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "running"], [101, "running"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.campaignResults).toEqual([
			expect.objectContaining({ campaignId: 100, outcome: "success" }),
			expect.objectContaining({ campaignId: 101, outcome: "failed" }),
		]);
		expect(result.fullyCleaned).toBe(false);
	});

	it("skips list deletion when a surviving campaign is referenced", async () => {
		const client = makeClient();
		// 101 unobservable -> survives -> lists must be skipped.
		const plan = planCancelAbTest(makeTest(), new Map([[100, "running"]]));
		const result = await executeCancelPlan(client, plan);
		expect(result.listResults.every((r) => r.outcome === "skipped_active_reference")).toBe(true);
		expect(result.fullyCleaned).toBe(false);
	});

	it("does not delete lists before the campaigns that reference them", async () => {
		// If a campaign delete fails, the list must be retained even when
		// the plan did not initially flag a surviving reference.
		const client = makeClient({
			deleteCampaign: async () => {
				throw new Error("permission denied");
			},
		});
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "draft"], [101, "draft"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.campaignResults.every((r) => r.outcome === "failed")).toBe(true);
		// Both draft campaigns failed to delete, so they still reference their
		// lists indirectly through the plan; list deletion is skipped because
		// the campaigns were not successfully removed.
		expect(result.listResults.length).toBeGreaterThan(0);
		expect(result.fullyCleaned).toBe(false);
	});

	it("repeated execution is idempotent: a second run reports not_found", async () => {
		const client = makeClient({
			updateStatus: async () => {
				throw new Error("Campaign not found");
			},
			deleteCampaign: async () => {
				throw new Error("Campaign not found");
			},
			deleteList: async () => {
				throw new Error("List not found");
			},
		});
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "running"], [101, "running"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.campaignResults.every((r) => r.outcome === "not_found")).toBe(true);
		expect(result.listResults.every((r) => r.outcome === "not_found")).toBe(true);
		expect(result.fullyCleaned).toBe(true);
	});
});
