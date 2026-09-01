/**
 * Stratified split for A/B test assignment.
 *
 * Implements the advanced experimentation followup's Change Set B:
 * recipient-domain-based stratification that ensures each provider
 * stratum gets a proportional share of every variant/holdout group.
 *
 * The algorithm uses a constrained quota matrix where:
 * - Each stratum's row sum equals the stratum's subscriber count.
 * - Each group's column sum equals the group's global exact count.
 * - Each cell is floor or ceil of the ideal proportional allocation.
 *
 * This prevents a single large provider (e.g., Gmail) from dominating
 * one variant and skewing results.
 */

import type { AudienceMember } from "./audience";
import { rankMembers } from "./assignment";

export interface StratificationPolicyV1 {
	version: 1;
	dimension: "recipient_domain_provider";
	enabled: boolean;
	/**
	 * Map of provider name to list of domains. Domains not in any
	 * provider's list are classified as "other".
	 */
	providerDomainMap: Record<string, string[]>;
	/** Minimum subscribers for a stratum to remain independent. */
	minimumStratumSize: number;
	/** Strata below minimumStratumSize are merged into "other". */
	smallStratumFallback: "merge_into_other";
	/** Key for subscribers whose domain cannot be determined. */
	unknownStratumKey: string;
	/** Key for domains not matching any provider. */
	otherStratumKey: string;
}

export const DEFAULT_STRATIFICATION_POLICY: StratificationPolicyV1 = {
	version: 1,
	dimension: "recipient_domain_provider",
	enabled: false,
	providerDomainMap: {
		gmail: ["gmail.com", "googlemail.com"],
		naver: ["naver.com"],
		daum: ["daum.net", "hanmail.net"],
		kakao: ["kakao.com"],
	},
	minimumStratumSize: 20,
	smallStratumFallback: "merge_into_other",
	unknownStratumKey: "unknown",
	otherStratumKey: "other",
};

/**
 * Normalize an email domain for consistent matching.
 * 1. Take the part after the last "@".
 * 2. Trim and lowercase.
 * 3. Remove trailing dots.
 */
export function normalizeDomain(email: string): string {
	const atIndex = email.lastIndexOf("@");
	if (atIndex < 0 || atIndex === email.length - 1) {
		return "";
	}
	let domain = email.slice(atIndex + 1).trim().toLowerCase();
	domain = domain.replace(/\.+$/, "");
	return domain;
}

/**
 * Build a domain-to-provider lookup map by normalizing each configured
 * domain with the same rules applied to subscriber emails. This ensures a
 * mixed-case or trailing-dot entry in the providerDomainMap (e.g.
 * "GMAIL.COM") still classifies matching subscribers correctly.
 */
function buildProviderLookup(
	policy: StratificationPolicyV1,
): Map<string, string> {
	const lookup = new Map<string, string>();
	for (const [provider, domains] of Object.entries(policy.providerDomainMap)) {
		for (const rawDomain of domains) {
			const normalized = normalizeDomain(`@${rawDomain}`);
			if (normalized !== "") {
				lookup.set(normalized, provider);
			}
		}
	}
	return lookup;
}

/**
 * Build a reusable stratum classifier for a policy. The provider-domain
 * lookup map is built once, so classifying a large audience avoids
 * rebuilding it for every subscriber. The returned function has the same
 * semantics as {@link classifyStratum}.
 */
export function createStratumClassifier(
	policy: StratificationPolicyV1,
): (email: string) => string {
	const lookup = buildProviderLookup(policy);
	const unknownKey = policy.unknownStratumKey;
	const otherKey = policy.otherStratumKey;
	return (email: string): string => {
		const domain = normalizeDomain(email);
		if (domain === "") {
			return unknownKey;
		}
		const provider = lookup.get(domain);
		if (provider !== undefined) {
			return provider;
		}
		return otherKey;
	};
}

/**
 * Classify a subscriber's email domain into a stratum key using
 * the provider domain map. Configured domains are normalized with the same
 * rules applied to subscriber emails so mixed-case or trailing-dot entries
 * match correctly.
 *
 * For large audiences, prefer {@link createStratumClassifier} to build the
 * provider lookup once and avoid rebuilding it per subscriber.
 */
export function classifyStratum(
	email: string,
	policy: StratificationPolicyV1,
): string {
	const classifier = createStratumClassifier(policy);
	return classifier(email);
}

export interface StratumQuotaCell {
	stratumKey: string;
	groupKey: string;
	quota: number;
	ideal: number;
}

export interface StratificationResult {
	/** The quota matrix: quotas[stratumKey][groupKey] = count. */
	quotas: Record<string, Record<string, number>>;
	/** Per-cell detail for validation and reporting. */
	cells: StratumQuotaCell[];
	/** Final stratum sizes after small-stratum merge. */
	stratumSizes: Record<string, number>;
}

/**
 * Compute a constrained quota matrix where row sums match stratum
 * sizes and column sums match group exact counts.
 *
 * Uses the largest-remainder method independently per stratum, then
 * fixes column sums via iterative rounding correction.
 */
export function computeStratifiedQuotas(params: {
	stratumSizes: Record<string, number>;
	groupExactCounts: Record<string, number>;
	groupOrder: string[];
	totalAudience: number;
}): StratificationResult {
	const { stratumSizes, groupExactCounts, groupOrder, totalAudience } =
		params;

	// Validate that every stratum size and group count is a non-negative
	// integer before summing, so fractional or negative components cannot
	// produce a "valid" total that hides malformed input.
	const isNonNegInt = (n: unknown): boolean =>
		typeof n === "number" && Number.isInteger(n) && n >= 0;
	for (const [k, v] of Object.entries(stratumSizes)) {
		if (!isNonNegInt(v)) {
			throw new Error(
				`Stratified quota invariant: stratum "${k}" size must be a non-negative integer, received ${JSON.stringify(v)}`,
			);
		}
	}
	for (const [k, v] of Object.entries(groupExactCounts)) {
		if (!isNonNegInt(v)) {
			throw new Error(
				`Stratified quota invariant: group "${k}" count must be a non-negative integer, received ${JSON.stringify(v)}`,
			);
		}
	}

	const totalFromStrata = Object.values(stratumSizes).reduce(
		(sum, n) => sum + n,
		0,
	);
	const totalFromGroups = Object.values(groupExactCounts).reduce(
		(sum, n) => sum + n,
		0,
	);
	if (totalFromStrata !== totalFromGroups) {
		throw new Error(
			`Stratified quota invariant: strata sum ${totalFromStrata} != groups sum ${totalFromGroups}`,
		);
	}
	if (totalAudience <= 0) {
		// An empty audience (all-zero strata/groups) would pass the equality
		// checks above but produce NaN ideals via 0/0 division. Reject it
		// explicitly so callers cannot persist NaN quota matrices.
		throw new Error(
			`Stratified quota invariant: totalAudience must be positive, received ${totalAudience}`,
		);
	}
	if (totalAudience !== totalFromStrata) {
		// totalAudience is the divisor for proportional ideals; a mismatch
		// (including zero) silently skews proportions or yields NaN cells.
		throw new Error(
			`Stratified quota invariant: totalAudience ${totalAudience} != strata sum ${totalFromStrata}`,
		);
	}

	const quotas: Record<string, Record<string, number>> = {};
	const cells: StratumQuotaCell[] = [];

	// Phase 1: Largest remainder per stratum row.
	for (const [stratumKey, stratumSize] of Object.entries(stratumSizes)) {
		const rowQuotas: Record<string, number> = {};
		const ideals: Array<{ groupKey: string; ideal: number; index: number }> =
			[];

		for (const [index, groupKey] of groupOrder.entries()) {
			const exactCount = groupExactCounts[groupKey];
			if (exactCount === undefined) {
				throw new Error(
					`Stratified quota invariant: group "${groupKey}" is in groupOrder but missing from groupExactCounts`,
				);
			}
			const ideal = (stratumSize * exactCount) / totalAudience;
			ideals.push({ groupKey, ideal, index });
			rowQuotas[groupKey] = Math.floor(ideal);
		}

		const allocated = Object.values(rowQuotas).reduce((sum, n) => sum + n, 0);
		let remaining = stratumSize - allocated;

		// Distribute remaining seats by largest fractional remainder.
		const sorted = [...ideals].sort((a, b) => {
			const remA = a.ideal - Math.floor(a.ideal);
			const remB = b.ideal - Math.floor(b.ideal);
			if (remB !== remA) return remB - remA;
			return a.index - b.index;
		});
		for (const { groupKey } of sorted) {
			if (remaining <= 0) break;
			rowQuotas[groupKey] = (rowQuotas[groupKey] ?? 0) + 1;
			remaining -= 1;
		}

		quotas[stratumKey] = rowQuotas;
		for (const groupKey of groupOrder) {
			const ideal = ideals.find((i) => i.groupKey === groupKey)?.ideal ?? 0;
			cells.push({
				stratumKey,
				groupKey,
				quota: rowQuotas[groupKey] ?? 0,
				ideal,
			});
		}
	}

	// Phase 2: Column correction via paired seat swaps.
	// After row-wise allocation, column sums may differ from exact counts
	// by small amounts. Because the row and column totals both equal
	// totalAudience, every surplus column's excess equals the sum of deficit
	// columns' shortfalls. We resolve this with paired swaps: in a single
	// stratum row, decrease a surplus-group cell by one and increase a
	// deficit-group cell by one. Each swap preserves the row sum while
	// moving both involved columns one step toward their exact count.
	const columnDeficit: Record<string, number> = {};
	for (const groupKey of groupOrder) {
		const exactCount = groupExactCounts[groupKey] ?? 0;
		const currentSum = Object.values(quotas).reduce(
			(sum, row) => sum + (row[groupKey] ?? 0),
			0,
		);
		columnDeficit[groupKey] = exactCount - currentSum;
	}

	// Build a lookup map of ideal values to avoid repeated linear scans of
	// the cells array inside the correction loop.
	const idealLookup = new Map<string, number>();
	for (const cell of cells) {
		idealLookup.set(`${cell.stratumKey}:${cell.groupKey}`, cell.ideal);
	}

	const cellDeviation = (stratumKey: string, groupKey: string): number => {
		const row = quotas[stratumKey];
		const quota = row?.[groupKey] ?? 0;
		const ideal = idealLookup.get(`${stratumKey}:${groupKey}`) ?? 0;
		return quota - ideal;
	};

	// Repeatedly pick a deficit group and a surplus group, then find a row
	// where the deficit cell is most below ideal and the surplus cell has a
	// seat to give (quota > 0). Swap one seat. Loop until all deficits are
	// resolved or no swap is possible.
	// Upper bound on iterations: total absolute deficit, which is bounded
	// by the number of strata times the number of groups.
	const stratumKeys = Object.keys(quotas);
	const maxIterations =
		stratumKeys.length * groupOrder.length * groupOrder.length + 16;
	for (let iter = 0; iter < maxIterations; iter += 1) {
		const deficitGroups = groupOrder.filter((g) => (columnDeficit[g] ?? 0) > 0);
		const surplusGroups = groupOrder.filter((g) => (columnDeficit[g] ?? 0) < 0);
		if (deficitGroups.length === 0 || surplusGroups.length === 0) break;

		// Evaluate all feasible (deficit, surplus, stratum) triples and pick
		// the best swap rather than greedily fixing on the first deficit and
		// first surplus group, which could consume the only viable swap for a
		// later pair.
		let bestSwap: {
			deficitGroup: string;
			surplusGroup: string;
			stratum: string;
			bounded: boolean;
			score: number;
		} | null = null;
		for (const deficitGroup of deficitGroups) {
			for (const surplusGroup of surplusGroups) {
				// Choose the best row for this (deficit, surplus) pair. Prefer
				// swaps that keep cells within their floor-or-ceiling allocation.
				for (const sk of stratumKeys) {
					const row = quotas[sk];
					if (!row) continue;
					const surplusQuota = row[surplusGroup] ?? 0;
					const deficitQuota = row[deficitGroup] ?? 0;
					const surplusIdeal =
						idealLookup.get(`${sk}:${surplusGroup}`) ?? 0;
					const deficitIdeal =
						idealLookup.get(`${sk}:${deficitGroup}`) ?? 0;
					// Require a positive donor and a receiver below ceiling.
					if (surplusQuota <= 0) continue;
					if (deficitQuota >= Math.ceil(deficitIdeal)) continue;
					const surplusBounded = surplusQuota > Math.floor(surplusIdeal);
					const deficitBounded = deficitQuota < Math.ceil(deficitIdeal);
					const bounded = surplusBounded && deficitBounded;
					const deficitDev = deficitQuota - deficitIdeal;
					const surplusDev = surplusQuota - surplusIdeal;
					const score = surplusDev - deficitDev;
					// Pick the globally best swap across all pairs.
					if (
						bestSwap === null ||
						(bounded && !bestSwap.bounded) ||
						(bounded === bestSwap.bounded && score > bestSwap.score)
					) {
						bestSwap = {
							deficitGroup,
							surplusGroup,
							stratum: sk,
							bounded,
							score,
						};
					}
				}
			}
		}
		if (!bestSwap) break;

		const row = quotas[bestSwap.stratum];
		if (!row) break;
		row[bestSwap.deficitGroup] =
			(row[bestSwap.deficitGroup] ?? 0) + 1;
		row[bestSwap.surplusGroup] =
			(row[bestSwap.surplusGroup] ?? 0) - 1;
		columnDeficit[bestSwap.deficitGroup] =
			(columnDeficit[bestSwap.deficitGroup] ?? 0) - 1;
		columnDeficit[bestSwap.surplusGroup] =
			(columnDeficit[bestSwap.surplusGroup] ?? 0) + 1;
	}

	// Verify convergence: every column deficit should be resolved to zero.
	// If the loop exited early (no donating row or iteration cap reached),
	// the column sums would silently disagree with the exact counts.
	for (const groupKey of groupOrder) {
		const residual = columnDeficit[groupKey] ?? 0;
		if (residual !== 0) {
			throw new Error(
				`Stratified quota did not converge: column "${groupKey}" has residual deficit ${residual}`,
			);
		}
	}

	// Update cell quotas after correction.
	for (const cell of cells) {
		const row = quotas[cell.stratumKey];
		cell.quota = row?.[cell.groupKey] ?? 0;
	}

	return {
		quotas,
		cells,
		stratumSizes,
	};
}

export interface StratifiedAssignmentGroup {
	/** Manifest group key: `variant:<variantId>` or `holdout`. */
	groupKey: string;
	expectedCount: number;
	subscriberIds: number[];
}

export interface StratifiedAssignment {
	/** One entry per input group, in the input order. */
	groups: StratifiedAssignmentGroup[];
	/** The exact quota matrix the slices realize; store this on the test. */
	stratification: StratificationResult;
}

/**
 * Bucket audience members by recipient-domain stratum, applying the same
 * small-stratum merge the reporting path documents, and return the buckets
 * keyed by sorted stratum so downstream slicing is deterministic regardless
 * of audience iteration order.
 */
function bucketMembersByStratum(
	members: readonly AudienceMember[],
	policy: StratificationPolicyV1,
): Map<string, AudienceMember[]> {
	const classifier = createStratumClassifier(policy);
	const buckets = new Map<string, AudienceMember[]>();
	for (const member of members) {
		const stratum = classifier(member.email ?? "");
		const bucket = buckets.get(stratum);
		if (bucket) {
			bucket.push(member);
		} else {
			buckets.set(stratum, [member]);
		}
	}
	if (
		policy.minimumStratumSize > 0 &&
		policy.smallStratumFallback === "merge_into_other"
	) {
		const otherKey = policy.otherStratumKey;
		for (const [stratum, bucket] of [...buckets.entries()]) {
			if (stratum !== otherKey && bucket.length < policy.minimumStratumSize) {
				buckets.delete(stratum);
				const other = buckets.get(otherKey);
				if (other) {
					for (const member of bucket) {
						other.push(member);
					}
				} else {
					buckets.set(otherKey, bucket);
				}
			}
		}
	}
	return new Map(
		[...buckets.entries()].sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		),
	);
}

/**
 * Turn the constrained quota matrix into concrete per-group subscriber
 * slices. Within each stratum, members are ranked with the same
 * SHA-256 digest ordering the unstratified manifest uses (restricted to
 * that stratum), and each group consumes its quota cell from the front of
 * that ranking. The result is deterministic for a given
 * (testId, seed, audience, policy): crash-resume adoption under the
 * persisted seed re-derives identical slices, so membership sync stays
 * idempotent.
 *
 * Invariants (validated by tests):
 * - each group's slice length equals its manifest expectedCount;
 * - slices are disjoint and their union is the full audience;
 * - per-stratum group counts equal the stored quota matrix cells.
 */
export function assignStratifiedMembers(params: {
	testId: string;
	seed: string;
	members: readonly AudienceMember[];
	policy: StratificationPolicyV1;
	/** Manifest groups in manifest order with their exact counts. */
	groups: readonly { groupKey: string; expectedCount: number }[];
}): StratifiedAssignment {
	const { testId, seed, members, policy, groups } = params;
	if (groups.length === 0) {
		throw new Error(
			"Stratified assignment invariant: at least one group is required",
		);
	}

	const buckets = bucketMembersByStratum(members, policy);
	const stratumSizes: Record<string, number> = {};
	for (const [stratum, bucket] of buckets) {
		stratumSizes[stratum] = bucket.length;
	}
	const groupExactCounts: Record<string, number> = {};
	const groupOrder: string[] = [];
	for (const group of groups) {
		if (groupOrder.includes(group.groupKey)) {
			throw new Error(
				`Stratified assignment invariant: duplicate group key ${group.groupKey}`,
			);
		}
		groupOrder.push(group.groupKey);
		groupExactCounts[group.groupKey] = group.expectedCount;
	}

	const stratification = computeStratifiedQuotas({
		stratumSizes,
		groupExactCounts,
		groupOrder,
		totalAudience: members.length,
	});

	const slices = new Map<string, number[]>(
		groupOrder.map((groupKey) => [groupKey, []]),
	);
	for (const [stratum, bucket] of buckets) {
		const row = stratification.quotas[stratum] ?? {};
		const ranked = rankMembers(testId, seed, bucket);
		let cursor = 0;
		for (const groupKey of groupOrder) {
			const quota = row[groupKey] ?? 0;
			const take = ranked.slice(cursor, cursor + quota);
			cursor += quota;
			// Accumulate with a loop, not spread-push: a dominant provider
			// stratum's quota cell scales with the audience and can exceed the
			// engine's call-argument cap, which would throw a RangeError and
			// silently degrade stratification at exactly the scale it exists
			// for.
			const slice = slices.get(groupKey);
			if (slice) {
				for (const entry of take) {
					slice.push(entry.member.subscriberId);
				}
			}
		}
		// A row whose ranked bucket could not satisfy its quotas would leave
		// members unassigned and break the union invariant; the quota matrix
		// guarantees row sums match bucket sizes, so treat leftovers as a
		// hard invariant failure rather than silently dropping subscribers.
		if (cursor !== ranked.length) {
			throw new Error(
				`Stratified assignment invariant: stratum "${stratum}" consumed ${cursor} of ${ranked.length} ranked members`,
			);
		}
	}

	return {
		groups: groups.map((group) => {
			const subscriberIds = slices.get(group.groupKey) ?? [];
			if (subscriberIds.length !== group.expectedCount) {
				throw new Error(
					`Stratified assignment invariant: group ${group.groupKey} received ${subscriberIds.length} members, expected ${group.expectedCount}`,
				);
			}
			return {
				groupKey: group.groupKey,
				expectedCount: group.expectedCount,
				subscriberIds,
			};
		}),
		stratification,
	};
}
