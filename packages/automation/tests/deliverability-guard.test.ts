import { expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { evaluateDeliverabilityGuard } from "../src/campaign";
import { invokeDeliverabilityGuardOperation } from "../src/ops-operations";
const now = new Date("2026-09-25T12:00:00Z");
function fixture(overrides: Record<string, unknown> = {}, bounceCount = 0) {
	const campaign = {
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
	let reads = 0;
	let pauses = 0;
	let secondRead: Record<string, unknown> | undefined;
	const client = {
		campaign: {
			getById: async () => ({
				data: ++reads > 1 && secondRead ? secondRead : campaign,
			}),
			updateStatus: async () => {
				pauses += 1;
				return { data: true };
			},
		},
		bounce: {
			list: async () => ({
				data: {
					results: Array.from({ length: bounceCount }, (_, id) => ({ id })),
				},
			}),
		},
	} as unknown as ListmonkClient;
	return {
		client,
		campaign,
		pauses: () => pauses,
		setSecondRead: (value: Record<string, unknown>) => {
			secondRead = value;
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
for (const started_at of [undefined, "invalid", "2026-09-25T13:00:00Z"]) {
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
test("pause fails closed when the observed revision is missing or changes", async () => {
 const missing = fixture({ updated_at: undefined }, 6);
 await expect(evaluateDeliverabilityGuard(missing.client, 1, observe)).rejects.toThrow("updated_at");
 const changed = fixture({}, 6);
 changed.setSecondRead({ ...changed.campaign, updated_at: "2026-09-25T12:00:01Z" });
 await expect(evaluateDeliverabilityGuard(changed.client, 1, observe)).rejects.toThrow("changed after preflight");
 expect(missing.pauses() + changed.pauses()).toBe(0);
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
