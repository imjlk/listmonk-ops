import { describe, expect, it } from "bun:test";
import {
	assignmentDigest,
	buildAssignmentManifest,
	generateAssignmentSeed,
	groupChecksum,
	groupIndexForUuid,
} from "../src/assignment";
import { buildAudienceSnapshot, type AudienceMember } from "../src/audience";
import type { Variant } from "../src/types";

function makeMembers(count: number): AudienceMember[] {
	return Array.from({ length: count }, (_, i) => ({
		subscriberId: i + 1,
		subscriberUuid: `uuid-${String(i + 1).padStart(4, "0")}`,
	}));
}

function makeVariants(): Variant[] {
	return [
		{ id: "variant-A", name: "A", percentage: 70, contentOverrides: {} },
		{ id: "variant-B", name: "B", percentage: 30, contentOverrides: {} },
	];
}

describe("assignmentDigest", () => {
	it("is deterministic for the same inputs", () => {
		expect(assignmentDigest("t1", "s1", "u1")).toBe(
			assignmentDigest("t1", "s1", "u1"),
		);
	});
	it("differs when any input differs", () => {
		expect(assignmentDigest("t1", "s1", "u1")).not.toBe(
			assignmentDigest("t2", "s1", "u1"),
		);
		expect(assignmentDigest("t1", "s1", "u1")).not.toBe(
			assignmentDigest("t1", "s2", "u1"),
		);
		expect(assignmentDigest("t1", "s1", "u1")).not.toBe(
			assignmentDigest("t1", "s1", "u2"),
		);
	});
});

describe("generateAssignmentSeed", () => {
	it("returns a unique non-empty string each call", () => {
		const seeds = new Set<string>();
		for (let i = 0; i < 100; i += 1) {
			const seed = generateAssignmentSeed();
			expect(seed.length).toBeGreaterThan(0);
			seeds.add(seed);
		}
		expect(seeds.size).toBe(100);
	});
});

describe("buildAssignmentManifest", () => {
	it("produces the same manifest for the same inputs", () => {
		const members = makeMembers(1001);
		const snapshot = buildAudienceSnapshot([10], members);
		const variants = makeVariants();
		const params = {
			testId: "test-1",
			seed: "seed-abc",
			audience: snapshot,
			members,
			variants,
			testGroupPercentage: 10,
		};
		const a = buildAssignmentManifest(params);
		const b = buildAssignmentManifest(params);
		expect(b).toEqual(a);
	});

	it("produces a different manifest when the seed differs", () => {
		const members = makeMembers(100);
		const snapshot = buildAudienceSnapshot([10], members);
		const variants = makeVariants();
		const a = buildAssignmentManifest({
			testId: "test-1",
			seed: "seed-one",
			audience: snapshot,
			members,
			variants,
			testGroupPercentage: 50,
		});
		const b = buildAssignmentManifest({
			testId: "test-1",
			seed: "seed-two",
			audience: snapshot,
			members,
			variants,
			testGroupPercentage: 50,
		});
		expect(a.groups[0]?.subscriberChecksum).not.toBe(
			b.groups[0]?.subscriberChecksum,
		);
	});

	it("splits 1001 at 10% test / 70:30 variants into 70/30/901", () => {
		const members = makeMembers(1001);
		const snapshot = buildAudienceSnapshot([10], members);
		const manifest = buildAssignmentManifest({
			testId: "test-1",
			seed: "seed",
			audience: snapshot,
			members,
			variants: makeVariants(),
			testGroupPercentage: 10,
		});
		const variantA = manifest.groups.find((group) => group.variantId === "variant-A");
		const variantB = manifest.groups.find((group) => group.variantId === "variant-B");
		const holdout = manifest.groups.find((group) => group.kind === "holdout");
		expect(variantA?.expectedCount).toBe(70);
		expect(variantB?.expectedCount).toBe(30);
		expect(holdout?.expectedCount).toBe(901);
		expect(manifest.assignedCount).toBe(1001);
	});

	it("enforces variant sizes sum to the test group size", () => {
		const members = makeMembers(101);
		const snapshot = buildAudienceSnapshot([10], members);
		const manifest = buildAssignmentManifest({
			testId: "test-1",
			seed: "seed",
			audience: snapshot,
			members,
			variants: [
				{ id: "a", name: "A", percentage: 34, contentOverrides: {} },
				{ id: "b", name: "B", percentage: 33, contentOverrides: {} },
				{ id: "c", name: "C", percentage: 33, contentOverrides: {} },
			],
			testGroupPercentage: 100,
		});
		const variantTotal = manifest.groups
			.filter((group) => group.kind === "variant")
			.reduce((sum, group) => sum + group.expectedCount, 0);
		expect(variantTotal).toBe(101);
		// 101 across 34/33/33 -> largest remainder gives 35/33/33
		const counts = manifest.groups
			.filter((group) => group.kind === "variant")
			.map((group) => group.expectedCount);
		expect(counts).toEqual([35, 33, 33]);
	});

	it("rejects a members/snapshot count mismatch", () => {
		const members = makeMembers(10);
		const snapshot = buildAudienceSnapshot([10], makeMembers(20));
		expect(() =>
			buildAssignmentManifest({
				testId: "test-1",
				seed: "seed",
				audience: snapshot,
				members,
				variants: makeVariants(),
				testGroupPercentage: 10,
			}),
		).toThrow();
	});

	it("rejects an empty variants array", () => {
		const members = makeMembers(10);
		const snapshot = buildAudienceSnapshot([10], members);
		expect(() =>
			buildAssignmentManifest({
				testId: "test-1",
				seed: "seed",
				audience: snapshot,
				members,
				variants: [],
				testGroupPercentage: 10,
			}),
		).toThrow();
	});

	it("assigns every member to exactly one group (union equals audience, sets disjoint)", () => {
		// Use groupIndexForUuid to verify every UUID lands in exactly one group
		// and that re-deriving the ranking reproduces the manifest partition.
		const members = makeMembers(500);
		const snapshot = buildAudienceSnapshot([10], members);
		const manifest = buildAssignmentManifest({
			testId: "test-union",
			seed: "seed-union",
			audience: snapshot,
			members,
			variants: makeVariants(),
			testGroupPercentage: 20,
		});
		const assigned = new Set<string>();
		for (const member of members) {
			const index = groupIndexForUuid(
				manifest,
				"test-union",
				members,
				member.subscriberUuid,
			);
			expect(index).toBeGreaterThanOrEqual(0);
			expect(assigned.has(member.subscriberUuid)).toBe(false);
			assigned.add(member.subscriberUuid);
		}
		expect(assigned.size).toBe(500);
	});

	it("returns -1 from groupIndexForUuid for a UUID not in the audience", () => {
		const members = makeMembers(10);
		const snapshot = buildAudienceSnapshot([10], members);
		const manifest = buildAssignmentManifest({
			testId: "test-1",
			seed: "seed",
			audience: snapshot,
			members,
			variants: makeVariants(),
			testGroupPercentage: 50,
		});
		expect(
			groupIndexForUuid(manifest, "test-1", members, "not-in-audience"),
		).toBe(-1);
	});

	it("produces a manifest independent of the input member order", () => {
		const members = makeMembers(200);
		const snapshot = buildAudienceSnapshot([10], members);
		const variants = makeVariants();
		const shuffled = [...members].reverse();
		const a = buildAssignmentManifest({
			testId: "test-1",
			seed: "seed",
			audience: snapshot,
			members,
			variants,
			testGroupPercentage: 30,
		});
		const b = buildAssignmentManifest({
			testId: "test-1",
			seed: "seed",
			audience: snapshot,
			members: shuffled,
			variants,
			testGroupPercentage: 30,
		});
		expect(b).toEqual(a);
	});
});

describe("groupChecksum", () => {
	it("is independent of input ordering", () => {
		expect(groupChecksum(["a", "b", "c"])).toBe(groupChecksum(["c", "a", "b"]));
	});
	it("differs for different sets", () => {
		expect(groupChecksum(["a", "b"])).not.toBe(groupChecksum(["a", "c"]));
	});
});
