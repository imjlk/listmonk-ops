import { describe, expect, it } from "bun:test";
import {
	applyHolmCorrection,
	DEFAULT_STATISTICAL_POLICY,
	fixedHorizonGate,
} from "../src/statistics";

describe("applyHolmCorrection", () => {
	it("passes all significant p-values when they are small enough", () => {
		const result = applyHolmCorrection([0.01, 0.02], 0.05);
		expect(result.significant).toEqual([true, true]);
		expect(result.adjustedPValues[0]).toBeLessThanOrEqual(0.05);
		expect(result.adjustedPValues[1]).toBeLessThanOrEqual(0.05);
	});

	it("rejects the family when the smallest p-value exceeds the first threshold", () => {
		// m=3, alpha=0.05: thresholds are 0.05/3, 0.05/2, 0.05/1
		// p=0.02: 0.02 < 0.0167? No -> stop
		const result = applyHolmCorrection([0.02, 0.03, 0.04], 0.05);
		expect(result.significant).toEqual([false, false, false]);
	});

	it("passes the first but stops at the second", () => {
		// m=2, alpha=0.05: thresholds are 0.025, 0.05
		// p=0.01: 0.01 < 0.025? Yes -> significant
		// p=0.04: 0.04 < 0.05? Yes -> significant (both pass)
		// Use p=0.01, 0.06: first passes, second fails
		const result = applyHolmCorrection([0.01, 0.06], 0.05);
		expect(result.significant).toEqual([true, false]);
	});

	it("handles a single p-value (degenerates to Bonferroni)", () => {
		const result = applyHolmCorrection([0.03], 0.05);
		expect(result.significant).toEqual([true]);
		expect(result.adjustedPValues[0]).toBe(0.03);
	});

	it("handles empty input", () => {
		const result = applyHolmCorrection([], 0.05);
		expect(result.significant).toEqual([]);
		expect(result.adjustedPValues).toEqual([]);
	});

	it("maps results back to original order regardless of input order", () => {
		// p[0]=0.04 (largest), p[1]=0.01 (smallest), alpha=0.05, m=2
		// sorted: [0.01, 0.04], thresholds: [0.025, 0.05]
		// rank 0: 0.01 < 0.025 -> significant
		// rank 1: 0.04 < 0.05 -> significant
		const result = applyHolmCorrection([0.04, 0.01], 0.05);
		expect(result.significant).toEqual([true, true]);
		expect(result.originalPValues).toEqual([0.04, 0.01]);
	});

	it("throws on invalid alpha", () => {
		expect(() => applyHolmCorrection([0.01], 0)).toThrow();
		expect(() => applyHolmCorrection([0.01], 1)).toThrow();
		expect(() => applyHolmCorrection([0.01], Number.NaN)).toThrow();
	});

	it("clamps adjusted p-values to 1", () => {
		const result = applyHolmCorrection([0.9, 0.95], 0.05);
		for (const adj of result.adjustedPValues) {
			expect(adj).toBeLessThanOrEqual(1);
		}
	});

	it("matches the reference step-down adjustment", () => {
		// R: p.adjust(c(0.01, 0.04, 0.03), "holm") == c(0.03, 0.06, 0.06)
		const result = applyHolmCorrection([0.01, 0.04, 0.03], 0.05);
		expect(result.adjustedPValues[0]).toBeCloseTo(0.03, 15);
		expect(result.adjustedPValues[1]).toBeCloseTo(0.06, 15);
		expect(result.adjustedPValues[2]).toBeCloseTo(0.06, 15);
		// 0.01 < 0.05/3 rejects; 0.03 >= 0.05/2 stops the step-down.
		expect(result.significant).toEqual([true, false, false]);
	});

	it("refuses undefined or out-of-range p-values instead of rejecting them", () => {
		// NaN fails every `p >= threshold` comparison, so it used to be
		// reported significant.
		for (const invalid of [
			Number.NaN,
			Number.POSITIVE_INFINITY,
			-0.01,
			1.01,
		]) {
			expect(() => applyHolmCorrection([invalid, 0.5], 0.05)).toThrow(
				`p-values must be finite numbers in [0, 1], received ${invalid} at index 0`,
			);
		}
		expect(() => applyHolmCorrection([0.01, Number.NaN], 0.05)).toThrow(
			RangeError,
		);
		// The inclusive bounds stay valid.
		expect(applyHolmCorrection([0, 1], 0.05).significant).toEqual([
			true,
			false,
		]);
	});
});

describe("chiSquareSurvival", () => {
	// Exact references from the closed forms (df 1: erfc(sqrt(x/2)); df 2:
	// exp(-x/2); odd/even df: erfc/exp times their finite series) evaluated
	// with an independent double-precision implementation.
	const references: Array<[statistic: number, df: number, p: number]> = [
		[10.89, 1, 0.0009668482847675529],
		[3.841458820694124, 1, 0.05],
		[6.634896601021214, 1, 0.01],
		[10.827566170662733, 1, 0.001],
		[0.5, 1, 0.4795001221869535],
		[50, 1, 1.537459794428035e-12],
		[13.815510557964274, 2, 0.001],
		[200, 2, 3.720075976020836e-44],
		[16.26623619623813, 3, 0.001],
		[11.52, 3, 0.009222070730751675],
		[1, 3, 0.8012519569012007],
		[100, 3, 1.554159431389605e-21],
		[9.487729036781154, 4, 0.05],
		[2.5, 5, 0.7764950711233227],
		[30, 5, 1.4748581038443054e-5],
	];

	it("matches exact chi-square upper-tail references", () => {
		for (const [statistic, df, expected] of references) {
			const actual = chiSquareSurvival(statistic, df);
			expect(Math.abs(actual - expected) / expected).toBeLessThan(1e-12);
		}
	});

	it("handles the distribution bounds", () => {
		expect(chiSquareSurvival(0, 1)).toBe(1);
		expect(chiSquareSurvival(0, 3)).toBe(1);
		expect(chiSquareSurvival(Number.POSITIVE_INFINITY, 1)).toBe(0);
		expect(chiSquareSurvival(Number.POSITIVE_INFINITY, 2)).toBe(0);
		expect(chiSquareSurvival(5000, 1)).toBe(0);
	});

	it("rejects invalid statistics and degrees of freedom", () => {
		expect(() => chiSquareSurvival(Number.NaN, 1)).toThrow(RangeError);
		expect(() => chiSquareSurvival(-1, 1)).toThrow(RangeError);
		expect(() => chiSquareSurvival(1, 0)).toThrow(RangeError);
		expect(() => chiSquareSurvival(1, 1.5)).toThrow(RangeError);
	});

	it("agrees with the incomplete gamma closed forms", () => {
		// Q(1, x) = exp(-x) and Q(a, 0) = 1.
		expect(regularizedUpperGamma(1, 2)).toBeCloseTo(Math.exp(-2), 15);
		expect(regularizedUpperGamma(2.5, 0)).toBe(1);
		expect(() => regularizedUpperGamma(0.25, 1)).toThrow(RangeError);
	});
});

describe("fixedHorizonGate", () => {
	const now = new Date("2026-07-24T12:00:00Z").getTime();
	const policy = DEFAULT_STATISTICAL_POLICY;

	it("passes when endsAt has passed, duration met, and samples met", () => {
		const result = fixedHorizonGate({
			endsAt: "2026-07-24T10:00:00Z",
			startedAt: "2026-07-23T10:00:00Z",
			now,
			policy,
			sampleSizes: [200, 200],
		});
		expect(result.ready).toBe(true);
		expect(result.reasonCodes).toEqual([]);
	});

	it("passes when endsAt is not set (open-ended test)", () => {
		// No endsAt = no duration_hours = open-ended; the gate skips the
		// horizon check and only checks startedAt and samples.
		const result = fixedHorizonGate({
			startedAt: "2026-07-23T10:00:00Z",
			now,
			policy,
			sampleSizes: [200, 200],
		});
		expect(result.ready).toBe(true);
	});

	it("fails when endsAt has not passed yet", () => {
		const result = fixedHorizonGate({
			endsAt: "2026-07-24T14:00:00Z",
			startedAt: "2026-07-23T14:00:00Z",
			now,
			policy,
			sampleSizes: [200, 200],
		});
		expect(result.ready).toBe(false);
		expect(result.reasonCodes).toContain("before_endsAt");
	});

	it("fails when minimum duration is not met", () => {
		const result = fixedHorizonGate({
			endsAt: "2026-07-24T10:00:00Z",
			startedAt: "2026-07-24T08:00:00Z", // only 2 hours
			now,
			policy,
			sampleSizes: [200, 200],
		});
		expect(result.ready).toBe(false);
		expect(result.reasonCodes.some((r) => r.startsWith("minimum_duration_not_met"))).toBe(true);
	});

	it("fails when minimum sample is not met for a variant", () => {
		const result = fixedHorizonGate({
			endsAt: "2026-07-24T10:00:00Z",
			startedAt: "2026-07-23T10:00:00Z",
			now,
			policy,
			sampleSizes: [200, 50],
		});
		expect(result.ready).toBe(false);
		expect(result.reasonCodes.some((r) => r.includes("variant_1:50"))).toBe(true);
	});

	it("accumulates multiple reason codes", () => {
		const result = fixedHorizonGate({
			endsAt: "2026-07-25T00:00:00Z", // future — before_endsAt
			now,
			policy,
			sampleSizes: [10],
		});
		expect(result.ready).toBe(false);
		expect(result.reasonCodes.length).toBeGreaterThanOrEqual(2);
		expect(result.reasonCodes).toContain("before_endsAt");
	});
});

import {
	checkSRM,
	chiSquareSurvival,
	pairSrmCountsByVariant,
	regularizedUpperGamma,
} from "../src/statistics";

describe("checkSRM", () => {
	it("passes when observed ratios match expected ratios", () => {
		const result = checkSRM([500, 500], [498, 502]);
		expect(result.passed).toBe(true);
		expect(result.reasonCode).toBeUndefined();
	});

	it("fails when observed ratios significantly differ from expected", () => {
		// 50/50 expected, 65/35 observed — clear SRM
		const result = checkSRM([500, 500], [650, 350], 0.001);
		expect(result.passed).toBe(false);
		expect(result.chiSquare).toBeGreaterThan(10);
		expect(result.reasonCode).toBe("srm_detected");
	});

	it("fails with insufficient_sample when all counts are zero", () => {
		const result = checkSRM([500, 500], [0, 0]);
		expect(result.passed).toBe(false);
		expect(result.reasonCode).toBe("insufficient_sample");
	});

	it("handles 3-way splits", () => {
		const result = checkSRM([333, 333, 334], [330, 335, 335]);
		expect(result.passed).toBe(true);
	});

	it("fails with invalid_input for mismatched lengths", () => {
		const result = checkSRM([500, 500], [500]);
		expect(result.passed).toBe(false);
		expect(result.reasonCode).toBe("invalid_input");
	});

	it("passes with slight variation within threshold", () => {
		// 50/50 expected, 51/49 observed — small difference
		const result = checkSRM([1000, 1000], [1020, 980], 0.001);
		expect(result.passed).toBe(true);
	});

	it("reports the exact df=1 p-value behind the decision", () => {
		// chi-square = 2 * 165^2 / 5000 = 10.89. The previous approximation
		// reported 0.00114 here while failing the check against 10.828.
		const result = checkSRM([5000, 5000], [5165, 4835], 0.001);
		expect(result.chiSquare).toBeCloseTo(10.89, 12);
		expect(result.pValue).toBeCloseTo(0.0009668482847675529, 15);
		expect(result.passed).toBe(false);
		expect(result.status).toBe("fail");
	});

	it("uses the df of a four-way split instead of the df=1 critical value", () => {
		// chi-square = 2 * 120^2 / 2500 = 11.52 with df = 3 has p ~ 0.0092,
		// so it passes at alpha 0.001 (it used to fail against df=1's 10.828).
		const result = checkSRM(
			[2500, 2500, 2500, 2500],
			[2500, 2500, 2380, 2620],
			0.001,
		);
		expect(result.pValue).toBeCloseTo(0.009222070730751675, 15);
		expect(result.passed).toBe(true);
		expect(result.reasonCode).toBeUndefined();
	});

	it("keeps the decision consistent with the reported p-value at any alpha", () => {
		for (const alpha of [0.001, 0.005, 0.02, 0.05, 0.2]) {
			for (const shift of [0, 20, 40, 60, 80, 120, 200]) {
				const result = checkSRM([5000, 5000], [5000 + shift, 5000 - shift], alpha);
				expect(result.status).not.toBe("indeterminate");
				expect(result.passed).toBe(result.pValue >= alpha);
			}
		}
	});

	it("treats non-finite or negative counts as invalid input", () => {
		for (const [expected, observed] of [
			[[500, Number.NaN], [500, 500]],
			[[500, 500], [500, -1]],
			[[500, Number.POSITIVE_INFINITY], [500, 500]],
		]) {
			const result = checkSRM(expected as number[], observed as number[]);
			expect(result).toMatchObject({
				passed: false,
				status: "indeterminate",
				reasonCode: "invalid_input",
			});
		}
	});
});

describe("pairSrmCountsByVariant", () => {
	const expected = [
		{ variantId: "A", expectedCount: 1500 },
		{ variantId: "B", expectedCount: 750 },
		{ variantId: "C", expectedCount: 750 },
	];

	it("pairs counts by variant id regardless of result order", () => {
		expect(
			pairSrmCountsByVariant(expected, [
				{ variantId: "B", sampleSize: 751 },
				{ variantId: "A", sampleSize: 1499 },
				{ variantId: "C", sampleSize: 750 },
			]),
		).toEqual({
			variantIds: ["A", "B", "C"],
			expected: [1500, 750, 750],
			observed: [1499, 751, 750],
		});
	});

	it("rejects inputs that do not name the same variants exactly once", () => {
		// A variant without results.
		expect(
			pairSrmCountsByVariant(expected, [
				{ variantId: "A", sampleSize: 1500 },
				{ variantId: "B", sampleSize: 750 },
				{ variantId: "Z", sampleSize: 750 },
			]),
		).toBeUndefined();
		// Duplicate results for one variant.
		expect(
			pairSrmCountsByVariant(expected, [
				{ variantId: "A", sampleSize: 1500 },
				{ variantId: "A", sampleSize: 750 },
				{ variantId: "C", sampleSize: 750 },
			]),
		).toBeUndefined();
		// Duplicate expected groups.
		expect(
			pairSrmCountsByVariant(
				[
					{ variantId: "A", expectedCount: 1500 },
					{ variantId: "A", expectedCount: 1500 },
				],
				[
					{ variantId: "A", sampleSize: 1500 },
					{ variantId: "B", sampleSize: 750 },
				],
			),
		).toBeUndefined();
		// Different variant counts.
		expect(
			pairSrmCountsByVariant(expected, [
				{ variantId: "A", sampleSize: 1500 },
				{ variantId: "B", sampleSize: 750 },
			]),
		).toBeUndefined();
	});
});
