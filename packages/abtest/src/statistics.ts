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
 * Throws when alpha is outside (0, 1) or any p-value is not a finite
 * number in [0, 1].
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
	// Fail closed on undefined inputs: NaN compares false against every
	// threshold (so it would be marked significant) and breaks the sort, and
	// coercing it to 1 would turn an upstream defect into a silent
	// "not significant" decision that run/tick would finalize as
	// inconclusive. Refuse the family instead, like an invalid alpha.
	for (const [index, pValue] of pValues.entries()) {
		if (!Number.isFinite(pValue) || pValue < 0 || pValue > 1) {
			throw new RangeError(
				`p-values must be finite numbers in [0, 1], received ${pValue} at index ${index}`,
			);
		}
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
	//    If endsAt is not set (no duration_hours), skip — open-ended test.
	if (endsAt) {
		const endsAtMs = new Date(endsAt).getTime();
		if (Number.isNaN(endsAtMs)) {
			reasonCodes.push("malformed_endsAt");
		} else if (now < endsAtMs) {
			reasonCodes.push("before_endsAt");
		}
	}

	// 2. Minimum duration elapsed.
	if (!startedAt) {
		reasonCodes.push("no_startedAt");
	} else {
		const startedMs = new Date(startedAt).getTime();
		if (Number.isNaN(startedMs)) {
			reasonCodes.push("malformed_startedAt");
		} else {
			const elapsedHours = (now - startedMs) / (3600 * 1000);
			if (elapsedHours < policy.minimumDurationHours) {
				reasonCodes.push(
					`minimum_duration_not_met:${elapsedHours.toFixed(1)}h/${policy.minimumDurationHours}h`,
				);
			}
		}
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
	/** Exact chi-square upper-tail p-value; `passed` is `pValue >= alpha`. */
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
 * Pair expected and observed SRM counts by variant id. Positional pairing
 * breaks when results arrive in a different order than the manifest (for
 * example after a resumed create reconciled campaigns as [B, A, C]): B's
 * delivery would be compared with A's expectation and report a false SRM.
 * Returns undefined unless both sides name the same variants exactly once
 * each, so the caller can fail the check as an input mismatch.
 */
export function pairSrmCountsByVariant(
	expected: ReadonlyArray<{ variantId: string; expectedCount: number }>,
	observed: ReadonlyArray<{ variantId: string; sampleSize: number }>,
): { variantIds: string[]; expected: number[]; observed: number[] } | undefined {
	if (expected.length !== observed.length) {
		return undefined;
	}
	const observedByVariant = new Map<string, number>();
	for (const result of observed) {
		if (observedByVariant.has(result.variantId)) {
			return undefined;
		}
		observedByVariant.set(result.variantId, result.sampleSize);
	}
	const paired = {
		variantIds: [] as string[],
		expected: [] as number[],
		observed: [] as number[],
	};
	for (const group of expected) {
		const observedCount = observedByVariant.get(group.variantId);
		if (observedCount === undefined || paired.variantIds.includes(group.variantId)) {
			return undefined;
		}
		paired.variantIds.push(group.variantId);
		paired.expected.push(group.expectedCount);
		paired.observed.push(observedCount);
	}
	return paired;
}

// Lanczos approximation (g = 7, n = 9) of log Γ, accurate to about 15
// significant digits for the half-integer arguments chi-square uses.
const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS = [
	0.99999999999980993, 676.5203681218851, -1259.1392167224028,
	771.32342877765313, -176.61502916214059, 12.507343278686905,
	-0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const;
const INCOMPLETE_GAMMA_EPSILON = 1e-15;
const INCOMPLETE_GAMMA_MAX_ITERATIONS = 10_000;
// Floor for a vanishing Lentz term (Numerical Recipes' FPMIN): small enough
// to stand in for zero, yet large enough that the next `numerator / c`
// (at most ~MAX_ITERATIONS² / floor ≈ 1e38) cannot overflow. In normal
// iterations c and d stay near b's magnitude, so the floor never binds.
const INCOMPLETE_GAMMA_TINY = 1e-30;

/** Clamp rounding error into [0, 1]; refuse a NaN rather than report it. */
function toProbability(value: number, a: number, x: number): number {
	if (Number.isNaN(value)) {
		throw new RangeError(`incomplete gamma is undefined for a=${a}, x=${x}`);
	}
	return Math.min(1, Math.max(0, value));
}

/** Natural log of Γ(z) for z ≥ 0.5. */
function logGamma(z: number): number {
	const shifted = z - 1;
	let series = 0;
	for (const [index, coefficient] of LANCZOS_COEFFICIENTS.entries()) {
		series += index === 0 ? coefficient : coefficient / (shifted + index);
	}
	const t = shifted + LANCZOS_G + 0.5;
	return (
		0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t +
		Math.log(series)
	);
}

/**
 * Regularized upper incomplete gamma function Q(a, x) = Γ(a, x) / Γ(a) for
 * a ≥ 0.5 and x ≥ 0. Below x = a + 1 it sums the power series for
 * P = 1 − Q; above it, where the series would lose the tail to
 * cancellation, it evaluates Q's continued fraction (modified Lentz), so
 * small upper-tail probabilities keep their relative precision.
 */
export function regularizedUpperGamma(a: number, x: number): number {
	if (!Number.isFinite(a) || a < 0.5) {
		throw new RangeError(`a must be a finite number >= 0.5, received ${a}`);
	}
	if (Number.isNaN(x) || x < 0) {
		throw new RangeError(`x must be a non-negative number, received ${x}`);
	}
	if (x === 0) {
		return 1;
	}
	if (x === Number.POSITIVE_INFINITY) {
		return 0;
	}
	const logPrefactor = a * Math.log(x) - x - logGamma(a);
	if (x < a + 1) {
		let term = 1 / a;
		let sum = term;
		for (
			let index = 1;
			index <= INCOMPLETE_GAMMA_MAX_ITERATIONS;
			index += 1
		) {
			term *= x / (a + index);
			sum += term;
			if (Math.abs(term) < Math.abs(sum) * INCOMPLETE_GAMMA_EPSILON) {
				return toProbability(1 - sum * Math.exp(logPrefactor), a, x);
			}
		}
	} else {
		let b = x + 1 - a;
		let c = 1 / INCOMPLETE_GAMMA_TINY;
		let d = 1 / b;
		let fraction = d;
		for (
			let index = 1;
			index <= INCOMPLETE_GAMMA_MAX_ITERATIONS;
			index += 1
		) {
			const numerator = -index * (index - a);
			b += 2;
			d = numerator * d + b;
			if (Math.abs(d) < INCOMPLETE_GAMMA_TINY) {
				d = INCOMPLETE_GAMMA_TINY;
			}
			c = b + numerator / c;
			if (Math.abs(c) < INCOMPLETE_GAMMA_TINY) {
				c = INCOMPLETE_GAMMA_TINY;
			}
			d = 1 / d;
			const delta = d * c;
			fraction *= delta;
			if (Math.abs(delta - 1) < INCOMPLETE_GAMMA_EPSILON) {
				return toProbability(Math.exp(logPrefactor) * fraction, a, x);
			}
		}
	}
	// Unreachable for chi-square arguments; refuse rather than guess.
	throw new RangeError(`incomplete gamma did not converge for a=${a}, x=${x}`);
}

/**
 * Exact upper-tail probability P(X ≥ statistic) of a chi-square
 * distribution with a positive integer number of degrees of freedom,
 * Q(df / 2, statistic / 2). For df = 1 this is erfc(√(statistic / 2)); for
 * df = 2 it is exactly exp(−statistic / 2), which is used directly.
 */
export function chiSquareSurvival(
	statistic: number,
	degreesOfFreedom: number,
): number {
	if (!Number.isInteger(degreesOfFreedom) || degreesOfFreedom < 1) {
		throw new RangeError(
			`degrees of freedom must be a positive integer, received ${degreesOfFreedom}`,
		);
	}
	if (Number.isNaN(statistic) || statistic < 0) {
		throw new RangeError(
			`chi-square statistic must be a non-negative number, received ${statistic}`,
		);
	}
	if (degreesOfFreedom === 2) {
		return Math.exp(-statistic / 2);
	}
	return regularizedUpperGamma(degreesOfFreedom / 2, statistic / 2);
}

/**
 * Detect Sample Ratio Mismatch (SRM) by comparing expected assignment
 * ratios against observed successful-sent ratios using a chi-square
 * goodness-of-fit test. The reported p-value is the exact chi-square
 * upper tail, and the check passes exactly when that p-value is at least
 * alpha, so the decision and the reported p-value cannot disagree.
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
	if (
		expected.length !== observed.length ||
		expected.length < 2 ||
		[...expected, ...observed].some(
			(count) => !Number.isFinite(count) || count < 0,
		)
	) {
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

	// Check for traffic in zero-expected arms before computing chi-square.
	for (let i = 0; i < expected.length; i += 1) {
		const expVal = expected[i] ?? 0;
		const obsVal = observed[i] ?? 0;
		if (expVal === 0 && obsVal > 0) {
			return {
				passed: false,
				status: "fail" as const,
				chiSquare: Number.POSITIVE_INFINITY,
				pValue: 0,
				reasonCode: "traffic_in_zero_expected_arm",
			};
		}
	}

	// Filter out zero-expected + zero-observed arms.
	const activeIndices: number[] = [];
	for (let i = 0; i < expected.length; i += 1) {
		if ((expected[i] ?? 0) > 0 || (observed[i] ?? 0) > 0) {
			activeIndices.push(i);
		}
	}
	if (activeIndices.length < 2) {
		return {
			passed: false,
			status: "indeterminate" as const,
			chiSquare: 0,
			pValue: 1,
			reasonCode: "insufficient_active_arms",
		};
	}

	// Scale expected to match observed total for the goodness-of-fit test.
	const chiSquare = activeIndices.reduce((sum, idx) => {
		const expVal = expected[idx] ?? 0;
		const scaledExpected = (expVal / expectedSum) * observedSum;
		const obsVal = observed[idx] ?? 0;
		return sum + ((obsVal - scaledExpected) ** 2) / scaledExpected;
	}, 0);

	// df = number of active groups - 1 (after filtering zero/zero arms).
	const df = activeIndices.length - 1;
	const pValue = chiSquareSurvival(chiSquare, df);
	const passed = pValue >= alpha;

	return {
		passed,
		status: (passed ? "pass" : "fail") as "pass" | "fail",
		chiSquare,
		pValue,
		reasonCode: passed ? undefined : "srm_detected",
	};
}
