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
		const withLock = { ...base, lockedAt: "2026-07-24T01:00:00Z", checksum: "abc" };
		expect(computeHypothesisChecksum(withLock)).toBe(
			computeHypothesisChecksum(base),
		);
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
