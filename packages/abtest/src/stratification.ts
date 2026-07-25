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
 * Classify a subscriber's email domain into a stratum key using
 * the provider domain map.
 */
export function classifyStratum(
	email: string,
	policy: StratificationPolicyV1,
): string {
	const domain = normalizeDomain(email);
	if (domain === "") {
		return policy.unknownStratumKey;
	}
	for (const [provider, domains] of Object.entries(policy.providerDomainMap)) {
		if (domains.includes(domain)) {
			return provider;
		}
	}
	return policy.otherStratumKey;
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

	const quotas: Record<string, Record<string, number>> = {};
	const cells: StratumQuotaCell[] = [];

	// Phase 1: Largest remainder per stratum row.
	for (const [stratumKey, stratumSize] of Object.entries(stratumSizes)) {
		const rowQuotas: Record<string, number> = {};
		const ideals: Array<{ groupKey: string; ideal: number; index: number }> =
			[];

		for (const [index, groupKey] of groupOrder.entries()) {
			const exactCount = groupExactCounts[groupKey] ?? 0;
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

	const cellDeviation = (stratumKey: string, groupKey: string): number => {
		const row = quotas[stratumKey];
		const quota = row?.[groupKey] ?? 0;
		const ideal =
			cells.find((c) => c.stratumKey === stratumKey && c.groupKey === groupKey)
				?.ideal ?? 0;
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
		const deficitGroup = groupOrder.find((g) => (columnDeficit[g] ?? 0) > 0);
		const surplusGroup = groupOrder.find((g) => (columnDeficit[g] ?? 0) < 0);
		if (!deficitGroup || !surplusGroup) break;

		// Choose the row where the deficit cell is most below ideal and the
		// surplus cell can donate (quota > 0). This keeps cell deviations
		// minimal and avoids negative quotas.
		let bestStratum: string | null = null;
		let bestScore = -Infinity;
		for (const sk of stratumKeys) {
			const row = quotas[sk];
			if (!row) continue;
			const surplusQuota = row[surplusGroup] ?? 0;
			if (surplusQuota <= 0) continue;
			const deficitDev = cellDeviation(sk, deficitGroup);
			const surplusDev = cellDeviation(sk, surplusGroup);
			// Prefer rows where the deficit cell is far below ideal and the
			// surplus cell is far above ideal.
			const score = surplusDev - deficitDev;
			if (score > bestScore) {
				bestScore = score;
				bestStratum = sk;
			}
		}
		if (!bestStratum) break;

		const row = quotas[bestStratum];
		if (!row) break;
		row[deficitGroup] = (row[deficitGroup] ?? 0) + 1;
		row[surplusGroup] = (row[surplusGroup] ?? 0) - 1;
		columnDeficit[deficitGroup] = (columnDeficit[deficitGroup] ?? 0) - 1;
		columnDeficit[surplusGroup] = (columnDeficit[surplusGroup] ?? 0) + 1;
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
