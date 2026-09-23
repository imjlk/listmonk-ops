import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { recordAbTestConversion } from "../src/conversion-recording";
import { JsonFileConversionEventStore } from "../src/conversion-events";
import { ListmonkMetricsCollector } from "../src/metrics";
import { invokeRecordAbTestConversionOperation } from "../src/operations";
import { saveStoredAbTests } from "../src/persistence";
import type { AbTest } from "../src/types";

const launchedAt = "2026-08-01T00:00:00.000Z";

function makeTest(): AbTest {
	return {
		id: "test-1",
		name: "Conversion test",
		campaignId: "campaign-1",
		variants: [
			{ id: "A", name: "A", percentage: 50, contentOverrides: {} },
			{ id: "B", name: "B", percentage: 50, contentOverrides: {} },
		],
		status: "running",
		metrics: [],
		createdAt: new Date(launchedAt),
		updatedAt: new Date(launchedAt),
		baseConfig: { subject: "Subject", body: "Body", lists: [1] },
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 10,
		holdoutGroupSize: 90,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [
			{ variantId: "A", campaignId: 10 },
			{ variantId: "B", campaignId: 11 },
		],
		testListMappings: [
			{ variantId: "A", listId: 20 },
			{ variantId: "B", listId: 21 },
		],
		provisionedAt: launchedAt,
		startedAt: launchedAt,
		launchAt: launchedAt,
		endsAt: "2026-08-02T00:00:00.000Z",
	};
}

function makeEvent(overrides: Record<string, unknown> = {}) {
	return {
		eventId: "purchase-1",
		testId: "test-1",
		variantId: "A",
		subscriberUuid: "subscriber-1",
		event: "purchase",
		value: 25,
		currency: "USD",
		occurredAt: "2026-08-01T12:00:00.000Z",
		...overrides,
	};
}

describe("A/B conversion recording", () => {
	it("validates assignment and window, persists idempotently, and feeds analysis metrics", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-recording-"));
		try {
			const storePath = join(directory, "abtests.json");
			await saveStoredAbTests([makeTest()], storePath);
			let subscriberCalls = 0;
			const client = {
				subscriber: { list: async () => {
					subscriberCalls += 1;
					return { data: { results: [{ uuid: "subscriber-1" }] } };
				} },
				campaign: { getById: async () => ({ data: { sent: 10, views: 4, clicks: 2 } }) },
			} as unknown as ListmonkClient;
			const event = makeEvent();
			const recorded = await invokeRecordAbTestConversionOperation(
				{ client, storePath },
				{
					event_id: event.eventId,
					test_id: event.testId,
					variant_id: event.variantId,
					subscriber_uuid: event.subscriberUuid,
					event: event.event,
					value: event.value,
					currency: event.currency,
					occurred_at: event.occurredAt,
				},
			);
			expect(recorded).toEqual({ status: "created", event_id: "purchase-1", test_id: "test-1" });
			expect(await recordAbTestConversion(client, event, storePath)).toBe("duplicate");
			expect(subscriberCalls).toBe(1);
			await expect(recordAbTestConversion(client, makeEvent({ event: "signup" }), storePath)).rejects.toThrow("different conversion");
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "late", occurredAt: "2026-08-03T00:00:00.000Z" }), storePath)).rejects.toThrow("attribution window");
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "future", occurredAt: "2099-01-01T00:00:00.000Z" }), storePath)).rejects.toThrow("future");
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "wrong", subscriberUuid: "stranger" }), storePath)).rejects.toThrow("not assigned");
			const conversions = new JsonFileConversionEventStore(join(directory, "abtest-conversions.json"));
			const results = await new ListmonkMetricsCollector(client, conversions).collect(makeTest());
			expect(results[0]).toMatchObject({ conversions: 1, revenue: 25, currency: "USD", conversionRate: 10 });
			expect(results[1]).toMatchObject({ conversions: 0, conversionRate: 0 });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
