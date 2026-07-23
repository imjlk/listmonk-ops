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
 * Rank every audience member by its deterministic digest, tie-breaking by
 * UUID. Shared by buildAssignmentManifest and the group-index lookups so the
 * ranking algorithm cannot drift between them. The comparator returns 0 for
 * identical (digest, uuid) pairs to honor the comparator contract even when
 * upstream data contains duplicate UUIDs.
 */
export function rankMembers(
	testId: string,
	seed: string,
	members: readonly AudienceMember[],
): { member: AudienceMember; digest: string }[] {
	return members
		.map((member) => ({
			member,
			digest: assignmentDigest(testId, seed, member.subscriberUuid),
		}))
		.sort((a, b) => {
			if (a.digest !== b.digest) {
				return a.digest < b.digest ? -1 : 1;
			}
			if (a.member.subscriberUuid === b.member.subscriberUuid) {
				return 0;
			}
			return a.member.subscriberUuid < b.member.subscriberUuid ? -1 : 1;
		});
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

	// Rank every member by its deterministic digest via the shared helper,
	// so the manifest and the group-index lookups share one ranking.
	const ranked = rankMembers(testId, seed, members);

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

	// Recompute the member UUID checksum and verify it matches the snapshot.
	// If the audience changed (even if the count stayed the same), the
	// persisted checksum would describe a different audience than the one we
	// just assigned, making later drift checks trust the wrong baseline.
	const recomputedChecksum = computeAudienceChecksum(members);
	if (
		audience.subscriberChecksum !== "" &&
		recomputedChecksum !== audience.subscriberChecksum
	) {
		throw new AssignmentError(
			`audience checksum mismatch: snapshot=${audience.subscriberChecksum} recomputed=${recomputedChecksum}`,
		);
	}

	return {
		algorithm: "sha256-order-largest-remainder-v1",
		seed,
		audienceChecksum: recomputedChecksum,
		groups,
		assignedCount: total,
	};
}

/**
 * Resolve which group a single subscriber UUID belongs to under a manifest.
 * Returns the group index, or -1 if the UUID is not covered by the manifest
 * (used by reconcile checks to detect drift). This re-derives the digest and
 * re-ranks via the shared rankMembers helper, so it is only valid when the
 * caller can reproduce the full member set; for membership lookups during
 * provisioning, slice the manifest groups directly instead.
 *
 * For bulk lookups, prefer groupIndexForUuids, which ranks once and answers
 * many queries.
 */
export function groupIndexForUuid(
	manifest: AssignmentManifest,
	testId: string,
	members: readonly AudienceMember[],
	subscriberUuid: string,
): number {
	const ranked = rankAndVerifyMembers(testId, manifest, members);
	return groupIndexOfRanked(ranked, manifest, subscriberUuid);
}

/**
 * Batch variant: rank the audience once and resolve every requested UUID to
 * its group index (-1 if not in the audience). O(n log n + m) rather than
 * O(m × n log n) when many lookups are needed during reconciliation.
 */
export function groupIndexForUuids(
	manifest: AssignmentManifest,
	testId: string,
	members: readonly AudienceMember[],
	subscriberUuids: readonly string[],
): Map<string, number> {
	const ranked = rankAndVerifyMembers(testId, manifest, members);
	const result = new Map<string, number>();
	for (const uuid of subscriberUuids) {
		result.set(uuid, groupIndexOfRanked(ranked, manifest, uuid));
	}
	return result;
}

/**
 * Rank members and verify the audience has not drifted from the manifest's
 * recorded checksum. If the current members' checksum differs from the
 * manifest's audienceChecksum, the caller is resolving a different audience
 * than the one that was originally assigned, so every lookup returns -1
 * rather than a misleading group index.
 */
function rankAndVerifyMembers(
	testId: string,
	manifest: AssignmentManifest,
	members: readonly AudienceMember[],
): { member: AudienceMember; digest: string }[] {
	const checksum = computeAudienceChecksum(members);
	if (checksum !== manifest.audienceChecksum) {
		// Audience drift: return an empty ranked list so every lookup yields -1.
		return [];
	}
	return rankMembers(testId, manifest.seed, members);
}

/**
 * Compute the SHA-256 audience checksum from member UUIDs. Shared by
 * buildAssignmentManifest (to stamp the manifest) and rankAndVerifyMembers
 * (to detect drift) so the two call sites cannot diverge.
 */
function computeAudienceChecksum(
	members: readonly AudienceMember[],
): string {
	return groupChecksum(members.map((member) => member.subscriberUuid));
}

function groupIndexOfRanked(
	ranked: { member: AudienceMember; digest: string }[],
	manifest: AssignmentManifest,
	subscriberUuid: string,
): number {
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
