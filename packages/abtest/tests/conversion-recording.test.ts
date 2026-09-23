import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { recordAbTestConversion } from "../src/conversion-recording";
import { JsonFileConversionEventStore } from "../src/conversion-events";
import { lockHypothesis } from "../src/hypothesis";
import { ListmonkMetricsCollector } from "../src/metrics";
import {
	invokeRecordAbTestConversionOperation,
	invokeRunAbTestOperation,
	invokeTickAbTestsOperation,
	recordAbTestConversionOperation,
} from "../src/operations";
import { loadStoredAbTests, saveStoredAbTests } from "../src/persistence";
import type { AbTest } from "../src/types";

const launchedAt = "2026-08-01T00:00:00.000Z";
const SUBSCRIBER_UUID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTHER_UUID = "00000000-0000-4000-8000-000000000002";

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
		subscriberUuid: SUBSCRIBER_UUID,
		event: "purchase",
		value: 25,
		currency: "USD",
		occurredAt: "2026-08-01T21:00:00+09:00",
		...overrides,
	};
}

function makeLockedHypothesis(at: string) {
	return lockHypothesis(
		{
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
			createdAt: at,
		},
		at,
	);
}

describe("A/B conversion recording", () => {
	let previousConversionStore: string | undefined;
	beforeEach(() => {
		previousConversionStore = process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE;
		delete process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE;
	});
	afterEach(() => {
		if (previousConversionStore === undefined) {
			delete process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE;
		} else {
			process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE = previousConversionStore;
		}
	});
	it("publishes and enforces the value/currency pairing", () => {
		expect(recordAbTestConversionOperation.inputJsonSchema.dependentRequired).toEqual({
			value: ["currency"], currency: ["value"],
		});
		const base = {
			event_id: "event-1", test_id: "test-1", variant_id: "A",
			subscriber_uuid: SUBSCRIBER_UUID, event: "purchase",
			occurred_at: "2026-08-01T21:00:00+09:00",
		};
		expect(recordAbTestConversionOperation.inputSchema.safeParse({ ...base, value: 25 }).success).toBe(false);
		expect(recordAbTestConversionOperation.inputSchema.safeParse({ ...base, currency: "USD" }).success).toBe(false);
		expect(recordAbTestConversionOperation.inputSchema.safeParse({ ...base, value: 25, currency: "USD" }).success).toBe(true);
	});
	it("validates assignment and window, persists idempotently, and feeds analysis metrics", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-recording-"));
		try {
			const storePath = join(directory, "abtests.json");
			await saveStoredAbTests([makeTest()], storePath);
			const subscriberQueries: unknown[] = [];
			const client = {
				subscriber: { list: async (options: unknown) => {
					subscriberQueries.push(options);
					return { data: { results: [{ uuid: SUBSCRIBER_UUID.toUpperCase() }] } };
				} },
				campaign: { getById: async () => ({ data: { sent: 10, views: 4, clicks: 2 } }) },
			} as unknown as ListmonkClient;
			const event = makeEvent();
			const recorded = await invokeRecordAbTestConversionOperation(
				{ client, storePath },
				{
					event_id: ` ${event.eventId} `,
					test_id: event.testId,
					variant_id: event.variantId,
					subscriber_uuid: event.subscriberUuid.toUpperCase(),
					event: ` ${event.event} `,
					value: event.value,
					currency: event.currency,
					occurred_at: event.occurredAt,
				},
			);
			expect(recorded).toEqual({ status: "created", event_id: "purchase-1", test_id: "test-1" });
			expect(await recordAbTestConversion(client, event, storePath)).toBe("duplicate");
			expect(subscriberQueries).toHaveLength(1);
			expect(subscriberQueries[0]).toMatchObject({
				query: { list_id: [20], query: `uuid = '${SUBSCRIBER_UUID}'`, page: 1, per_page: 2 },
				signal: expect.any(AbortSignal),
			});
			await expect(recordAbTestConversion(client, makeEvent({ event: "signup" }), storePath)).rejects.toThrow("different conversion");
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "late", occurredAt: "2026-08-03T00:00:00.000Z" }), storePath)).rejects.toThrow("attribution window");
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "future", occurredAt: "2099-01-01T00:00:00.000Z" }), storePath)).rejects.toThrow("future");
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "wrong", subscriberUuid: OTHER_UUID }), storePath)).rejects.toThrow("not assigned");
			const conversions = new JsonFileConversionEventStore(join(directory, "abtest-conversions.json"));
			const results = await new ListmonkMetricsCollector(client, conversions).collect(makeTest());
			expect(results[0]).toMatchObject({ conversions: 1, revenue: 25, currency: "USD", conversionRate: 10 });
			expect(results[1]).toMatchObject({ conversions: 0, conversionRate: 0, revenue: 0, currency: "USD" });
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("uses the test end for a pre-registered attribution tail", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-attribution-"));
		try {
			const storePath = join(directory, "abtests.json");
			const test = makeTest();
			test.hypothesis = makeLockedHypothesis(launchedAt);
			await saveStoredAbTests([test], storePath);
			const client = { subscriber: { list: async () => ({ data: { results: [{ uuid: SUBSCRIBER_UUID }] } }) } } as unknown as ListmonkClient;
			expect(await recordAbTestConversion(client, makeEvent({ occurredAt: "2026-08-02T12:00:00.000Z" }), storePath)).toBe("created");
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "after-tail", occurredAt: "2026-08-03T00:00:01.000Z" }), storePath)).rejects.toThrow("attribution window");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("does not record a failed launch intent while status remains draft", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-draft-conversion-"));
		try {
			const storePath = join(directory, "abtests.json");
			const test = makeTest();
			test.status = "draft";
			await saveStoredAbTests([test], storePath);
			const client = { subscriber: { list: async () => { throw new Error("should not query Listmonk"); } } } as unknown as ListmonkClient;
			await expect(recordAbTestConversion(client, makeEvent(), storePath)).rejects.toThrow("has not launched");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("holds automatic analysis and tick previews until the attribution tail closes", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-analysis-tail-"));
		try {
			const storePath = join(directory, "abtests.json");
			const test = makeTest();
			test.launchAt = new Date(Date.now() - 4 * 3_600_000).toISOString();
			test.startedAt = test.launchAt;
			test.endsAt = new Date(Date.now() - 3_600_000).toISOString();
			test.hypothesis = makeLockedHypothesis(test.launchAt);
			await saveStoredAbTests([test], storePath);
			const context = { client: {} as ListmonkClient, storePath };
			expect((await invokeRunAbTestOperation(context, { test_id: test.id })).test.status).toBe("running");
			const preview = await invokeTickAbTestsOperation(context, { dry_run: true });
			expect(preview.results).toContainEqual(expect.objectContaining({
				test_id: test.id, action: "dry-run:noop:running-before-attribution-deadline",
			}));
			test.status = "analyzing";
			await saveStoredAbTests([test], storePath);
			expect((await invokeRunAbTestOperation(context, { test_id: test.id })).test.status).toBe("analyzing");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("serializes a conversion append with deletion of the A/B test", async () => {
		const directory = await mkdtemp(join(tmpdir(), "abtest-record-lock-"));
		try {
			const storePath = join(directory, "abtests.json");
			await saveStoredAbTests([makeTest()], storePath);
			let releaseLookup!: () => void;
			let lookupStarted!: () => void;
			const waitingForLookup = new Promise<void>((resolve) => { lookupStarted = resolve; });
			const lookupGate = new Promise<void>((resolve) => { releaseLookup = resolve; });
			const client = { subscriber: { list: async () => {
				lookupStarted();
				await lookupGate;
				return { data: { results: [{ uuid: SUBSCRIBER_UUID }] } };
			} } } as unknown as ListmonkClient;
			const recording = recordAbTestConversion(client, makeEvent(), storePath);
			await waitingForLookup;
			let deletionFinished = false;
			const deletion = saveStoredAbTests([], storePath).then(() => { deletionFinished = true; });
			await Bun.sleep(25);
			expect(deletionFinished).toBe(false);
			releaseLookup();
			expect(await recording).toBe("created");
			await deletion;
			expect(await loadStoredAbTests(storePath)).toEqual([]);
			await expect(recordAbTestConversion(client, makeEvent({ eventId: "after-delete" }), storePath)).rejects.toThrow("not provisioned");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
