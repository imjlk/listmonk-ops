import { expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { evaluateDeliverabilityGuard } from "../src/campaign";
import { invokeDeliverabilityGuardOperation } from "../src/ops-operations";
const now = new Date("2026-09-25T12:00:00Z");
// A stateful fake of one Listmonk campaign. Changes can land while the guard
// lists bounces (the campaign keeps sending) or right after the guard's
// decision read, before the shared pause re-reads the campaign.
function fixture(overrides: Record<string, unknown> = {}, bounceCount = 0) {
	let campaign: Record<string, unknown> = {
		id: 1,
		name: "Guard",
		status: "running",
		sent: 100,
		views: 0,
		clicks: 0,
		started_at: "2026-09-25T11:59:00Z",
		updated_at: "2026-09-25T11:59:01Z",
		...overrides,
	};
	let whileListing: Record<string, unknown> | undefined;
	let afterDecision: Record<string, unknown> | undefined;
	let listed = false;
	let readsAfterListing = 0;
	const statusWrites: unknown[] = [];
	const client = {
		campaign: {
			getById: async () => {
				const data = { ...campaign };
				if (listed && ++readsAfterListing === 1 && afterDecision) {
					campaign = { ...campaign, ...afterDecision };
				}
				return { data };
			},
			updateStatus: async (request: unknown) => {
				statusWrites.push(request);
				return { data: true };
			},
		},
		bounce: {
			list: async () => {
				if (whileListing) campaign = { ...campaign, ...whileListing };
				listed = true;
				return {
					data: {
						results: Array.from({ length: bounceCount }, (_, id) => ({ id })),
					},
				};
			},
		},
	} as unknown as ListmonkClient;
	return {
		client,
		pauses: () => statusWrites.length,
		statusWrites: () => statusWrites,
		whileListingBounces: (changes: Record<string, unknown>) => {
			whileListing = changes;
		},
		afterDecisionRead: (changes: Record<string, unknown>) => {
			afterDecision = changes;
		},
	};
}
const observe = { now: () => now, pauseOnBreach: true };

test("a just-started campaign is not stopped for zero engagement", async () => {
 const f = fixture();
 const result = await evaluateDeliverabilityGuard(f.client, 1, { ...observe, pauseOnEngagementBreach: true });
 expect(result.breaches).toEqual([]);
	expect(result.paused).toBe(false);
	expect(f.pauses()).toBe(0);
});
test("mature engagement breaches remain advisory by default", async () => {
	const f = fixture({ started_at: "2026-09-25T10:00:00Z" });
	const result = await evaluateDeliverabilityGuard(f.client, 1, observe);
	expect(result.breaches).toHaveLength(2);
	expect(result.paused).toBe(false);
});
test("explicit engagement opt-in pauses only after volume and time gates", async () => {
	const f = fixture({ started_at: "2026-09-25T11:00:00Z" });
	expect((await evaluateDeliverabilityGuard(f.client, 1, { ...observe, pauseOnEngagementBreach: true })).paused).toBe(
		true,
	);
	expect(f.pauses()).toBe(1);
});
test("engagement opt-in alone cannot authorize a pause", async () => {
 const f = fixture({ started_at: "2026-09-25T10:00:00Z" });
 await evaluateDeliverabilityGuard(f.client, 1, { now: () => now, pauseOnEngagementBreach: true });
 expect(f.pauses()).toBe(0);
});
for (const started_at of [
	undefined,
	"invalid",
	"0",
	"2026-02-30T00:00:00Z",
	"2026-09-25T13:00:00Z",
]) {
	test(`unknown or future start does not authorize engagement: ${started_at}`, async () => {
  const f = fixture({ started_at });
  const result = await evaluateDeliverabilityGuard(f.client, 1, { ...observe, pauseOnEngagementBreach: true });
  expect(result.breaches).toEqual([]);
		expect(f.pauses()).toBe(0);
 });
}
test("minimum-sent and configurable observation gates are both required", async () => {
	const f = fixture({ started_at: "2026-09-25T11:59:00Z", sent: 99 });
	expect((await evaluateDeliverabilityGuard(f.client, 1, { ...observe, minimumObservationSeconds: 60 })).breaches).toEqual(
		[],
	);
	const enough = fixture();
	expect((await evaluateDeliverabilityGuard(enough.client, 1, { ...observe, minimumObservationSeconds: 60 })).breaches).toHaveLength(
		2,
	);
});
test("early bounce breaches still pause running campaigns", async () => {
	const f = fixture({}, 6);
	expect((await evaluateDeliverabilityGuard(f.client, 1, observe)).paused).toBe(
		true,
	);
	expect(f.pauses()).toBe(1);
});
test("scheduled campaigns never issue the illegal paused transition", async () => {
	const f = fixture({ status: "scheduled" }, 6);
	expect((await evaluateDeliverabilityGuard(f.client, 1, observe)).paused).toBe(
		false,
	);
	expect(f.pauses()).toBe(0);
});
// Listmonk only ever adds to a running campaign's sent count, including while
// the guard lists every bounce. Rates must use counters read after that
// listing, never an older denominator paired with newer bounces.
test("sends during the bounce listing are rated against the fresh sent count", async () => {
	const f = fixture({}, 6);
	// 6 bounces are 6% of the 100 sends before the listing, 3.33% of the 180 after.
	f.whileListingBounces({ sent: 180, updated_at: "2026-09-25T12:00:01Z" });
	const result = await evaluateDeliverabilityGuard(f.client, 1, observe);
	expect(result.metrics).toMatchObject({ sent: 180, bounces: 6, bounceRate: 6 / 180 });
	expect(result.breaches).toEqual([]);
	expect(result.paused).toBe(false);
	expect(f.pauses()).toBe(0);
});
test("engagement is rated against the same fresh snapshot", async () => {
	const f = fixture({ started_at: "2026-09-25T10:00:00Z" });
	f.whileListingBounces({ sent: 120, views: 30, clicks: 6 });
	const result = await evaluateDeliverabilityGuard(f.client, 1, { ...observe, pauseOnEngagementBreach: true });
	expect(result.metrics).toMatchObject({
		sent: 120,
		openRate: 0.25,
		clickRate: 0.05,
	});
	expect(result.breaches).toEqual([]);
	expect(f.pauses()).toBe(0);
});
// Listmonk 6.2 also bumps a running campaign's updated_at on every subscriber
// batch fetch and sent-count flush, so the revision can advance between the
// guard's decision read and the pause's own re-read while it keeps sending.
test("a breach that holds on the fresh snapshot pauses despite later send progress", async () => {
	const f = fixture({}, 6);
	f.whileListingBounces({ sent: 110, updated_at: "2026-09-25T12:00:01Z" });
	f.afterDecisionRead({ sent: 125, updated_at: "2026-09-25T12:00:02Z" });
	const result = await evaluateDeliverabilityGuard(f.client, 1, observe);
	expect(result.metrics).toMatchObject({ sent: 110, bounceRate: 6 / 110 });
	expect(result.breaches).toEqual(["Bounce rate 5.45% is above 5.00%"]);
	expect(result.paused).toBe(true);
	expect(f.statusWrites()).toEqual([
		{ path: { id: 1 }, body: { status: "paused" } },
	]);
});
test("the shared guard operation pauses despite an advanced revision", async () => {
	const f = fixture({}, 6);
	f.afterDecisionRead({ updated_at: "2026-09-25T12:00:01Z" });
	const result = await invokeDeliverabilityGuardOperation({ client: f.client }, { campaign_id: 1, pause_on_breach: true });
	expect(result.paused).toBe(true);
	expect(f.pauses()).toBe(1);
});
test("a missing observed revision does not block the status-bound pause", async () => {
	const f = fixture({ updated_at: undefined }, 6);
	expect((await evaluateDeliverabilityGuard(f.client, 1, observe)).paused).toBe(
		true,
	);
	expect(f.pauses()).toBe(1);
});
for (const status of ["paused", "scheduled", "finished", "cancelled"]) {
	test(`a campaign that became ${status} during the bounce listing is reported, not paused`, async () => {
		const f = fixture({}, 6);
		f.whileListingBounces({ status, updated_at: "2026-09-25T12:00:01Z" });
		const result = await evaluateDeliverabilityGuard(f.client, 1, observe);
		expect(result.status).toBe(status);
		expect(result.breaches).toEqual(["Bounce rate 6.00% is above 5.00%"]);
		expect(result.paused).toBe(false);
		expect(f.pauses()).toBe(0);
	});
}
for (const status of ["scheduled", "finished", "cancelled"]) {
	test(`a campaign that became ${status} right before the pause fails closed`, async () => {
		const f = fixture({}, 6);
		f.afterDecisionRead({ status, updated_at: "2026-09-25T12:00:01Z" });
		await expect(evaluateDeliverabilityGuard(f.client, 1, observe)).rejects.toThrow(
			`Campaign ${status} -> paused is not a valid lifecycle transition`,
		);
		expect(f.pauses()).toBe(0);
	});
}
test("a campaign paused elsewhere right before the pause is an idempotent no-op", async () => {
	const f = fixture({}, 6);
	f.afterDecisionRead({ status: "paused", updated_at: "2026-09-25T12:00:01Z" });
	expect((await evaluateDeliverabilityGuard(f.client, 1, observe)).paused).toBe(
		true,
	);
	expect(f.pauses()).toBe(0);
});
test("operation schema exposes and validates the shared observation controls", async () => {
 const f = fixture({ started_at: "2020-01-01T00:00:00Z" });
 const result = await invokeDeliverabilityGuardOperation({ client: f.client }, {
  campaign_id: 1, pause_on_breach: true, pause_on_engagement_breach: true, minimum_observation_seconds: 60,
 });
 expect(result.paused).toBe(true);
 for (const value of [0, -1, 31_536_001, "bad"]) {
  await expect(invokeDeliverabilityGuardOperation({ client: f.client }, { campaign_id: 1, minimum_observation_seconds: value })).rejects.toThrow();
 }
});
