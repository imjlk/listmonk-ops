import { describe, expect, it, mock } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	AbTestMetricsUnavailableError,
	ListmonkMetricsCollector,
	SimulatedMetricsCollector,
} from "../src/metrics";
import type { AbTest } from "../src/types";

function makeTest(overrides: Partial<AbTest> = {}): AbTest {
	return {
		id: "test-1",
		name: "Test 1",
		status: "running",
		baseConfig: {
			subject: "s",
			body: "b",
			lists: [1],
			template_id: 1,
		},
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
		testListMappings: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		variants: [
			{
				id: "A",
				name: "A",
				percentage: 50,
				contentOverrides: {},
			},
			{
				id: "B",
				name: "B",
				percentage: 50,
				contentOverrides: {},
			},
		],
		...overrides,
	} as AbTest;
}

function makeCampaign(campaignId: number, sent: number, views: number, clicks: number) {
	return {
		id: campaignId,
		sent,
		views,
		clicks,
		name: `Campaign ${campaignId}`,
		status: "finished",
	};
}

describe("ListmonkMetricsCollector", () => {
	it("collects sent/views/clicks per variant", async () => {
		const getById = mock(async ({ path }: { path: { id: number } }) => ({
			data: makeCampaign(path.id, 100, 30, 10),
		}));
		const client = { campaign: { getById } } as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		const results = await collector.collect(makeTest());
		expect(results).toHaveLength(2);
		expect(results[0]).toMatchObject({
			variantId: "A",
			sampleSize: 100,
			opens: 30,
			clicks: 10,
			openRate: 30,
			clickRate: 10,
		});
	});

	it("does not copy clicks into conversions", async () => {
		const getById = mock(async ({ path }: { path: { id: number } }) => ({
			data: makeCampaign(path.id, 100, 30, 10),
		}));
		const client = { campaign: { getById } } as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		const results = await collector.collect(makeTest());
		for (const r of results) {
			expect(r.conversions).toBe(0);
			expect(r.conversionRate).toBe(0);
		}
	});

	it("throws AbTestMetricsUnavailableError when a fetch fails", async () => {
		const getById = mock(async () => {
			throw new Error("boom");
		});
		const client = { campaign: { getById } } as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		await expect(collector.collect(makeTest())).rejects.toBeInstanceOf(
			AbTestMetricsUnavailableError,
		);
	});

	it("throws AbTestMetricsUnavailableError when the response carries an error", async () => {
		const getById = mock(async () => ({ error: "not found" }));
		const client = { campaign: { getById } } as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		await expect(collector.collect(makeTest())).rejects.toBeInstanceOf(
			AbTestMetricsUnavailableError,
		);
	});

	it("throws when the test has no campaign mappings", async () => {
		const getById = mock(async () => ({ data: {} }));
		const client = { campaign: { getById } } as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		await expect(
			collector.collect(makeTest({ campaignMappings: [] })),
		).rejects.toBeInstanceOf(AbTestMetricsUnavailableError);
		// and the getById was never called
		expect(getById).not.toHaveBeenCalled();
	});

	it("aborts collection on the first failing campaign without partial results", async () => {
		const callCount = { value: 0 };
		const getById = mock(async ({ path }: { path: { id: number } }) => {
			callCount.value += 1;
			if (path.id === 101) {
				throw new Error("second campaign failed");
			}
			return { data: makeCampaign(path.id, 100, 30, 10) };
		});
		const client = { campaign: { getById } } as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		await expect(collector.collect(makeTest())).rejects.toBeInstanceOf(
			AbTestMetricsUnavailableError,
		);
		// Only the first campaign was fetched before the throw.
		expect(callCount.value).toBe(2);
	});

	it("treats missing sent/views/clicks as zero without throwing", async () => {
		const getById = mock(async ({ path }: { path: { id: number } }) => ({
			data: { id: path.id }, // no sent/views/clicks fields
		}));
		const client = { campaign: { getById } } as unknown as ListmonkClient;
		const collector = new ListmonkMetricsCollector(client);
		const results = await collector.collect(makeTest());
		expect(results[0]).toMatchObject({
			sampleSize: 0,
			opens: 0,
			clicks: 0,
			openRate: 0,
			clickRate: 0,
		});
	});
});

describe("SimulatedMetricsCollector", () => {
	it("returns registered results without falling back to random data", async () => {
		const fixture = [
			{
				variantId: "A",
				sampleSize: 100,
				opens: 50,
				clicks: 10,
				conversions: 0,
				openRate: 50,
				clickRate: 10,
				conversionRate: 0,
			},
		];
		const collector = new SimulatedMetricsCollector(
			new Map([["test-1", fixture]]),
		);
		const results = await collector.collect(makeTest());
		expect(results).toEqual(fixture);
	});

	it("returns deep copies so callers cannot mutate the registered fixture", async () => {
		const fixture = [
			{
				variantId: "A",
				sampleSize: 100,
				opens: 50,
				clicks: 10,
				conversions: 0,
				openRate: 50,
				clickRate: 10,
				conversionRate: 0,
			},
		];
		const map = new Map([["test-1", fixture]]);
		const collector = new SimulatedMetricsCollector(map);
		const results = await collector.collect(makeTest());
		results[0].clicks = 999;
		expect(fixture[0].clicks).toBe(10);
		expect(map.get("test-1")?.[0].clicks).toBe(10);
	});

	it("throws when no fixture is registered for the test", async () => {
		const collector = new SimulatedMetricsCollector(new Map());
		await expect(collector.collect(makeTest())).rejects.toBeInstanceOf(
			AbTestMetricsUnavailableError,
		);
	});
});
