import { describe, expect, it } from "bun:test";
import {
	computeHypothesisChecksum,
	HypothesisValidationError,
	lockHypothesis,
	validateHypothesisMetadata,
	verifyHypothesisChecksum,
	type HypothesisMetadata,
} from "../src/hypothesis";

function makeHypothesis(
	overrides: Partial<HypothesisMetadata> = {},
): HypothesisMetadata {
	return {
		objective: "Increase click-through rate on welcome email",
		hypothesis: "A shorter subject line will increase CTR by 10%",
		primaryMetric: {
			type: "click_rate",
			direction: "maximize",
		},
		expectedLift: { kind: "relative", value: 0.1 },
		owner: { id: "user-1", displayName: "Test User" },
		experimentScope: {
			channel: "email",
			experimentFamilyKey: "onboarding.welcome.subject",
			attributionWindowHours: 72,
			exclusionWindowHours: 168,
		},
		createdAt: "2026-07-24T00:00:00Z",
		...overrides,
	};
}

describe("validateHypothesisMetadata", () => {
	it("accepts valid metadata in strict mode", () => {
		expect(() =>
			validateHypothesisMetadata(makeHypothesis(), true),
		).not.toThrow();
	});

	it("allows missing fields in non-strict (draft) mode", () => {
		expect(() =>
			validateHypothesisMetadata({}, false),
		).not.toThrow();
	});

	it("rejects missing objective in strict mode", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({ objective: undefined }),
				true,
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects empty objective", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({ objective: "  " }),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects non-positive expectedLift", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					expectedLift: { kind: "relative", value: -0.1 },
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects invalid experimentFamilyKey format", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					experimentScope: {
						channel: "email",
						experimentFamilyKey: "Invalid Key!",
						attributionWindowHours: 72,
						exclusionWindowHours: 168,
					},
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("accepts valid experimentFamilyKey with dots", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					experimentScope: {
						channel: "email",
						experimentFamilyKey: "commerce.cart-recovery.24h",
						attributionWindowHours: 24,
						exclusionWindowHours: 48,
					},
				}),
			),
		).not.toThrow();
	});

	it("rejects non-email channel", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					experimentScope: {
						channel: "sms" as "email",
						experimentFamilyKey: "test",
						attributionWindowHours: 72,
						exclusionWindowHours: 168,
					},
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects missing owner.id", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({ owner: { id: "" } }),
				true,
			),
		).toThrow(HypothesisValidationError);
	});

	it("requires createdAt in strict mode", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({ createdAt: undefined }),
				true,
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects malformed createdAt", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({ createdAt: "not-a-date" }),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects non-ISO timestamps that Date.parse would accept", () => {
		// "0", "01/02/03", and overflowed "2026-02-30" must be rejected.
		for (const bad of ["0", "01/02/03", "2026-02-30", "2026-13-40"]) {
			expect(() =>
				validateHypothesisMetadata(makeHypothesis({ createdAt: bad })),
			).toThrow(HypothesisValidationError);
		}
	});

	it("rejects null nested metadata with a validation error", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					primaryMetric: null as unknown as HypothesisMetadata["primaryMetric"],
				}),
			),
		).toThrow(HypothesisValidationError);
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					expectedLift: null as unknown as HypothesisMetadata["expectedLift"],
				}),
			),
		).toThrow(HypothesisValidationError);
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					owner: null as unknown as HypothesisMetadata["owner"],
				}),
			),
		).toThrow(HypothesisValidationError);
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					experimentScope: null as unknown as HypothesisMetadata["experimentScope"],
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects non-string owner id with a validation error", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					owner: { id: 123 as unknown as string },
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects invalid primaryMetric.type in strict mode", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					primaryMetric: {
						type: "bogus" as "click_rate",
						direction: "maximize",
					},
				}),
				true,
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects invalid primaryMetric.direction", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					primaryMetric: {
						type: "click_rate",
						direction: "sideways" as "maximize",
					},
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects invalid expectedLift.kind", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					expectedLift: {
						kind: "bogus" as "relative",
						value: 0.1,
					} as HypothesisMetadata["expectedLift"],
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects absolute lift without a valid unit", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					expectedLift: {
						kind: "absolute",
						value: 1,
						unit: "bogus" as "percentage_point",
					},
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects incompatible revenue metric with percentage_point lift", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					primaryMetric: {
						type: "revenue_per_recipient",
						direction: "maximize",
					},
					expectedLift: {
						kind: "absolute",
						value: 1,
						unit: "percentage_point",
					},
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects click metric with currency_per_recipient lift", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					expectedLift: {
						kind: "absolute",
						value: 1,
						unit: "currency_per_recipient",
					},
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("accepts compatible revenue metric with currency_per_recipient lift", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					primaryMetric: {
						type: "revenue_per_recipient",
						direction: "maximize",
					},
					expectedLift: {
						kind: "absolute",
						value: 1,
						unit: "currency_per_recipient",
					},
				}),
			),
		).not.toThrow();
	});

	it("rejects delimiter-only experimentFamilyKey", () => {
		expect(() =>
			validateHypothesisMetadata(
				makeHypothesis({
					experimentScope: {
						channel: "email",
						experimentFamilyKey: ".",
						attributionWindowHours: 72,
						exclusionWindowHours: 168,
					},
				}),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects empty family-key segments", () => {
		for (const bad of ["foo.", ".foo", "foo..bar", "-"]) {
			expect(() =>
				validateHypothesisMetadata(
					makeHypothesis({
						experimentScope: {
							channel: "email",
							experimentFamilyKey: bad,
							attributionWindowHours: 72,
							exclusionWindowHours: 168,
						},
					}),
				),
			).toThrow(HypothesisValidationError);
		}
	});
});

describe("computeHypothesisChecksum", () => {
	it("produces a deterministic 64-char hex", () => {
		const checksum = computeHypothesisChecksum(makeHypothesis());
		expect(checksum).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is the same for identical content", () => {
		const a = computeHypothesisChecksum(makeHypothesis());
		const b = computeHypothesisChecksum(makeHypothesis());
		expect(a).toBe(b);
	});

	it("changes when content changes", () => {
		const a = computeHypothesisChecksum(makeHypothesis());
		const b = computeHypothesisChecksum(
			makeHypothesis({ objective: "Different objective" }),
		);
		expect(a).not.toBe(b);
	});

	it("excludes lockedAt and checksum from the hash", () => {
		const base = makeHypothesis();
		const withLock = {
			...base,
			lockedAt: "2026-07-24T01:00:00Z",
			checksum: "abc",
		};
		expect(computeHypothesisChecksum(withLock)).toBe(
			computeHypothesisChecksum(base),
		);
	});

	it("changes when a nested primaryMetric field changes", () => {
		const base = computeHypothesisChecksum(makeHypothesis());
		const changed = computeHypothesisChecksum(
			makeHypothesis({
				primaryMetric: { type: "conversion_rate", direction: "maximize" },
			}),
		);
		expect(base).not.toBe(changed);
	});

	it("changes when a nested expectedLift field changes", () => {
		const base = computeHypothesisChecksum(makeHypothesis());
		const changed = computeHypothesisChecksum(
			makeHypothesis({
				expectedLift: { kind: "relative", value: 0.2 },
			}),
		);
		expect(base).not.toBe(changed);
	});

	it("changes when a nested owner field changes", () => {
		const base = computeHypothesisChecksum(makeHypothesis());
		const changed = computeHypothesisChecksum(
			makeHypothesis({ owner: { id: "user-2" } }),
		);
		expect(base).not.toBe(changed);
	});

	it("changes when a nested experimentScope field changes", () => {
		const base = computeHypothesisChecksum(makeHypothesis());
		const changed = computeHypothesisChecksum(
			makeHypothesis({
				experimentScope: {
					channel: "email",
					experimentFamilyKey: "onboarding.welcome.subject",
					attributionWindowHours: 48,
					exclusionWindowHours: 168,
				},
			}),
		);
		expect(base).not.toBe(changed);
	});
});

describe("lockHypothesis", () => {
	it("sets lockedAt and checksum", () => {
		const locked = lockHypothesis(makeHypothesis());
		expect(locked.lockedAt).toBeDefined();
		expect(locked.checksum).toMatch(/^[0-9a-f]{64}$/);
	});

	it("rejects double-locking", () => {
		const locked = lockHypothesis(makeHypothesis());
		expect(() => lockHypothesis(locked)).toThrow(
			HypothesisValidationError,
		);
	});

	it("validates strictly before locking", () => {
		expect(() =>
			lockHypothesis(
				makeHypothesis({ objective: undefined } as HypothesisMetadata),
			),
		).toThrow(HypothesisValidationError);
	});

	it("rejects an empty lockedAt override", () => {
		expect(() => lockHypothesis(makeHypothesis(), "")).toThrow(
			HypothesisValidationError,
		);
	});

	it("rejects a malformed lockedAt override", () => {
		expect(() => lockHypothesis(makeHypothesis(), "not-a-date")).toThrow(
			HypothesisValidationError,
		);
	});

	it("accepts a valid lockedAt override", () => {
		const locked = lockHypothesis(
			makeHypothesis(),
			"2026-07-24T01:00:00Z",
		);
		expect(locked.lockedAt).toBe("2026-07-24T01:00:00Z");
		expect(verifyHypothesisChecksum(locked)).toBe(true);
	});
});

describe("verifyHypothesisChecksum", () => {
	it("returns true for a correctly locked hypothesis", () => {
		const locked = lockHypothesis(makeHypothesis());
		expect(verifyHypothesisChecksum(locked)).toBe(true);
	});

	it("returns false for an unlocked hypothesis", () => {
		expect(verifyHypothesisChecksum(makeHypothesis())).toBe(false);
	});

	it("returns false if content was tampered after locking", () => {
		const locked = lockHypothesis(makeHypothesis());
		const tampered = { ...locked, objective: "Changed" };
		expect(verifyHypothesisChecksum(tampered)).toBe(false);
	});
});
