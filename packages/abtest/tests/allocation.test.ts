import { describe, expect, it } from "bun:test";
import {
	allocateByLargestRemainder,
	allocateTestAndHoldout,
	AllocationInputError,
} from "../src/allocation";

describe("allocateByLargestRemainder", () => {
	it("distributes 1001 audience at 10% test into exact 100/901 split", () => {
		// testGroupPercentage=10 -> weights [10, 90]
		const result = allocateByLargestRemainder({
			total: 1001,
			weights: [10, 90],
		});
		expect(result.counts).toHaveLength(2);
		expect(result.counts[0]).toBe(100); // 1001 * 0.1 = 100.1 -> floor 100, remainder 0.1 wins a seat
		expect(result.counts[1]).toBe(901);
		expect(result.total).toBe(1001);
		expect(result.counts.reduce((a, b) => a + b, 0)).toBe(1001);
	});

	it("distributes test group 100 across A/B 70/30 into 70/30", () => {
		const result = allocateByLargestRemainder({
			total: 100,
			weights: [70, 30],
		});
		expect(result.counts).toEqual([70, 30]);
		expect(result.total).toBe(100);
	});

	it("distributes A/B/C 34/33/33 across test group 100 into 34/33/33", () => {
		const result = allocateByLargestRemainder({
			total: 100,
			weights: [34, 33, 33],
		});
		expect(result.counts).toEqual([34, 33, 33]);
		expect(result.total).toBe(100);
	});

	it("distributes A/B/C 34/33/33 across test group 101 into 35/33/33", () => {
		// quotas: 101*34/100=34.34, 101*33/100=33.33, 101*33/100=33.33
		// floors: 34, 33, 33 = 100. remainder 1 seat.
		// remainders: 0.34, 0.33, 0.33 -> first index (A) wins the extra seat.
		const result = allocateByLargestRemainder({
			total: 101,
			weights: [34, 33, 33],
		});
		expect(result.counts).toEqual([35, 33, 33]);
		expect(result.total).toBe(101);
	});

	it("handles tiny audience sizes that still sum exactly", () => {
		expect(
			allocateByLargestRemainder({ total: 1, weights: [1] }).counts,
		).toEqual([1]);
		expect(
			allocateByLargestRemainder({ total: 2, weights: [1, 1] }).counts,
		).toEqual([1, 1]);
		// 1 seat, 60/40 split -> 60% wins the single seat
		expect(
			allocateByLargestRemainder({ total: 1, weights: [60, 40] }).counts,
		).toEqual([1, 0]);
	});

	it("supports decimal weights", () => {
		// weights 0.5 and 0.5 are equivalent to 1/1
		const result = allocateByLargestRemainder({
			total: 10,
			weights: [0.5, 0.5],
		});
		expect(result.counts).toEqual([5, 5]);
		expect(result.total).toBe(10);
	});

	it("supports weights that do not sum to 1 or 100", () => {
		// weights [3, 1] over 8 -> quotas 6, 2 exactly
		const result = allocateByLargestRemainder({ total: 8, weights: [3, 1] });
		expect(result.counts).toEqual([6, 2]);
		expect(result.total).toBe(8);
	});

	it("returns all-zero counts for total 0 while still validating weights", () => {
		const result = allocateByLargestRemainder({ total: 0, weights: [1, 2] });
		expect(result.counts).toEqual([0, 0]);
		expect(result.total).toBe(0);
	});

	it("throws AllocationInputError for invalid total", () => {
		expect(() =>
			allocateByLargestRemainder({ total: -1, weights: [1] }),
		).toThrow(AllocationInputError);
		expect(() =>
			// biome-ignore lint/suspicious/noSparseArray: testing sparse array rejection
			allocateByLargestRemainder({ total: 1.5, weights: [1] }),
		).toThrow(AllocationInputError);
		expect(() =>
			allocateByLargestRemainder({ total: Number.NaN, weights: [1] }),
		).toThrow(AllocationInputError);
	});

	it("throws AllocationInputError for empty weights", () => {
		expect(() =>
			allocateByLargestRemainder({ total: 10, weights: [] }),
		).toThrow(AllocationInputError);
	});

	it("throws AllocationInputError for zero weight", () => {
		expect(() =>
			allocateByLargestRemainder({ total: 10, weights: [0, 1] }),
		).toThrow(AllocationInputError);
	});

	it("throws AllocationInputError for negative weight", () => {
		expect(() =>
			allocateByLargestRemainder({ total: 10, weights: [-1, 2] }),
		).toThrow(AllocationInputError);
	});

	it("throws AllocationInputError for NaN weight", () => {
		expect(() =>
			allocateByLargestRemainder({ total: 10, weights: [Number.NaN, 1] }),
		).toThrow(AllocationInputError);
	});

	it("breaks remainder ties deterministically by original index", () => {
		// 3 seats across three equal weights (1,1,1): quotas 1,1,1 exactly.
		// 4 seats across three equal weights: quotas 1.33 each, floors 1,1,1=3,
		// one extra seat, all remainders equal (0.33), goes to lowest index.
		const r3 = allocateByLargestRemainder({ total: 3, weights: [1, 1, 1] });
		expect(r3.counts).toEqual([1, 1, 1]);
		const r4 = allocateByLargestRemainder({ total: 4, weights: [1, 1, 1] });
		expect(r4.counts).toEqual([2, 1, 1]);
		// Second extra seat in a 5-seat allocation goes to the next index.
		const r5 = allocateByLargestRemainder({ total: 5, weights: [1, 1, 1] });
		expect(r5.counts).toEqual([2, 2, 1]);
	});

	it("always returns counts whose sum equals the input total", () => {
		// Randomized property check across many sizes/weights.
		for (let i = 0; i < 200; i += 1) {
			const total = Math.floor(Math.random() * 1000);
			const groupCount = 1 + Math.floor(Math.random() * 4);
			const weights = Array.from(
				{ length: groupCount },
				() => 1 + Math.random() * 99,
			);
			const result = allocateByLargestRemainder({ total, weights });
			expect(result.counts.reduce((sum, c) => sum + c, 0)).toBe(total);
			expect(result.total).toBe(total);
			for (const count of result.counts) {
				expect(Number.isInteger(count)).toBe(true);
				expect(count).toBeGreaterThanOrEqual(0);
				expect(count).toBeLessThanOrEqual(total);
			}
		}
	});
});

describe("allocateTestAndHoldout", () => {
	it("splits 1001 at 10% into 100 test / 901 holdout", () => {
		const result = allocateTestAndHoldout({
			audienceSize: 1001,
			testGroupPercentage: 10,
		});
		expect(result).toEqual({ testGroupSize: 100, holdoutGroupSize: 901 });
		expect(result.testGroupSize + result.holdoutGroupSize).toBe(1001);
	});

	it("handles 0% and 100% test group edge cases", () => {
		expect(
			allocateTestAndHoldout({ audienceSize: 100, testGroupPercentage: 0 }),
		).toEqual({ testGroupSize: 0, holdoutGroupSize: 100 });
		expect(
			allocateTestAndHoldout({ audienceSize: 100, testGroupPercentage: 100 }),
		).toEqual({ testGroupSize: 100, holdoutGroupSize: 0 });
	});

	it("returns 0/0 for empty audience", () => {
		expect(
			allocateTestAndHoldout({ audienceSize: 0, testGroupPercentage: 50 }),
		).toEqual({ testGroupSize: 0, holdoutGroupSize: 0 });
	});

	it("rejects percentage outside [0, 100]", () => {
		expect(() =>
			allocateTestAndHoldout({ audienceSize: 100, testGroupPercentage: -1 }),
		).toThrow(AllocationInputError);
		expect(() =>
			allocateTestAndHoldout({ audienceSize: 100, testGroupPercentage: 101 }),
		).toThrow(AllocationInputError);
		expect(() =>
			allocateTestAndHoldout({
				audienceSize: 100,
				testGroupPercentage: Number.NaN,
			}),
		).toThrow(AllocationInputError);
	});

	it("rejects non-integer audience size", () => {
		expect(() =>
			allocateTestAndHoldout({ audienceSize: 1.5, testGroupPercentage: 10 }),
		).toThrow(AllocationInputError);
	});
});
