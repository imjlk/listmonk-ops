/**
 * Exact integer allocation using the largest-remainder method.
 *
 * The A/B test provisioning path needs group sizes that always sum to the
 * source audience total while still respecting the relative weights of each
 * variant and the holdout. Naive `Math.floor` rounding drops the fractional
 * remainder and silently under-assigns recipients, which both distorts the
 * experiment and loses subscribers.
 *
 * `allocateByLargestRemainder` is a pure function: given a non-negative
 * integer `total` and a list of finite positive `weights`, it returns an
 * integer seat count per weight such that the counts sum to exactly `total`.
 * Ties in the fractional remainder are broken by the original index order so
 * the result is deterministic for the same inputs.
 */

export interface AllocationInput {
	/** Total number of recipients to distribute. Must be a non-negative integer. */
	total: number;
	/**
	 * Relative weights for each group. Every weight must be a finite, positive
	 * number. The array must be non-empty. Weights need not sum to 1 (or 100);
	 * they are normalized internally.
	 */
	weights: number[];
}

export interface AllocationResult {
	/** Seat count per weight, in the same order as the input weights. */
	counts: number[];
	/** Sum of all counts; always equal to `input.total`. */
	total: number;
}

export class AllocationInputError extends Error {
	constructor(
		message: string,
		readonly input: AllocationInput,
	) {
		super(message);
		this.name = "AllocationInputError";
	}
}

/**
 * Validation error for a single numeric value (not an `AllocationInput`).
 * Used by `allocateTestAndHoldout` for percentage bounds and by the shared
 * non-negative-integer helper, where the failing argument is a scalar rather
 * than the full allocation input.
 */
export class AllocationValueError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AllocationValueError";
	}
}

export class AllocationInvariantError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AllocationInvariantError";
	}
}

/**
 * Allocate `total` seats across groups proportional to `weights` using the
 * largest-remainder (Hamilton) method.
 *
 * Algorithm:
 *  1. Validate inputs (finite, positive weights, non-negative integer total).
 *  2. Compute each group's ideal quota as `total * weight / sum(weights)`.
 *  3. Give each group `Math.floor(quota)` seats.
 *  4. Distribute the remaining seats one each to the groups with the largest
 *     fractional remainder, breaking ties by the original index.
 *  5. Assert the result sums to `total`; otherwise throw an invariant error.
 *
 * Special case: `total === 0` returns an all-zero counts array (still
 * validated for weight shape), since there is nothing to distribute.
 */
export function allocateByLargestRemainder(
	input: AllocationInput,
): AllocationResult {
	validateAllocationInput(input);

	const { total, weights } = input;

	if (total === 0) {
		return { counts: weights.map(() => 0), total: 0 };
	}

	// validateAllocationInput guarantees every weight is finite and strictly
	// positive, so the sum is always positive; no extra guard needed here.
	const weightSum = weights.reduce((sum, weight) => sum + weight, 0);

	const quotas = weights.map((weight) => (total * weight) / weightSum);
	const baseSeats = quotas.map((quota) => Math.floor(quota));
	const allocated = baseSeats.reduce((sum, seats) => sum + seats, 0);
	let remaining = total - allocated;

	if (remaining < 0) {
		// Math.floor can never exceed its quota, so this is an arithmetic bug.
		throw new AllocationInvariantError(
			`largest-remainder base allocation exceeded total: allocated=${allocated} total=${total}`,
		);
	}

	// Rank each group by its fractional remainder, breaking ties by the
	// original index so the result is deterministic for identical inputs.
	const rankings = weights.map((_, index) => {
		const remainder = quotas[index] - baseSeats[index];
		return { index, remainder };
	});
	rankings.sort((a, b) => {
		if (b.remainder !== a.remainder) {
			return b.remainder - a.remainder;
		}
		return a.index - b.index;
	});

	const counts = [...baseSeats];
	for (const { index } of rankings) {
		if (remaining <= 0) {
			break;
		}
		counts[index] += 1;
		remaining -= 1;
	}

	if (remaining !== 0) {
		throw new AllocationInvariantError(
			`largest-remainder failed to exhaust seats: remaining=${remaining} total=${total}`,
		);
	}

	const resultTotal = counts.reduce((sum, seats) => sum + seats, 0);
	if (resultTotal !== total) {
		throw new AllocationInvariantError(
			`largest-remainder sum mismatch: result=${resultTotal} expected=${total}`,
		);
	}

	return { counts, total: resultTotal };
}

/**
 * Allocate a total audience into a test group and a holdout group.
 *
 * `testGroupPercentage` is the percentage (0-100) of the audience that
 * participates in the experiment; the remainder forms the holdout that later
 * receives the winner variant. Returns exact integer sizes for both groups.
 */
export function allocateTestAndHoldout(params: {
	audienceSize: number;
	testGroupPercentage: number;
}): { testGroupSize: number; holdoutGroupSize: number } {
	validateNonNegativeInteger("audienceSize", params.audienceSize);
	if (
		!Number.isFinite(params.testGroupPercentage) ||
		params.testGroupPercentage < 0 ||
		params.testGroupPercentage > 100
	) {
		throw new AllocationValueError(
			`testGroupPercentage must be a finite number in [0, 100], received ${params.testGroupPercentage}`,
		);
	}

	if (params.audienceSize === 0) {
		return { testGroupSize: 0, holdoutGroupSize: 0 };
	}

	// Edge cases where one side has zero weight: the largest-remainder helper
	// requires strictly positive weights, so handle 0% and 100% directly.
	if (params.testGroupPercentage === 0) {
		return { testGroupSize: 0, holdoutGroupSize: params.audienceSize };
	}
	if (params.testGroupPercentage === 100) {
		return { testGroupSize: params.audienceSize, holdoutGroupSize: 0 };
	}

	const result = allocateByLargestRemainder({
		total: params.audienceSize,
		weights: [params.testGroupPercentage, 100 - params.testGroupPercentage],
	});
	return {
		testGroupSize: result.counts[0] ?? 0,
		holdoutGroupSize: result.counts[1] ?? 0,
	};
}

function validateAllocationInput(input: AllocationInput): void {
	validateNonNegativeInteger("total", input.total);

	if (!Array.isArray(input.weights) || input.weights.length === 0) {
		throw new AllocationInputError("weights must be a non-empty array", input);
	}

	input.weights.forEach((weight, index) => {
		if (!Number.isFinite(weight) || weight <= 0) {
			throw new AllocationInputError(
				`weights[${index}] must be a finite positive number, received ${weight}`,
				input,
			);
		}
	});
}

function validateNonNegativeInteger(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
		throw new AllocationValueError(
			`${name} must be a non-negative integer, received ${value}`,
		);
	}
}
