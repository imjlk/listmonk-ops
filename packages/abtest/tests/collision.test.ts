import { describe, expect, it } from "bun:test";
import {
	COLLISION_KEY_CONTEXT,
	CollisionConflictError,
	computeActiveWindow,
	computeSubjectKey,
	DEFAULT_COLLISION_POLICY,
	InMemoryExperimentParticipationStore,
	installationKeysMatch,
	normalizeSubscriberUuid,
	participationsCollide,
	windowsOverlap,
	type CollisionPolicy,
	type ExperimentParticipation,
} from "../src/collision";

void COLLISION_KEY_CONTEXT;

const TEST_KEY = "test-installation-key-12345";
const UUID_A = "11111111-1111-1111-1111-111111111111";
const UUID_B = "22222222-2222-2222-2222-222222222222";
const FAMILY = "onboarding.welcome";

function subjectKey(uuid: string): string {
	return computeSubjectKey(TEST_KEY, normalizeSubscriberUuid(uuid));
}

function makeWindow(
	startMin: number,
	endMin: number,
): { windowStartsAt: string; windowEndsAt: string } {
	const base = new Date("2026-07-25T10:00:00Z").getTime();
	return {
		windowStartsAt: new Date(base + startMin * 60_000).toISOString(),
		windowEndsAt: new Date(base + endMin * 60_000).toISOString(),
	};
}

function makeParticipation(
	overrides: Partial<ExperimentParticipation> = {},
): ExperimentParticipation {
	return {
		testId: "test-1",
		subjectKey: subjectKey(UUID_A),
		channel: "email",
		experimentFamilyKey: FAMILY,
		state: "reserved",
		windowStartsAt: makeWindow(0, 60).windowStartsAt,
		windowEndsAt: makeWindow(0, 60).windowEndsAt,
		reservedAt: new Date("2026-07-25T09:50:00Z").toISOString(),
		...overrides,
	};
}

describe("normalizeSubscriberUuid", () => {
	it("trims, lowercases, and strips braces", () => {
		expect(normalizeSubscriberUuid("  {ABC-DEF}  ")).toBe("abc-def");
	});

	it("handles already-normalized UUIDs", () => {
		expect(normalizeSubscriberUuid(UUID_A)).toBe(UUID_A);
	});
});

describe("computeSubjectKey", () => {
	it("produces a deterministic 64-char hex", () => {
		const key = computeSubjectKey(TEST_KEY, UUID_A);
		expect(key).toMatch(/^[0-9a-f]{64}$/);
		expect(computeSubjectKey(TEST_KEY, UUID_A)).toBe(key);
	});

	it("produces different keys for different UUIDs", () => {
		expect(computeSubjectKey(TEST_KEY, UUID_A)).not.toBe(
			computeSubjectKey(TEST_KEY, UUID_B),
		);
	});

	it("produces different keys for different installation keys", () => {
		expect(computeSubjectKey(TEST_KEY, UUID_A)).not.toBe(
			computeSubjectKey("different-key", UUID_A),
		);
	});

	it("throws on missing installation key", () => {
		expect(() => computeSubjectKey("", UUID_A)).toThrow(
			"installationCollisionKey is required",
		);
	});

	it("throws on empty subscriber UUID", () => {
		expect(() => computeSubjectKey(TEST_KEY, "")).toThrow(
			"normalizedSubscriberUuid must be a non-empty string",
		);
	});

	it("includes the collision key context in the HMAC input", () => {
		// Verify the context tag is part of the derivation by checking that
		// the raw UUID alone (without context) produces a different digest.
		const { createHmac } = require("node:crypto");
		const withoutContext = createHmac("sha256", TEST_KEY)
			.update(UUID_A, "utf8")
			.digest("hex");
		expect(computeSubjectKey(TEST_KEY, UUID_A)).not.toBe(withoutContext);
	});
});

describe("installationKeysMatch", () => {
	it("returns true for identical keys", () => {
		expect(installationKeysMatch(TEST_KEY, TEST_KEY, UUID_A)).toBe(true);
	});

	it("returns false for different keys", () => {
		expect(
			installationKeysMatch(TEST_KEY, "other-key", UUID_A),
		).toBe(false);
	});
});

describe("computeActiveWindow", () => {
	it("expands the window by exclusion and attribution", () => {
		const w = computeActiveWindow({
			launchAt: "2026-07-25T10:00:00Z",
			endsAt: "2026-07-25T12:00:00Z",
			attributionWindowHours: 24,
			exclusionWindowHours: 48,
		});
		// start = 10:00 - 48h = 2026-07-23T10:00:00Z
		expect(w.windowStartsAt).toBe("2026-07-23T10:00:00.000Z");
		// end = 12:00 + (24 + 48)h = 2026-07-28T12:00:00Z
		expect(w.windowEndsAt).toBe("2026-07-28T12:00:00.000Z");
	});

	it("uses launchAt as end base when endsAt is omitted", () => {
		const w = computeActiveWindow({
			launchAt: "2026-07-25T10:00:00Z",
			attributionWindowHours: 1,
			exclusionWindowHours: 1,
		});
		// start = 10:00 - 1h, end = 10:00 + 2h
		expect(w.windowStartsAt).toBe("2026-07-25T09:00:00.000Z");
		expect(w.windowEndsAt).toBe("2026-07-25T12:00:00.000Z");
	});

	it("throws on invalid launchAt", () => {
		expect(() =>
			computeActiveWindow({
				launchAt: "not-a-date",
				attributionWindowHours: 1,
				exclusionWindowHours: 1,
			}),
		).toThrow();
	});

	it("throws on negative window hours", () => {
		expect(() =>
			computeActiveWindow({
				launchAt: "2026-07-25T10:00:00Z",
				attributionWindowHours: -1,
				exclusionWindowHours: 1,
			}),
		).toThrow();
	});
});

describe("windowsOverlap", () => {
	it("detects overlapping windows", () => {
		expect(windowsOverlap(makeWindow(0, 60), makeWindow(30, 90))).toBe(true);
	});

	it("allows non-overlapping windows", () => {
		expect(windowsOverlap(makeWindow(0, 60), makeWindow(61, 120))).toBe(false);
	});

	it("treats boundary-touching as overlap", () => {
		expect(windowsOverlap(makeWindow(0, 60), makeWindow(60, 120))).toBe(true);
	});
});

describe("participationsCollide", () => {
	it("collides on same subject + same family + overlapping window", () => {
		const a = makeParticipation();
		const b = makeParticipation({ testId: "test-2" });
		expect(participationsCollide(a, b)).toBe(true);
	});

	it("does not collide on different family", () => {
		const a = makeParticipation();
		const b = makeParticipation({
			testId: "test-2",
			experimentFamilyKey: "other.family",
		});
		expect(participationsCollide(a, b)).toBe(false);
	});

	it("does not collide on non-overlapping window", () => {
		const a = makeParticipation({
			...makeParticipation(),
			...makeWindow(0, 60),
		});
		const b = makeParticipation({
			testId: "test-2",
			...makeWindow(120, 180),
		});
		expect(participationsCollide(a, b)).toBe(false);
	});

	it("does not collide if one is released", () => {
		const a = makeParticipation({ state: "released" });
		const b = makeParticipation({ testId: "test-2" });
		expect(participationsCollide(a, b)).toBe(false);
	});

	it("does not collide on different subject keys", () => {
		const a = makeParticipation({ subjectKey: subjectKey(UUID_A) });
		const b = makeParticipation({
			testId: "test-2",
			subjectKey: subjectKey(UUID_B),
		});
		expect(participationsCollide(a, b)).toBe(false);
	});
});

describe("InMemoryExperimentParticipationStore", () => {
	it("blocks same subscriber + same family + overlapping time", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		await expect(
			store.checkAndReserve({
				testId: "test-2",
				channel: "email",
				experimentFamilyKey: FAMILY,
				...w,
				subjectKeys: [subjectKey(UUID_A)],
				policy: DEFAULT_COLLISION_POLICY,
				reservedAt: "2026-07-25T09:51:00Z",
			}),
		).rejects.toBeInstanceOf(CollisionConflictError);
	});

	it("allows same subscriber + different family", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		const result = await store.checkAndReserve({
			testId: "test-2",
			channel: "email",
			experimentFamilyKey: "other.family",
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:51:00Z",
		});
		expect(result.reserved).toHaveLength(1);
	});

	it("allows same family but non-overlapping time", async () => {
		const store = new InMemoryExperimentParticipationStore();
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...makeWindow(0, 60),
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		const result = await store.checkAndReserve({
			testId: "test-2",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...makeWindow(120, 180),
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:51:00Z",
		});
		expect(result.reserved).toHaveLength(1);
	});

	it("treats holdout subscribers as collision subjects", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		// Subject B is in holdout of test-1.
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_B)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		// test-2 tries to use subject B in the same family+window.
		await expect(
			store.checkAndReserve({
				testId: "test-2",
				channel: "email",
				experimentFamilyKey: FAMILY,
				...w,
				subjectKeys: [subjectKey(UUID_B)],
				policy: DEFAULT_COLLISION_POLICY,
				reservedAt: "2026-07-25T09:51:00Z",
			}),
		).rejects.toBeInstanceOf(CollisionConflictError);
	});

	it("only one of two concurrent launches succeeds", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		const policy: CollisionPolicy = DEFAULT_COLLISION_POLICY;
		const [r1, r2] = await Promise.allSettled([
			store.checkAndReserve({
				testId: "test-1",
				channel: "email",
				experimentFamilyKey: FAMILY,
				...w,
				subjectKeys: [subjectKey(UUID_A)],
				policy,
				reservedAt: "2026-07-25T09:50:00Z",
			}),
			store.checkAndReserve({
				testId: "test-2",
				channel: "email",
				experimentFamilyKey: FAMILY,
				...w,
				subjectKeys: [subjectKey(UUID_A)],
				policy,
				reservedAt: "2026-07-25T09:50:00Z",
			}),
		]);
		expect(r1.status).toBe("fulfilled");
		expect(r2.status).toBe("rejected");
	});

	it("retries of the same testId are not blocked by own reservation", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		// Retry same test.
		const result = await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:55:00Z",
		});
		expect(result.reserved).toHaveLength(1);
	});

	it("releaseByTest releases before provisioning fails", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A), subjectKey(UUID_B)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		const released = await store.releaseByTest(
			"test-1",
			"2026-07-25T09:55:00Z",
		);
		expect(released).toBe(2);
		// After release, the same subjects can be reserved by another test.
		const result = await store.checkAndReserve({
			testId: "test-2",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:56:00Z",
		});
		expect(result.reserved).toHaveLength(1);
	});

	it("exposed participations are retained until attribution window ends", async () => {
		const store = new InMemoryExperimentParticipationStore();
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...makeWindow(0, 60),
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		await store.markExposed("test-1", "2026-07-25T10:05:00Z");
		// releaseEligible before window ends — nothing released.
		let released = await store.releaseEligible("2026-07-25T10:30:00Z");
		expect(released).toBe(0);
		// After window ends — transitioned to released (not removed).
		released = await store.releaseEligible("2026-07-25T11:01:00Z");
		expect(released).toBe(1);
		// The participation is still present as released, with releasedAt set.
		const list = await store.listByTest("test-1");
		expect(list).toHaveLength(1);
		expect(list[0]?.state).toBe("released");
		expect(list[0]?.releasedAt).toBe("2026-07-25T11:01:00Z");
	});

	it("retry preserves exposed participations for attribution", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		await store.markExposed("test-1", "2026-07-25T10:05:00Z");
		// Retry the same test — the exposed participation must survive.
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:55:00Z",
		});
		const list = await store.listByTest("test-1");
		// One exposed (original) + one reserved (retry).
		expect(list).toHaveLength(2);
		expect(list.some((p) => p.state === "exposed")).toBe(true);
		expect(list.some((p) => p.state === "reserved")).toBe(true);
	});

	it("exclude mode removes conflicting subjects and reserves the rest", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		const result = await store.checkAndReserve({
			testId: "test-2",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A), subjectKey(UUID_B)],
			policy: { mode: "exclude", maximumConcurrentExperiments: 1 },
			reservedAt: "2026-07-25T09:51:00Z",
		});
		// UUID_A excluded, UUID_B reserved.
		expect(result.reserved).toHaveLength(1);
		expect(result.reserved[0]?.subjectKey).toBe(subjectKey(UUID_B));
		expect(result.conflicts?.count).toBe(1);
	});

	it("warn mode reserves all and returns a warning", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		const result = await store.checkAndReserve({
			testId: "test-2",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: { mode: "warn", maximumConcurrentExperiments: 1 },
			reservedAt: "2026-07-25T09:51:00Z",
		});
		expect(result.reserved).toHaveLength(1);
		expect(result.warning).toBeDefined();
		expect(result.conflicts?.count).toBe(1);
	});

	it("does not leak subject keys, emails, or UUIDs in conflict errors", async () => {
		const store = new InMemoryExperimentParticipationStore();
		const w = makeWindow(0, 60);
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...w,
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		try {
			await store.checkAndReserve({
				testId: "test-2",
				channel: "email",
				experimentFamilyKey: FAMILY,
				...w,
				subjectKeys: [subjectKey(UUID_A)],
				policy: DEFAULT_COLLISION_POLICY,
				reservedAt: "2026-07-25T09:51:00Z",
			});
			expect.unreachable("should have thrown");
		} catch (e) {
			const err = e as CollisionConflictError;
			expect(err.conflictingTestIds).toEqual(["test-1"]);
			expect(err.conflictCount).toBe(1);
			// No subject key, UUID, or email in the error message.
			expect(err.message).not.toContain(UUID_A);
			expect(err.message).not.toContain(subjectKey(UUID_A));
			expect(JSON.stringify(err)).not.toContain(UUID_A);
		}
	});

	it("returns deep copies from listByTest", async () => {
		const store = new InMemoryExperimentParticipationStore();
		await store.checkAndReserve({
			testId: "test-1",
			channel: "email",
			experimentFamilyKey: FAMILY,
			...makeWindow(0, 60),
			subjectKeys: [subjectKey(UUID_A)],
			policy: DEFAULT_COLLISION_POLICY,
			reservedAt: "2026-07-25T09:50:00Z",
		});
		const list = await store.listByTest("test-1");
		list[0]!.state = "released";
		const list2 = await store.listByTest("test-1");
		expect(list2[0]?.state).toBe("reserved");
	});

	it("validates reservedAt timestamp", async () => {
		const store = new InMemoryExperimentParticipationStore();
		await expect(
			store.checkAndReserve({
				testId: "test-1",
				channel: "email",
				experimentFamilyKey: FAMILY,
				...makeWindow(0, 60),
				subjectKeys: [subjectKey(UUID_A)],
				policy: DEFAULT_COLLISION_POLICY,
				reservedAt: "not-a-date",
			}),
		).rejects.toThrow();
	});
});
