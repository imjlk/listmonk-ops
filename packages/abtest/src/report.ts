import type { AbTest, StatisticalAnalysis, TestResults } from "./types";

/**
 * Generate a human-readable experiment report from test analysis results.
 *
 * The report is available in two formats:
 * - Markdown: for CLI output and operator reading.
 * - JSON: for programmatic consumption and MCP tool responses.
 *
 * Subscriber identifiers are never included — the report contains only
 * aggregate metrics, statistical results, and test metadata.
 */

export interface ExperimentReport {
	testId: string;
	testName: string;
	status: AbTest["status"];
	confidenceLevel: number;
	primaryMetric: string;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	endsAt?: string;
	winnerVariantId?: string;
	analysis: StatisticalAnalysis;
	variants: Array<{
		variantId: string;
		variantName: string;
		sampleSize: number;
		clickRate: number;
		conversionRate: number;
		openRate: number;
	}>;
	srmPassed?: boolean;
	srmPValue?: number;
	fixedHorizonReasonCodes?: string[];
}

export function buildExperimentReport(
	test: AbTest,
	analysis: StatisticalAnalysis,
	results: TestResults[],
): ExperimentReport {
	const variants = results.map((r) => {
		const variant = test.variants.find((v) => v.id === r.variantId);
		return {
			variantId: r.variantId,
			variantName: variant?.name ?? r.variantId,
			sampleSize: r.sampleSize,
			clickRate: r.clickRate,
			conversionRate: r.conversionRate,
			openRate: r.openRate,
		};
	});

	const anyConversionMeasured = results.some((r) => r.conversions > 0);

	return {
		testId: test.id,
		testName: test.name,
		status: test.status,
		confidenceLevel: analysis.confidenceLevel,
		primaryMetric: anyConversionMeasured
			? "conversion_rate"
			: "click_rate",
		createdAt: test.createdAt.toISOString(),
		updatedAt: test.updatedAt.toISOString(),
		startedAt: test.startedAt,
		endsAt: test.endsAt,
		winnerVariantId: test.winnerVariantId,
		analysis,
		variants,
		srmPassed: analysis.srmPassed,
		srmPValue: analysis.srmPValue,
		fixedHorizonReasonCodes: analysis.fixedHorizonReasonCodes,
	};
}

export function reportToMarkdown(report: ExperimentReport): string {
	const lines: string[] = [];

	lines.push(`# A/B Test Report: ${report.testName}`);
	lines.push("");
	lines.push(`- **Test ID**: ${report.testId}`);
	lines.push(`- **Status**: ${report.status}`);
	lines.push(`- **Primary Metric**: ${report.primaryMetric}`);
	lines.push(
		`- **Confidence Level**: ${(report.confidenceLevel * 100).toFixed(1)}%`,
	);
	if (report.startedAt) {
		lines.push(`- **Started**: ${report.startedAt}`);
	}
	if (report.endsAt) {
		lines.push(`- **Ends**: ${report.endsAt}`);
	}
	lines.push("");

	lines.push("## Statistical Analysis");
	lines.push("");
	lines.push(`- **Z-Score**: ${report.analysis.zScore.toFixed(4)}`);
	lines.push(`- **P-Value**: ${report.analysis.pValue.toFixed(6)}`);
	if (report.analysis.correctedPValue !== undefined) {
		lines.push(
			`- **Corrected P-Value (Holm)**: ${report.analysis.correctedPValue.toFixed(6)}`,
		);
	}
	lines.push(
		`- **Significant**: ${report.analysis.isSignificant ? "Yes" : "No"}`,
	);
	if (report.analysis.holmCorrected) {
		lines.push(`- **Holm Corrected**: Yes`);
	}
	if (report.srmPassed !== undefined) {
		lines.push(`- **SRM Check**: ${report.srmPassed ? "Passed" : "Failed"}`);
	}
	if (report.srmPValue !== undefined) {
		lines.push(`- **SRM P-Value**: ${report.srmPValue.toFixed(6)}`);
	}
	if (
		report.fixedHorizonReasonCodes &&
		report.fixedHorizonReasonCodes.length > 0
	) {
		lines.push(
			`- **Fixed-Horizon Issues**: ${report.fixedHorizonReasonCodes.join(", ")}`,
		);
	}
	lines.push("");

	lines.push("## Variant Results");
	lines.push("");
	lines.push("| Variant | Sample | Open Rate | Click Rate | Conversion Rate |");
	lines.push("|---------|--------|-----------|------------|-----------------|");
	for (const v of report.variants) {
		lines.push(
			`| ${v.variantName} | ${v.sampleSize} | ${v.openRate.toFixed(2)}% | ${v.clickRate.toFixed(2)}% | ${v.conversionRate.toFixed(2)}% |`,
		);
	}
	lines.push("");

	if (report.analysis.isSignificant && report.winnerVariantId) {
		const winner = report.variants.find(
			(v) => v.variantId === report.winnerVariantId,
		);
		if (winner) {
			lines.push(`## Winner: ${winner.variantName}`);
		}
	} else if (!report.analysis.isSignificant) {
		lines.push("## No significant winner detected");
		if (
			report.fixedHorizonReasonCodes &&
			report.fixedHorizonReasonCodes.length > 0
		) {
			lines.push("");
			lines.push(
				"> The test may not be ready for analysis. See the fixed-horizon issues above.",
			);
		}
	}

	return lines.join("\n");
}

export function reportToJSON(report: ExperimentReport): string {
	return JSON.stringify(report, null, 2);
}
