import {
	verifyHypothesisChecksum,
	type HypothesisMetadata,
} from "./hypothesis";
import type { AbTest, StatisticalAnalysis, TestResults } from "./types";

/**
 * Generate a human-readable experiment report from test analysis results.
 *
 * The report is available in two formats:
 * - Markdown: for CLI output and operator reading.
 * - JSON: for programmatic consumption and MCP tool responses.
 *
 * When a pre-registered hypothesis is present, the report uses its declared
 * primary metric and direction rather than inferring them from observed
 * data. The pre-registration checksum is verified and the result is shown
 * as "verified", "not_available", or "checksum_mismatch".
 *
 * Subscriber identifiers are never included — the report contains only
 * aggregate metrics, statistical results, and test metadata.
 */

export type PreRegistrationStatus =
	| "verified"
	| "not_available"
	| "checksum_mismatch";

export interface ExperimentReport {
	testId: string;
	testName: string;
	status: AbTest["status"];
	confidenceLevel: number;
	primaryMetric: string;
	/** When a hypothesis is pre-registered, its declared direction. */
	primaryMetricDirection?: "maximize" | "minimize";
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
		revenue?: number;
		revenuePerRecipient?: number;
	}>;
	srmPassed?: boolean;
	srmPValue?: number;
	fixedHorizonReasonCodes?: string[];
	hypothesis?: {
		objective: string;
		primaryMetricType: string;
		direction: "maximize" | "minimize";
		expectedLift: {
			kind: "relative" | "absolute";
			value: number;
			unit?: "percentage_point" | "currency_per_recipient";
		};
	};
	preRegistration: PreRegistrationStatus;
}

/**
 * Determine the pre-registration status from a test's hypothesis metadata.
 * Returns "verified" when the checksum matches, "checksum_mismatch" when it
 * does not, and "not_available" when no hypothesis is present.
 */
export function evaluatePreRegistration(
	hypothesis?: HypothesisMetadata,
): PreRegistrationStatus {
	if (!hypothesis) return "not_available";
	if (!hypothesis.lockedAt || !hypothesis.checksum) return "not_available";
	return verifyHypothesisChecksum(hypothesis)
		? "verified"
		: "checksum_mismatch";
}

/**
 * Pick the metric rate function and label from a pre-registered hypothesis,
 * falling back to the observed-data heuristic when no hypothesis is present.
 */
function pickPrimaryMetric(
	hypothesis: HypothesisMetadata | undefined,
	results: TestResults[],
): { metric: string; direction: "maximize" | "minimize" } {
	if (hypothesis) {
		return {
			metric: hypothesis.primaryMetric.type,
			direction: hypothesis.primaryMetric.direction,
		};
	}
	// Legacy fallback: prefer conversion rate when any conversions are
	// observed, otherwise default to click rate. Direction is always
	// maximize in legacy mode.
	const anyConversionMeasured = results.some((r) => r.conversions > 0);
	return {
		metric: anyConversionMeasured ? "conversion_rate" : "click_rate",
		direction: "maximize",
	};
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
			revenue: r.revenue,
			revenuePerRecipient:
				r.revenue !== undefined && r.sampleSize > 0
					? r.revenue / r.sampleSize
					: undefined,
		};
	});

	const { metric: primaryMetric, direction: primaryMetricDirection } =
		pickPrimaryMetric(test.hypothesis, results);

	const preRegistration = evaluatePreRegistration(test.hypothesis);

	return {
		testId: test.id,
		testName: test.name,
		status: test.status,
		confidenceLevel: analysis.confidenceLevel,
		primaryMetric,
		primaryMetricDirection,
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
		hypothesis: test.hypothesis
			? {
					objective: test.hypothesis.objective,
					primaryMetricType: test.hypothesis.primaryMetric.type,
					direction: test.hypothesis.primaryMetric.direction,
					expectedLift: {
						kind: test.hypothesis.expectedLift.kind,
						value: test.hypothesis.expectedLift.value,
						unit:
							test.hypothesis.expectedLift.kind === "absolute"
								? test.hypothesis.expectedLift.unit
								: undefined,
					},
				}
			: undefined,
		preRegistration,
	};
}

/**
 * Escape user-provided strings for safe Markdown interpolation, preventing
 * content injection when the report is rendered to HTML by downstream
 * consumers.
 */
function escapeMarkdown(s: string): string {
	return s.replace(/[`*|\[\]<>\\\n\r]/g, (c) => {
		if (c === "\n") return "\\n";
		if (c === "\r") return "\\r";
		return `\\${c}`;
	});
}

export function reportToMarkdown(report: ExperimentReport): string {
	const lines: string[] = [];

	lines.push(`# A/B Test Report: ${report.testName}`);
	lines.push("");
	lines.push(`- **Test ID**: ${report.testId}`);
	lines.push(`- **Status**: ${report.status}`);
	lines.push(`- **Primary Metric**: ${report.primaryMetric}`);
	if (report.primaryMetricDirection) {
		lines.push(
			`- **Direction**: ${report.primaryMetricDirection === "maximize" ? "Maximize" : "Minimize"}`,
		);
	}
	lines.push(
		`- **Confidence Level**: ${(report.confidenceLevel * 100).toFixed(1)}%`,
	);
	lines.push(
		`- **Pre-Registration**: ${preRegistrationLabel(report.preRegistration)}`,
	);
	if (report.startedAt) {
		lines.push(`- **Started**: ${report.startedAt}`);
	}
	if (report.endsAt) {
		lines.push(`- **Ends**: ${report.endsAt}`);
	}
	lines.push("");

	if (report.hypothesis) {
		lines.push("## Hypothesis");
		lines.push("");
		lines.push(
			`- **Objective**: ${escapeMarkdown(report.hypothesis.objective)}`,
		);
		lines.push(`- **Primary Metric**: ${report.hypothesis.primaryMetricType}`);
		lines.push(`- **Direction**: ${report.hypothesis.direction}`);
		const lift = report.hypothesis.expectedLift;
		if (lift.kind === "relative") {
			lines.push(
				`- **Expected Lift**: ${(lift.value * 100).toFixed(1)}% relative`,
			);
		} else {
			if (lift.unit) {
				lines.push(
					`- **Expected Lift**: ${lift.value} ${lift.unit} (absolute)`,
				);
			} else {
				lines.push(`- **Expected Lift**: ${lift.value} (absolute)`);
			}
		}
		lines.push("");
	}

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
	const hasRevenue = report.variants.some((v) => v.revenue !== undefined);
	const headers = [
		"Variant",
		"Sample",
		"Open Rate",
		"Click Rate",
		"Conversion Rate",
	];
	if (hasRevenue) {
		headers.push("Revenue", "Rev/Recipient");
	}
	lines.push(`| ${headers.join(" | ")} |`);
	lines.push(`|${headers.map(() => "---------").join("|")}|`);
	for (const v of report.variants) {
		const cells = [
			v.variantName,
			String(v.sampleSize),
			`${v.openRate.toFixed(2)}%`,
			`${v.clickRate.toFixed(2)}%`,
			`${v.conversionRate.toFixed(2)}%`,
		];
		if (hasRevenue) {
			cells.push(
				v.revenue?.toFixed(2) ?? "N/A",
				v.revenuePerRecipient?.toFixed(4) ?? "N/A",
			);
		}
		lines.push(`| ${cells.join(" | ")} |`);
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

	if (report.preRegistration === "checksum_mismatch") {
		lines.push("");
		lines.push(
			"> ⚠️ Pre-registration checksum mismatch: the hypothesis metadata may have been tampered with after locking.",
		);
	}

	return lines.join("\n");
}

function preRegistrationLabel(status: PreRegistrationStatus): string {
	switch (status) {
		case "verified":
			return "Verified";
		case "checksum_mismatch":
			return "Checksum Mismatch";
		case "not_available":
			return "Not Available";
	}
}

export function reportToJSON(report: ExperimentReport): string {
	return JSON.stringify(report, null, 2);
}
