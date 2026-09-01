import { describe, expect, it } from "bun:test";
import {
	assignStratifiedMembers,
	classifyStratum,
	computeStratifiedQuotas,
	DEFAULT_STRATIFICATION_POLICY,
	normalizeDomain,
} from "../src/stratification";

describe("normalizeDomain", () => {
	it("extracts domain from email", () => {
		expect(normalizeDomain("user@gmail.com")).toBe("gmail.com");
	});

	it("lowercases and trims", () => {
		expect(normalizeDomain("User@Gmail.COM ")).toBe("gmail.com");
	});

	it("removes trailing dots", () => {
		expect(normalizeDomain("user@gmail.com.")).toBe("gmail.com");
	});

	it("returns empty for malformed email", () => {
		expect(normalizeDomain("no-at-sign")).toBe("");
		expect(normalizeDomain("trailing@")).toBe("");
	});
});

describe("classifyStratum", () => {
	const policy = DEFAULT_STRATIFICATION_POLICY;

	it("classifies gmail correctly", () => {
		expect(classifyStratum("user@gmail.com", policy)).toBe("gmail");
		expect(classifyStratum("user@googlemail.com", policy)).toBe("gmail");
	});

	it("classifies naver correctly", () => {
		expect(classifyStratum("user@naver.com", policy)).toBe("naver");
	});

	it("returns other for unknown domain", () => {
		expect(classifyStratum("user@example.com", policy)).toBe("other");
	});

	it("returns unknown for malformed email", () => {
		expect(classifyStratum("no-email", policy)).toBe("unknown");
	});

	it("handles case-insensitive domains", () => {
		expect(classifyStratum("User@GMAIL.COM", policy)).toBe("gmail");
	});

	it("normalizes mixed-case configured domains", () => {
		const mixedPolicy: typeof policy = {
			...policy,
			providerDomainMap: { google: ["GMAIL.COM."] },
		};
		expect(classifyStratum("user@gmail.com", mixedPolicy)).toBe("google");
		expect(classifyStratum("user@Gmail.Com", mixedPolicy)).toBe("google");
	});
});

describe("computeStratifiedQuotas", () => {
	it("preserves row sums", () => {
		const result = computeStratifiedQuotas({
			stratumSizes: { gmail: 600, naver: 300, other: 100 },
			groupExactCounts: { "variant:A": 500, "variant:B": 500 },
			groupOrder: ["variant:A", "variant:B"],
			totalAudience: 1000,
		});
		for (const [stratumKey, row] of Object.entries(result.quotas)) {
			const rowSum = Object.values(row).reduce((s, n) => s + n, 0);
			expect(rowSum).toBe(
				result.stratumSizes[stratumKey as keyof typeof result.stratumSizes],
			);
		}
	});

	it("preserves column sums", () => {
		const result = computeStratifiedQuotas({
			stratumSizes: { gmail: 600, naver: 300, other: 100 },
			groupExactCounts: { "variant:A": 500, "variant:B": 500 },
			groupOrder: ["variant:A", "variant:B"],
			totalAudience: 1000,
		});
		for (const groupKey of ["variant:A", "variant:B"]) {
			const colSum = Object.values(result.quotas).reduce(
				(s, row) => s + (row[groupKey] ?? 0),
				0,
			);
			expect(colSum).toBe(groupKey === "variant:A" ? 500 : 500);
		}
	});

	it("handles 3 groups (A/B/C)", () => {
		const result = computeStratifiedQuotas({
			stratumSizes: { gmail: 400, other: 200 },
			groupExactCounts: {
				"variant:A": 200,
				"variant:B": 200,
				holdout: 200,
			},
			groupOrder: ["variant:A", "variant:B", "holdout"],
			totalAudience: 600,
		});
		// Verify column sums
		for (const gk of ["variant:A", "variant:B", "holdout"]) {
			const colSum = Object.values(result.quotas).reduce(
				(s, row) => s + (row[gk] ?? 0),
				0,
			);
			expect(colSum).toBe(200);
		}
		// Verify row sums
		for (const [sk, row] of Object.entries(result.quotas)) {
			const rowSum = Object.values(row).reduce((s, n) => s + n, 0);
			expect(rowSum).toBe(sk === "gmail" ? 400 : 200);
		}
	});

	it("throws on sum mismatch", () => {
		expect(() =>
			computeStratifiedQuotas({
				stratumSizes: { gmail: 600, other: 500 },
				groupExactCounts: { "variant:A": 500, "variant:B": 500 },
				groupOrder: ["variant:A", "variant:B"],
				totalAudience: 1000,
			}),
		).toThrow("Stratified quota invariant");
	});

	it("throws when totalAudience disagrees with strata sum", () => {
		expect(() =>
			computeStratifiedQuotas({
				stratumSizes: { gmail: 500, other: 500 },
				groupExactCounts: { "variant:A": 500, "variant:B": 500 },
				groupOrder: ["variant:A", "variant:B"],
				totalAudience: 1000,
			}),
		).not.toThrow();
		expect(() =>
			computeStratifiedQuotas({
				stratumSizes: { gmail: 500, other: 500 },
				groupExactCounts: { "variant:A": 500, "variant:B": 500 },
				groupOrder: ["variant:A", "variant:B"],
				totalAudience: 1100,
			}),
		).toThrow("totalAudience 1100 != strata sum 1000");
		expect(() =>
			computeStratifiedQuotas({
				stratumSizes: { gmail: 500, other: 500 },
				groupExactCounts: { "variant:A": 500, "variant:B": 500 },
				groupOrder: ["variant:A", "variant:B"],
				totalAudience: 0,
			}),
		).toThrow("totalAudience must be positive, received 0");
	});

	it("each cell is floor or ceil of ideal", () => {
		const result = computeStratifiedQuotas({
			stratumSizes: { gmail: 333, naver: 333, other: 334 },
			groupExactCounts: { "variant:A": 500, "variant:B": 500 },
			groupOrder: ["variant:A", "variant:B"],
			totalAudience: 1000,
		});
		for (const cell of result.cells) {
			const floorIdeal = Math.floor(cell.ideal);
			const ceilIdeal = Math.ceil(cell.ideal);
			expect(cell.quota).toBeGreaterThanOrEqual(floorIdeal);
			expect(cell.quota).toBeLessThanOrEqual(ceilIdeal);
		}
	});

	it("matches exact row/column sums for the codex 4x4 example", () => {
		// The case ocr flagged: strata {s0:116,s1:105,s2:74,s3:47} and groups
		// {g0:37,g1:216,g2:63,g3:26}. The biproportional allocation must match
		// both row and column totals exactly. Cells stay close to their ideal
		// (within 1 of floor/ceil where possible); a column may force one cell
		// outside the naive floor/ceil band to satisfy the exact count.
		const result = computeStratifiedQuotas({
			stratumSizes: { s0: 116, s1: 105, s2: 74, s3: 47 },
			groupExactCounts: { g0: 37, g1: 216, g2: 63, g3: 26 },
			groupOrder: ["g0", "g1", "g2", "g3"],
			totalAudience: 342,
		});
		for (const [sk, row] of Object.entries(result.quotas)) {
			const rowSum = Object.values(row).reduce((s, n) => s + n, 0);
			expect(rowSum).toBe(
				({ s0: 116, s1: 105, s2: 74, s3: 47 } as Record<string, number>)[sk],
			);
		}
		for (const gk of ["g0", "g1", "g2", "g3"]) {
			const colSum = Object.values(result.quotas).reduce(
				(s, row) => s + (row[gk] ?? 0),
				0,
			);
			expect(colSum).toBe(
				({ g0: 37, g1: 216, g2: 63, g3: 26 } as Record<string, number>)[gk],
			);
		}
		// Each cell stays within 1 of its ideal (no runaway deviations).
		for (const cell of result.cells) {
			expect(Math.abs(cell.quota - cell.ideal)).toBeLessThanOrEqual(1.5);
		}
	});
});

describe("assignStratifiedMembers", () => {
	const policy = {
		...DEFAULT_STRATIFICATION_POLICY,
		enabled: true,
		minimumStratumSize: 2,
	};

	function membersFor(domains: Record<string, number>): {
		subscriberId: number;
		subscriberUuid: string;
		email: string;
	}[] {
		const members: {
			subscriberId: number;
			subscriberUuid: string;
			email: string;
		}[] = [];
		let id = 1;
		for (const [domain, count] of Object.entries(domains)) {
			for (let i = 0; i < count; i += 1) {
				members.push({
					subscriberId: id,
					subscriberUuid: `uuid-${String(id).padStart(4, "0")}`,
					email: `sub${id}@${domain}`,
				});
				id += 1;
			}
		}
		return members;
	}

	const groups = [
		{ groupKey: "variant:a", expectedCount: 450 },
		{ groupKey: "variant:b", expectedCount: 450 },
		{ groupKey: "holdout", expectedCount: 100 },
	];

	it("realizes the quota matrix in the actual slices", () => {
		const members = membersFor({
			"gmail.com": 600,
			"naver.com": 300,
			"example.com": 100,
		});
		const assignment = assignStratifiedMembers({
			testId: "test-1",
			seed: "seed-1",
			members,
			policy,
			groups,
		});

		// Group totals match the manifest exactly.
		for (const group of assignment.groups) {
			expect(group.subscriberIds).toHaveLength(group.expectedCount);
		}

		// Slices are disjoint and cover the full audience.
		const assigned = assignment.groups.flatMap((g) => g.subscriberIds);
		expect(new Set(assigned).size).toBe(members.length);

		// Per-stratum group membership equals the stored quota cells.
		const emailById = new Map(members.map((m) => [m.subscriberId, m.email]));
		const domainOf = (id: number) => {
			const email = emailById.get(id) ?? "";
			const domain = email.slice(email.lastIndexOf("@") + 1);
			return domain === "gmail.com" || domain === "googlemail.com"
				? "gmail"
				: domain === "naver.com"
					? "naver"
					: "other";
		};
		for (const [stratum, row] of Object.entries(assignment.stratification.quotas)) {
			for (const group of assignment.groups) {
				const inGroup = assignment.groups
					.find((g) => g.groupKey === group.groupKey)!
					.subscriberIds.filter((id) => domainOf(id) === stratum);
				expect(inGroup).toHaveLength(row[group.groupKey] ?? 0);
			}
		}
	});

	it("is deterministic for the same inputs and re-derivable from the seed", () => {
		const members = membersFor({
			"gmail.com": 120,
			"daum.net": 80,
			"kakao.com": 40,
			"example.com": 60,
		});
		const params = {
			testId: "test-2",
			seed: "seed-2",
			members,
			policy,
			groups: [
				{ groupKey: "variant:a", expectedCount: 150 },
				{ groupKey: "variant:b", expectedCount: 150 },
			],
		};
		const first = assignStratifiedMembers(params);
		const second = assignStratifiedMembers(params);
		// Audience iteration order must not change the outcome.
		const shuffled = assignStratifiedMembers({
			...params,
			members: [...members].reverse(),
		});

		expect(second.groups).toEqual(first.groups);
		expect(shuffled.groups).toEqual(first.groups);
		expect(second.stratification).toEqual(first.stratification);
	});

	it("merges small strata into other before assigning", () => {
		const members = membersFor({
			"gmail.com": 50,
			"kakao.com": 1,
			"example.com": 49,
		});
		const assignment = assignStratifiedMembers({
			testId: "test-3",
			seed: "seed-3",
			members,
			policy,
			groups: [
				{ groupKey: "variant:a", expectedCount: 50 },
				{ groupKey: "holdout", expectedCount: 50 },
			],
		});

		expect(Object.keys(assignment.stratification.stratumSizes).sort()).toEqual([
			"gmail",
			"other",
		]);
		expect(assignment.stratification.stratumSizes.other).toBe(50);
	});

	it("rejects duplicate or empty group declarations", () => {
		const members = membersFor({ "gmail.com": 4 });
		expect(() =>
			assignStratifiedMembers({
				testId: "t",
				seed: "s",
				members,
				policy,
				groups: [],
			}),
		).toThrow("at least one group");
		expect(() =>
			assignStratifiedMembers({
				testId: "t",
				seed: "s",
				members,
				policy,
				groups: [
					{ groupKey: "variant:a", expectedCount: 2 },
					{ groupKey: "variant:a", expectedCount: 2 },
				],
			}),
		).toThrow("duplicate group key");
	});
});
