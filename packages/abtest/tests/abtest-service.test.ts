import { describe, expect, it } from "bun:test";
import { AbTestService } from "../src/abtest-service";
import { SimulatedMetricsCollector } from "../src/metrics";
import { AbTestMetricsUnavailableError } from "../src/metrics";
import type { AbTest, TestResults } from "../src/types";

function makeResults(overrides: Partial<TestResults>[] = []): TestResults[] {
	const base: TestResults[] = [
		{
			variantId: "A",
			sampleSize: 1000,
			opens: 500,
			clicks: 50,
			conversions: 0,
			openRate: 50,
			clickRate: 5,
			conversionRate: 0,
		},
		{
			variantId: "B",
			sampleSize: 1000,
			opens: 520,
			clicks: 80,
			conversions: 0,
			openRate: 52,
			clickRate: 8,
			conversionRate: 0,
		},
	];
	return overrides.length === 0 ? base : (overrides as TestResults[]);
}

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
		// Fixed-horizon gate: set past endsAt and sufficient startedAt so
		// analyzeTest does not suppress the winner.
		startedAt: "2026-07-01T00:00:00Z",
		endsAt: "2026-07-23T00:00:00Z",
		campaignMappings: [
			{ variantId: "A", campaignId: 100 },
			{ variantId: "B", campaignId: 101 },
		],
		testListMappings: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		variants: [
			{ id: "A", name: "A", percentage: 50, contentOverrides: {} },
			{ id: "B", name: "B", percentage: 50, contentOverrides: {} },
		],
		...overrides,
	} as AbTest;
}

describe("AbTestService.analyzeStatisticalSignificance", () => {
	it("reflects the stored confidenceThreshold in alpha", async () => {
		const service = new AbTestService();
		// Boundary data: A 5%, B 7% at n=1000. Pooled p=0.06, se ~= 0.0105,
		// z ~= 1.90, two-tailed p ~= 0.057. So significant at alpha=0.10
		// (90% confidence) but not at alpha=0.05 (95%) nor alpha=0.01 (99%).
		const results: TestResults[] = [
			{
				variantId: "A",
				sampleSize: 1000,
				opens: 0,
				clicks: 50,
				conversions: 0,
				openRate: 0,
				clickRate: 5,
				conversionRate: 0,
			},
			{
				variantId: "B",
				sampleSize: 1000,
				opens: 0,
				clicks: 70,
				conversions: 0,
				openRate: 0,
				clickRate: 7,
				conversionRate: 0,
			},
		];
		const at90 = await service.analyzeStatisticalSignificance(results, 0.90);
		const at95 = await service.analyzeStatisticalSignificance(results, 0.95);
		const at99 = await service.analyzeStatisticalSignificance(results, 0.99);
		expect(at90.confidenceLevel).toBe(0.9);
		expect(at95.confidenceLevel).toBe(0.95);
		expect(at99.confidenceLevel).toBe(0.99);
		// p ~= 0.057: significant at alpha=0.10 only.
		expect(at90.isSignificant).toBe(true);
		expect(at95.isSignificant).toBe(false);
		expect(at99.isSignificant).toBe(false);
	});

	it("defaults to 0.95 when no threshold is passed", async () => {
		const service = new AbTestService();
		const analysis = await service.analyzeStatisticalSignificance(makeResults());
		expect(analysis.confidenceLevel).toBe(0.95);
	});

	it("rejects an out-of-range confidenceThreshold", async () => {
		const service = new AbTestService();
		await expect(
			service.analyzeStatisticalSignificance(makeResults(), 0),
		).rejects.toThrow();
		await expect(
			service.analyzeStatisticalSignificance(makeResults(), 1),
		).rejects.toThrow();
		await expect(
			service.analyzeStatisticalSignificance(makeResults(), Number.NaN),
		).rejects.toThrow();
	});

	it("compares control against the true second-best when control is best", async () => {
		// Control A has the highest click rate; B is second; the test should
		// compare A vs B (the true second-best), not the first non-control
		// that happens to appear.
		const service = new AbTestService();
		const results: TestResults[] = [
			{
				variantId: "A",
				sampleSize: 1000,
				opens: 0,
				clicks: 100,
				conversions: 0,
				openRate: 0,
				clickRate: 10,
				conversionRate: 0,
			},
			{
				variantId: "B",
				sampleSize: 1000,
				opens: 0,
				clicks: 80,
				conversions: 0,
				openRate: 0,
				clickRate: 8,
				conversionRate: 0,
			},
			{
				variantId: "C",
				sampleSize: 1000,
				opens: 0,
				clicks: 10,
				conversions: 0,
				openRate: 0,
				clickRate: 1,
				conversionRate: 0,
			},
		];
		const analysis = await service.analyzeStatisticalSignificance(results, 0.95);
		// The Z-test between A(10%) and B(8%) at n=1000 is significant; if we
		// had compared A against C (1%) the z-score would be much larger.
		// A vs B pooled: p=(100+80)/2000=0.09, se=sqrt(0.09*0.91*2/1000)=~0.0128
		// z=(0.10-0.08)/0.0128 ~= 1.56 -> p ~= 0.118 -> NOT significant at 0.95.
		expect(analysis.isSignificant).toBe(false);
		expect(analysis.zScore).toBeGreaterThan(1.5);
		expect(analysis.zScore).toBeLessThan(1.7);
	});
});

describe("AbTestService.getTestResults", () => {
	it("returns simulated results when a MetricsCollector is injected", async () => {
		const fixture = makeResults();
		const service = new AbTestService(
			undefined,
			new SimulatedMetricsCollector(new Map([["test-1", fixture]])),
		);
		service.hydrateTests([makeTest()]);
		const results = await service.getTestResults("test-1");
		expect(results).toEqual(fixture);
	});

	it("throws AbTestMetricsUnavailableError when no collector and no integration is configured", async () => {
		const service = new AbTestService();
		service.hydrateTests([makeTest()]);
		await expect(service.getTestResults("test-1")).rejects.toBeInstanceOf(
			AbTestMetricsUnavailableError,
		);
	});

	it("does not produce random mock data when metrics are unavailable", async () => {
		const service = new AbTestService();
		service.hydrateTests([makeTest()]);
		try {
			await service.getTestResults("test-1");
			throw new Error("expected getTestResults to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(AbTestMetricsUnavailableError);
			// Confirm the error is not silently swallowed into random data.
		}
	});
});

describe("AbTestService.analyzeTest", () => {
	it("passes the test's confidenceThreshold through to the significance test", async () => {
		const fixture = makeResults();
		const service = new AbTestService(
			undefined,
			new SimulatedMetricsCollector(new Map([["test-1", fixture]])),
		);
		service.hydrateTests([makeTest({ confidenceThreshold: 0.99 })]);
		const analysis = await service.analyzeTest("test-1");
		expect(analysis.analysis.confidenceLevel).toBe(0.99);
	});

	it("selects the winner by click rate when no conversions are measured", async () => {
		// B has the higher click rate (8% vs 5%); with conversions=0 everywhere
		// the winner must come from click rate, not a 0% tie.
		const fixture = makeResults();
		const service = new AbTestService(
			undefined,
			new SimulatedMetricsCollector(new Map([["test-1", fixture]])),
		);
		service.hydrateTests([makeTest()]);
		const analysis = await service.analyzeTest("test-1");
		// n=1000, A 5%, B 8% -> z ~= 2.13, p ~= 0.033 -> significant at 0.95.
		expect(analysis.analysis.isSignificant).toBe(true);
		expect(analysis.winner?.id).toBe("B");
	});
});
