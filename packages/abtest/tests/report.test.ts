import { describe, expect, it } from "bun:test";
import {
	buildExperimentReport,
	reportToMarkdown,
	reportToJSON,
} from "../src/report";
import type { AbTest, StatisticalAnalysis, TestResults } from "../src/types";

function makeTest(): AbTest {
	return {
		id: "test-1",
		name: "Subject Line Test",
		campaignId: "camp-1",
		variants: [
			{ id: "A", name: "Control", percentage: 50, contentOverrides: {} },
			{ id: "B", name: "Variant B", percentage: 50, contentOverrides: {} },
		],
		status: "completed",
		metrics: [],
		createdAt: new Date("2026-07-01T00:00:00Z"),
		updatedAt: new Date("2026-07-24T00:00:00Z"),
		baseConfig: { subject: "s", body: "b", lists: [1], template_id: 1 },
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 100,
		holdoutGroupSize: 900,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [],
		testListMappings: [],
		startedAt: "2026-07-01T00:00:00Z",
		endsAt: "2026-07-23T00:00:00Z",
	} as AbTest;
}

function makeResults(): TestResults[] {
	return [
		{
			variantId: "A",
			sampleSize: 1000,
			opens: 300,
			clicks: 50,
			conversions: 0,
			openRate: 30,
			clickRate: 5,
			conversionRate: 0,
		},
		{
			variantId: "B",
			sampleSize: 1000,
			opens: 350,
			clicks: 80,
			conversions: 0,
			openRate: 35,
			clickRate: 8,
			conversionRate: 0,
		},
	];
}

function makeAnalysis(): StatisticalAnalysis {
	return {
		zScore: 2.13,
		pValue: 0.033,
		isSignificant: true,
		confidenceLevel: 0.95,
		sampleSize: 2000,
		srmPassed: true,
		srmPValue: 0.85,
	};
}

describe("buildExperimentReport", () => {
	it("builds a report with test metadata", () => {
		const report = buildExperimentReport(
			makeTest(),
			makeAnalysis(),
			makeResults(),
		);
		expect(report.testId).toBe("test-1");
		expect(report.testName).toBe("Subject Line Test");
		expect(report.status).toBe("completed");
		expect(report.primaryMetric).toBe("click_rate");
	});

	it("includes variant results", () => {
		const report = buildExperimentReport(
			makeTest(),
			makeAnalysis(),
			makeResults(),
		);
		expect(report.variants).toHaveLength(2);
		expect(report.variants[0]?.variantName).toBe("Control");
	});

	it("includes SRM and fixed-horizon fields", () => {
		const report = buildExperimentReport(
			makeTest(),
			{ ...makeAnalysis(), srmPassed: false, srmPValue: 0.0001 },
			makeResults(),
		);
		expect(report.srmPassed).toBe(false);
		expect(report.srmPValue).toBe(0.0001);
	});
});

describe("reportToMarkdown", () => {
	it("generates a markdown report with header", () => {
		const report = buildExperimentReport(
			makeTest(),
			makeAnalysis(),
			makeResults(),
		);
		const md = reportToMarkdown(report);
		expect(md).toContain("# A/B Test Report: Subject Line Test");
		expect(md).toContain("**Test ID**: test-1");
		expect(md).toContain("**Primary Metric**: click_rate");
	});

	it("includes variant table", () => {
		const report = buildExperimentReport(
			makeTest(),
			makeAnalysis(),
			makeResults(),
		);
		const md = reportToMarkdown(report);
		expect(md).toContain("| Variant | Sample |");
		expect(md).toContain("Control");
		expect(md).toContain("Variant B");
	});

	it("includes Holm corrected p-value when present", () => {
		const report = buildExperimentReport(
			makeTest(),
			{
				...makeAnalysis(),
				correctedPValue: 0.04,
				holmCorrected: true,
			},
			makeResults(),
		);
		const md = reportToMarkdown(report);
		expect(md).toContain("Corrected P-Value (Holm)");
		expect(md).toContain("Holm Corrected");
	});

	it("shows no-winner message when not significant", () => {
		const report = buildExperimentReport(
			makeTest(),
			{ ...makeAnalysis(), isSignificant: false },
			makeResults(),
		);
		const md = reportToMarkdown(report);
		expect(md).toContain("No significant winner");
	});

	it("does not contain subscriber identifiers", () => {
		const report = buildExperimentReport(
			makeTest(),
			makeAnalysis(),
			makeResults(),
		);
		const md = reportToMarkdown(report);
		expect(md).not.toContain("uuid-");
		expect(md).not.toContain("@");
		expect(md).not.toContain("email");
	});
});

describe("reportToJSON", () => {
	it("produces valid JSON", () => {
		const report = buildExperimentReport(
			makeTest(),
			makeAnalysis(),
			makeResults(),
		);
		const json = reportToJSON(report);
		const parsed = JSON.parse(json);
		expect(parsed.testId).toBe("test-1");
		expect(parsed.variants).toHaveLength(2);
	});
});
