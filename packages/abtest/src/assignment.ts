import { createHash, randomUUID } from "node:crypto";
import {
	allocateByLargestRemainder,
	allocateTestAndHoldout,
} from "./allocation";
import type { AudienceMember, AudienceSnapshot } from "./audience";
import type { Variant } from "./types";

/**
 * Deterministic subscriber-to-group assignment for A/B test provisioning.
 *
 * The previous implementation shuffled subscribers with Math.random(), so a
 * retry or reconcile would produce a different split and a subscriber could
 * land in a different variant's list than the one they originally received.
 * This module replaces that with a deterministic hash ordering: each
 * subscriber UUID is ranked by a SHA-256 digest derived from the test id, a
 * stored random seed, and the UUID itself, then sliced by exact allocation
 * counts. The same test id + seed + audience always produces the same
 * manifest, so retries and reconciliation never re-split the audience.
 */

const ASSIGNMENT_VERSION = "abtest-assignment:v1";

export interface AssignmentGroup {
	kind: "variant" | "holdout";
	variantId?: string;
	expectedCount: number;
	/** SHA-256 over the sorted UUIDs assigned to this group. */
	subscriberChecksum: string;
}

export interface AssignmentManifest {
	algorithm: "sha256-order-largest-remainder-v1";
	seed: string;
	audienceChecksum: string;
	groups: AssignmentGroup[];
	assignedCount: number;
}

export class AssignmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssignmentError";
	}
}

/**
 * Generate a fresh cryptographic random seed. Stored on the test so future
 * re-derivations reproduce the same manifest.
 */
export function generateAssignmentSeed(): string {
	return randomUUID();
}

/**
 * Compute the deterministic ordering digest for a single subscriber UUID
 * within a test. The digest is `SHA-256(version \0 testId \0 seed \0 uuid)`.
 */
export function assignmentDigest(
	testId: string,
	seed: string,
	subscriberUuid: string,
): string {
	const stream = [ASSIGNMENT_VERSION, testId, seed, subscriberUuid].join("\0");
	return createHash("sha256").update(stream, "utf8").digest("hex");
}

/**
 * Compute a SHA-256 checksum over a sorted set of UUIDs, so two groups with
 * the same members always share a checksum regardless of insertion order.
 */
export function groupChecksum(uuids: readonly string[]): string {
	const sorted = [...uuids].sort();
	return createHash("sha256")
		.update(sorted.join("\n"), "utf8")
		.digest("hex");
}

/**
 * Build a deterministic assignment manifest from a resolved audience. The
 * manifest assigns every audience member to exactly one group (a variant or
 * the holdout) using:
 *   1. largest-remainder allocation for test/holdout sizes and per-variant
 *      sizes (sums always equal the audience total);
 *   2. SHA-256 digest ordering of subscriber UUIDs, with UUID ascending as
 *      the tie-break, so the same inputs always slice the same subscribers
 *      into the same groups.
 *
 * Invariants enforced:
 *   - sum(variant expectedCount) === testGroupSize
 *   - testGroupSize + holdoutGroupSize === audience subscriberCount
 *   - variant and holdout UUID sets are disjoint
 *   - their union equals the full audience
 */
export function buildAssignmentManifest(params: {
	testId: string;
	seed: string;
	audience: AudienceSnapshot;
	members: readonly AudienceMember[];
	variants: Variant[];
	testGroupPercentage: number;
}): AssignmentManifest {
	const { testId, seed, audience, members, variants, testGroupPercentage } =
		params;

	if (members.length !== audience.subscriberCount) {
		throw new AssignmentError(
			`audience size mismatch: members=${members.length} snapshot=${audience.subscriberCount}`,
		);
	}
	if (variants.length === 0) {
		throw new AssignmentError("at least one variant is required");
	}

	// Rank every member by its deterministic digest, tie-breaking by UUID so
	// the order is fully determined by (testId, seed, audience).
	const ranked = members
		.map((member) => ({
			member,
			digest: assignmentDigest(testId, seed, member.subscriberUuid),
		}))
		.sort((a, b) => {
			if (a.digest !== b.digest) {
				return a.digest < b.digest ? -1 : 1;
			}
			return a.member.subscriberUuid < b.member.subscriberUuid ? -1 : 1;
		});

	const total = ranked.length;

	// Exact test/holdout split.
	const { testGroupSize, holdoutGroupSize } = allocateTestAndHoldout({
		audienceSize: total,
		testGroupPercentage,
	});

	// Exact per-variant split within the test group.
	const variantSizes = allocateByLargestRemainder({
		total: testGroupSize,
		weights: variants.map((variant) => variant.percentage),
	}).counts;

	// Slice the ranked audience in order: variants first, then holdout.
	const groups: AssignmentGroup[] = [];
	let cursor = 0;
	for (const [index, variant] of variants.entries()) {
		const size = variantSizes[index] ?? 0;
		const slice = ranked.slice(cursor, cursor + size);
		const uuids = slice.map((entry) => entry.member.subscriberUuid);
		groups.push({
			kind: "variant",
			variantId: variant.id,
			expectedCount: size,
			subscriberChecksum: groupChecksum(uuids),
		});
		cursor += size;
	}

	const holdoutSlice = ranked.slice(cursor);
	const holdoutUuids = holdoutSlice.map((entry) => entry.member.subscriberUuid);
	groups.push({
		kind: "holdout",
		expectedCount: holdoutGroupSize,
		subscriberChecksum: groupChecksum(holdoutUuids),
	});

	// Invariant checks.
	const variantTotal = groups
		.filter((group) => group.kind === "variant")
		.reduce((sum, group) => sum + group.expectedCount, 0);
	const manifestTotal = variantTotal + holdoutGroupSize;
	if (variantTotal !== testGroupSize) {
		throw new AssignmentError(
			`variant sizes sum ${variantTotal} !== testGroupSize ${testGroupSize}`,
		);
	}
	if (manifestTotal !== total) {
		throw new AssignmentError(
			`manifest total ${manifestTotal} !== audience ${total}`,
		);
	}

	return {
		algorithm: "sha256-order-largest-remainder-v1",
		seed,
		audienceChecksum: audience.subscriberChecksum,
		groups,
		assignedCount: total,
	};
}

/**
 * Resolve which group a single subscriber UUID belongs to under a manifest.
 * Returns the group index, or null if the UUID is not covered by the manifest
 * (used by reconcile checks to detect drift). This re-derives the digest and
 * re-ranks, so it is only valid when the caller can reproduce the full member
 * set; for membership lookups during provisioning, slice the manifest groups
 * directly instead.
 */
export function groupIndexForUuid(
	manifest: AssignmentManifest,
	testId: string,
	members: readonly AudienceMember[],
	subscriberUuid: string,
): number {
	const ranked = members
		.map((member) => ({
			member,
			digest: assignmentDigest(testId, manifest.seed, member.subscriberUuid),
		}))
		.sort((a, b) => {
			if (a.digest !== b.digest) {
				return a.digest < b.digest ? -1 : 1;
			}
			return a.member.subscriberUuid < b.member.subscriberUuid ? -1 : 1;
		});
	let cursor = 0;
	for (let index = 0; index < manifest.groups.length; index += 1) {
		const group = manifest.groups[index];
		if (group === undefined) {
			continue;
		}
		const next = cursor + group.expectedCount;
		for (let position = cursor; position < next; position += 1) {
			const entry = ranked[position];
			if (entry?.member.subscriberUuid === subscriberUuid) {
				return index;
			}
		}
		cursor = next;
	}
	return -1;
}
