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

import { checkSRM } from "../src/statistics";

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
});
