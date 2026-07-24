/**
 * Advanced statistical methods for A/B test analysis.
 *
 * Stage 4 hardening: Holm-Bonferroni multiple-comparison correction,
 * fixed-horizon eligibility gate, and Sample Ratio Mismatch (SRM) detection.
 *
 * These are pure functions — no I/O, no side effects — so they can be
 * unit-tested without a live Listmonk or conversion event store.
 */

export interface StatisticalPolicy {
	confidenceLevel: number;
	minimumSamplePerVariant: number;
	minimumDurationHours: number;
	multipleComparison: "holm" | "bonferroni";
	analysisMode: "fixed_horizon";
	srmAlpha: number;
}

export const DEFAULT_STATISTICAL_POLICY: StatisticalPolicy = {
	confidenceLevel: 0.95,
	minimumSamplePerVariant: 100,
	minimumDurationHours: 24,
	multipleComparison: "holm",
	analysisMode: "fixed_horizon",
	srmAlpha: 0.001,
};

export interface HolmCorrectionResult {
	/** Original p-values in the order they were passed in. */
	originalPValues: number[];
	/** Adjusted p-values (Holm-Bonferroni step-down) in the same order. */
	adjustedPValues: number[];
	/** Whether each p-value is significant after correction. */
	significant: boolean[];
	/** The family-wise alpha used. */
	alpha: number;
}

/**
 * Apply the Holm-Bonferroni step-down correction to a family of p-values.
 *
 * Algorithm:
 *  1. Sort p-values ascending, tracking original indices.
 *  2. For rank i (0-based) out of m total, the threshold is alpha / (m - i).
 *  3. Walk from smallest to largest. Once one p-value fails its threshold,
 *     all subsequent ones are non-significant.
 *  4. Map results back to original order.
 *
 * Returns adjusted p-values, significance flags, and the family-wise alpha.
 */
export function applyHolmCorrection(
	pValues: number[],
	alpha: number,
): HolmCorrectionResult {
	if (pValues.length === 0) {
		return {
			originalPValues: [],
			adjustedPValues: [],
			significant: [],
			alpha,
		};
	}

	if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
		throw new Error(
			`alpha must be a finite number in (0, 1), received ${alpha}`,
		);
	}

	const m = pValues.length;
	const indexed = pValues.map((p, originalIndex) => ({ p, originalIndex }));
	indexed.sort((a, b) => a.p - b.p);

	const adjustedSorted = new Array<number>(m);
	const significantSorted = new Array<boolean>(m);
	let stopRejecting = false;

	for (let rank = 0; rank < m; rank += 1) {
		const entry = indexed[rank];
		if (entry === undefined) continue;
		const threshold = alpha / (m - rank);
		// Adjusted p-value: max of previous adjusted and min(1, p * (m - rank))
		const rawAdjusted = Math.min(1, entry.p * (m - rank));
		const prevAdjusted = rank > 0 ? (adjustedSorted[rank - 1] ?? 0) : 0;
		adjustedSorted[rank] = Math.max(rawAdjusted, prevAdjusted);

		if (stopRejecting || entry.p >= threshold) {
			significantSorted[rank] = false;
			stopRejecting = true;
		} else {
			significantSorted[rank] = true;
		}
	}

	// Map back to original order
	const adjustedPValues = new Array<number>(m);
	const significant = new Array<boolean>(m);
	for (let rank = 0; rank < m; rank += 1) {
		const entry = indexed[rank];
		if (entry === undefined) continue;
		adjustedPValues[entry.originalIndex] = adjustedSorted[rank] ?? 1;
		significant[entry.originalIndex] = significantSorted[rank] ?? false;
	}

	return {
		originalPValues: [...pValues],
		adjustedPValues,
		significant,
		alpha,
	};
}

export interface FixedHorizonGateResult {
	ready: boolean;
	reasonCodes: string[];
}

/**
 * Check whether a test has met the fixed-horizon eligibility criteria
 * before computing p-values or declaring a winner.
 *
 * Criteria (all must pass):
 *  1. endsAt is set and now >= endsAt (or explicit exposure target met).
 *  2. minimumDurationHours has elapsed since startedAt.
 *  3. Every variant has at least minimumSamplePerVariant.
 *
 * Returns { ready: true } or { ready: false, reasonCodes: [...] }.
 */
export function fixedHorizonGate(params: {
	endsAt?: string;
	startedAt?: string;
	now: number;
	policy: StatisticalPolicy;
	sampleSizes: number[];
}): FixedHorizonGateResult {
	const { endsAt, startedAt, now, policy, sampleSizes } = params;
	const reasonCodes: string[] = [];

	// 1. Fixed horizon: endsAt must be set and passed.
	if (!endsAt) {
		reasonCodes.push("no_endsAt");
	} else {
		const endsAtMs = new Date(endsAt).getTime();
		if (Number.isNaN(endsAtMs)) {
			reasonCodes.push("malformed_endsAt");
		} else if (now < endsAtMs) {
			reasonCodes.push("before_endsAt");
		}
	}

	// 2. Minimum duration elapsed.
	if (startedAt) {
		const elapsedHours =
			(now - new Date(startedAt).getTime()) / (3600 * 1000);
		if (elapsedHours < policy.minimumDurationHours) {
			reasonCodes.push(
				`minimum_duration_not_met:${elapsedHours.toFixed(1)}h/${policy.minimumDurationHours}h`,
			);
		}
	} else {
		reasonCodes.push("no_startedAt");
	}

	// 3. Minimum sample per variant.
	for (const [index, size] of sampleSizes.entries()) {
		if (size < policy.minimumSamplePerVariant) {
			reasonCodes.push(
				`minimum_sample_not_met:variant_${index}:${size}/${policy.minimumSamplePerVariant}`,
			);
		}
	}

	return {
		ready: reasonCodes.length === 0,
		reasonCodes,
	};
}

export interface SRMCheckResult {
	/** True if the sample ratio is consistent with expectations. */
	passed: boolean;
	/** Chi-square statistic. */
	chiSquare: number;
	/** p-value from the chi-square distribution. */
	pValue: number;
	/**
	 * Distinct from `passed`: "pass" (ratios consistent), "fail" (SRM
	 * detected), or "indeterminate" (data quality issue — cannot run
	 * the check). Callers should check `status` rather than `passed`
	 * alone to distinguish genuine SRM from input errors.
	 */
	status: "pass" | "fail" | "indeterminate";
	/** Reason code if the check could not be completed. */
	reasonCode?: string;
}

/**
 * Chi-square critical values keyed by `df:alpha`. Covers df 1-2 (up to
 * 3 variants) at the three standard alpha levels. Avoids pulling in a
 * full chi-square CDF implementation.
 */
const CHI_SQUARE_CRITICAL: Record<string, number> = {
	// df=1
	"1:0.001": 10.828,
	"1:0.01": 6.635,
	"1:0.05": 3.841,
	// df=2
	"2:0.001": 13.816,
	"2:0.01": 9.210,
	"2:0.05": 5.991,
};

/**
 * Detect Sample Ratio Mismatch (SRM) by comparing expected assignment
 * ratios against observed successful-sent ratios using a chi-square
 * goodness-of-fit test.
 *
 * @param expected - Expected counts per variant (from the assignment manifest).
 * @param observed - Observed counts per variant (e.g., successful sends).
 * @param alpha - Significance level for the SRM test (default 0.001).
 */
export function checkSRM(
	expected: number[],
	observed: number[],
	alpha: number = 0.001,
): SRMCheckResult {
	if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
		throw new Error(
			`alpha must be a finite number in (0, 1), received ${alpha}`,
		);
	}
	if (expected.length !== observed.length || expected.length < 2) {
		return {
			passed: false,
			status: "indeterminate" as const,
			chiSquare: 0,
			pValue: 1,
			reasonCode: "invalid_input",
		};
	}

	const expectedSum = expected.reduce((s, v) => s + v, 0);
	const observedSum = observed.reduce((s, v) => s + v, 0);

	if (expectedSum === 0 || observedSum === 0) {
		return {
			passed: false,
			status: "indeterminate" as const,
			chiSquare: 0,
			pValue: 1,
			reasonCode: "insufficient_sample",
		};
	}

	// Scale expected to match observed total for the goodness-of-fit test.
	const chiSquare = expected.reduce((sum, expVal, i) => {
		const scaledExpected = (expVal / expectedSum) * observedSum;
		const obsVal = observed[i] ?? 0;
		if (scaledExpected === 0) {
			// Traffic in an arm with zero expected count is a provisioning
			// error, not a silent pass.
			return obsVal > 0 ? sum + obsVal : sum;
		}
		return sum + ((obsVal - scaledExpected) ** 2) / scaledExpected;
	}, 0);

	// df = number of groups - 1
	const df = expected.length - 1;

	// Use df-specific critical values from the precomputed table. For
	// unsupported (df, alpha) combos, fall back to df=1:alpha which is
	// the most common case.
	const lookupKey = `${df}:${alpha}`;
	const fallbackKey = `1:${alpha}`;
	const criticalValue =
		CHI_SQUARE_CRITICAL[lookupKey] ??
		CHI_SQUARE_CRITICAL[fallbackKey] ??
		CHI_SQUARE_CRITICAL["1:0.001"] ??
		10.828;

	const passed = chiSquare < criticalValue;

	// Approximate p-value using the Wilson-Hilferty normal approximation
	// to the chi-square distribution: for df degrees of freedom,
	// z ≈ ((chiSquare / df)^(1/3) - (1 - 2/(9*df))) / sqrt(2/(9*df))
	// This is more accurate than the raw sqrt approach for df > 1.
	const wilsonHilfertyTerm = 1 - 2 / (9 * df);
	const wilsonStd = Math.sqrt(2 / (9 * df));
	const ratio = chiSquare / df;
	let pValue: number;
	if (ratio <= 0 || !Number.isFinite(ratio)) {
		pValue = 1;
	} else {
		const zWH =
			(Math.pow(ratio, 1 / 3) - wilsonHilfertyTerm) / wilsonStd;
		pValue = 2 * (1 - normalCDF(Math.abs(zWH)));
	}

	return {
		passed,
		status: (passed ? "pass" : "fail") as "pass" | "fail",
		chiSquare,
		pValue,
		reasonCode: passed ? undefined : "srm_detected",
	};
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun 7.1.26).
 * Phi(x) = 0.5 * (1 + erf(x / sqrt(2))).
 */
function normalCDF(x: number): number {
	const a1 = 0.254829592;
	const a2 = -0.284496736;
	const a3 = 1.421413741;
	const a4 = -1.453152027;
	const a5 = 1.061405429;
	const p = 0.3275911;

	// erf approximation on x / sqrt(2)
	const z = x / Math.sqrt(2);
	const sign = z >= 0 ? 1 : -1;
	const absZ = Math.abs(z);

	const t = 1.0 / (1.0 + p * absZ);
	const y =
		1.0 -
		((((a5 * t + a4) * t + a3) * t + a2) * t + a1) *
			t *
			Math.exp(-absZ * absZ);

	return 0.5 * (1.0 + sign * y);
}
