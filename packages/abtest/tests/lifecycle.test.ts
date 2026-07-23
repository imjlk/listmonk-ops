import { describe, expect, it, mock } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	cancelAbTest,
	errorEnvelopeMessage,
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

	it("retains lists when terminal campaigns are left (they still reference their lists)", () => {
		// Both campaigns terminal -> both left -> both must block list deletion
		// so the preserved delivery history keeps its list context.
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "finished"], [101, "sent"]]),
		);
		expect(plan.campaignsBlockingListDeletion).toContain(100);
		expect(plan.campaignsBlockingListDeletion).toContain(101);
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
		expect(plan.campaignsBlockingListDeletion).toContain(101);
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
		expect(plan.campaignsBlockingListDeletion).toContain(999);
	});
});

describe("isNotFoundError", () => {
	it("matches 'not found' and '404' in error messages", () => {
		expect(isNotFoundError(new Error("Campaign not found"))).toBe(true);
		expect(isNotFoundError(new Error("404 page not found"))).toBe(true);
	});
	it("prefers a structured response.status over the message text", () => {
		// A 404 response with a message that does not contain "not found"
		// still classifies as not-found via the structured status.
		expect(isNotFoundError({ response: { status: 404 }, message: "nope" })).toBe(
			true,
		);
		// A 500 response is not a not-found even if the message mentions "404".
		expect(
			isNotFoundError({ response: { status: 500 }, message: "saw a 404 once" }),
		).toBe(false);
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

	it("cancels running campaigns and retains their lists", async () => {
		// Cancelled campaigns still reference their temporary lists, so the
		// planner retains every list and fullyCleaned is false. The lists can
		// be cleaned up by an explicit reconcile later.
		const client = makeClient();
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "running"], [101, "running"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.campaignResults.every((r) => r.outcome === "success")).toBe(true);
		expect(result.listResults.every((r) => r.outcome === "skipped_active_reference")).toBe(true);
		expect(result.fullyCleaned).toBe(false);
		expect(result.hadRetainedResources).toBe(true);
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
		// If a campaign delete fails, the list must be retained. The failed
		// campaign id is now added to survivingListReferences, so every list
		// is skipped rather than deleted.
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
		expect(result.listResults.every((r) => r.outcome === "skipped_active_reference")).toBe(true);
		expect(result.fullyCleaned).toBe(false);
		expect(result.hadRetainedResources).toBe(true);
		expect(result.hadFailures).toBe(true);
	});

	it("reports fullyCleaned=false but hadFailures=false when lists are only retained", async () => {
		// An unobservable campaign (left) causes lists to be skipped, but no
		// action actually failed. fullyCleaned=false because lists remain,
		// but hadFailures=false and hadRetainedResources=true.
		const client = makeClient();
		const plan = planCancelAbTest(makeTest(), new Map([[100, "running"]]));
		const result = await executeCancelPlan(client, plan);
		expect(result.fullyCleaned).toBe(false);
		expect(result.hadRetainedResources).toBe(true);
		expect(result.hadFailures).toBe(false);
	});

	it("repeated execution is idempotent: a second run reports not_found for campaigns", async () => {
		// Cancelled campaigns retain their lists, so the second run sees the
		// campaigns as not_found (idempotent) and skips the retained lists.
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
		// Lists are retained (cancelled campaigns still reference them), so
		// they are skipped, not deleted.
		expect(result.listResults.every((r) => r.outcome === "skipped_active_reference")).toBe(true);
		expect(result.fullyCleaned).toBe(false);
	});
});

describe("errorEnvelopeMessage", () => {
	it("returns the message from an error envelope", () => {
		expect(errorEnvelopeMessage({ error: "boom" })).toBe("boom");
		expect(errorEnvelopeMessage({ error: new Error("nope") })).toBe("nope");
	});
	it("returns undefined for success responses", () => {
		expect(errorEnvelopeMessage({ data: true })).toBeUndefined();
		expect(errorEnvelopeMessage(undefined)).toBeUndefined();
	});
});

describe("executeCancelPlan error envelopes", () => {
	function makeEnvelopeClient(overrides: {
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
			campaign: { updateStatus, delete: deleteCampaign },
			list: { delete: deleteList },
		} as unknown as ListmonkClient;
	}

	it("marks a campaign cancel failed when Listmonk returns an error envelope", async () => {
		// cancel on a scheduled campaign -> Listmonk returns 400 as an envelope
		const client = makeEnvelopeClient({
			updateStatus: async () => ({ error: "Only active campaigns can be cancelled" }),
		});
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "running"], [101, "running"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.campaignResults.every((r) => r.outcome === "failed")).toBe(true);
		expect(result.fullyCleaned).toBe(false);
		// lists must be retained since campaigns survived
		expect(result.listResults.every((r) => r.outcome === "skipped_active_reference")).toBe(true);
	});

	it("marks a list delete failed when Listmonk returns a non-404 error envelope", async () => {
		// A permission-denied envelope has no recognizable 404 signal, so it
		// must be classified as failed (not silently success). Use draft
		// campaigns so the planner does not retain lists for cancelled
		// campaigns — drafts are deleted, which removes the surviving
		// reference and lets the list delete action actually run.
		const client = makeEnvelopeClient({
			deleteList: async () => ({ error: "permission denied" }),
		});
		const plan = planCancelAbTest(
			makeTest(),
			new Map([[100, "draft"], [101, "draft"]]),
		);
		const result = await executeCancelPlan(client, plan);
		expect(result.listResults.every((r) => r.outcome === "failed")).toBe(true);
		expect(result.fullyCleaned).toBe(false);
	});
});

describe("cancelAbTest orchestration", () => {
	it("fetches statuses, plans, and executes end-to-end", async () => {
		const getById = mock(async ({ path }: { path: { id: number } }) => ({
			data: { id: path.id, status: path.id === 100 ? "running" : "draft" },
		}));
		const updateStatus = mock(async () => ({ data: true }));
		const deleteCampaign = mock(async () => ({ data: true }));
		const deleteList = mock(async () => ({ data: true }));
		const client = {
			campaign: { getById, updateStatus, delete: deleteCampaign },
			list: { delete: deleteList },
		} as unknown as ListmonkClient;
		const result = await cancelAbTest(client, makeTest());
		// 100 running -> cancel, 101 draft -> delete
		expect(result.campaignResults).toEqual([
			expect.objectContaining({ campaignId: 100, action: "cancel", outcome: "success" }),
			expect.objectContaining({ campaignId: 101, action: "delete", outcome: "success" }),
		]);
		// The cancelled campaign (100) still references its list, so lists are
		// retained and fullyCleaned is false. No fetch failures here.
		expect(result.hadFetchFailures).toBe(false);
		expect(result.hadRetainedResources).toBe(true);
		expect(result.fullyCleaned).toBe(false);
	});

	it("reports hadFetchFailures when a campaign status cannot be read", async () => {
		const getById = mock(async () => {
			throw new Error("network down");
		});
		const updateStatus = mock(async () => ({ data: true }));
		const deleteCampaign = mock(async () => ({ data: true }));
		const deleteList = mock(async () => ({ data: true }));
		const client = {
			campaign: { getById, updateStatus, delete: deleteCampaign },
			list: { delete: deleteList },
		} as unknown as ListmonkClient;
		const result = await cancelAbTest(client, makeTest());
		// Both campaigns unobservable -> planner leaves them -> hadFetchFailures
		expect(result.hadFetchFailures).toBe(true);
	});

	it("treats a 404 campaign as already-deleted (not blocking list cleanup)", async () => {
		// A missing campaign cannot still send or reference lists, so a 404
		// classifies it as already_deleted — terminal, but NOT added to
		// campaignsBlockingListDeletion.
		const getById = mock(async ({ path }: { path: { id: number } }) => {
			if (path.id === 101) {
				return { error: "Campaign not found" };
			}
			return { data: { id: path.id, status: "running" } };
		});
		const updateStatus = mock(async () => ({ data: true }));
		const deleteCampaign = mock(async () => ({ data: true }));
		const deleteList = mock(async () => ({ data: true }));
		const client = {
			campaign: { getById, updateStatus, delete: deleteCampaign },
			list: { delete: deleteList },
		} as unknown as ListmonkClient;
		const result = await cancelAbTest(client, makeTest());
		// 100 running -> cancel; 101 not found -> already_deleted (leave, no block).
		expect(result.hadFetchFailures).toBe(false);
		expect(result.campaignResults).toEqual([
			expect.objectContaining({ campaignId: 100, action: "cancel" }),
			expect.objectContaining({
				campaignId: 101,
				action: "leave",
				detail: "campaign already deleted (404)",
			}),
		]);
		// The already-deleted campaign (101) must NOT appear in the plan's
		// campaignsBlockingListDeletion — only the cancelled campaign (100)
		// blocks list cleanup.
		expect(result.plan.campaignsBlockingListDeletion).toContain(100);
		expect(result.plan.campaignsBlockingListDeletion).not.toContain(101);
	});
});
