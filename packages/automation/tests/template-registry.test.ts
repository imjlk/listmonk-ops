import { describe, expect, test } from "bun:test";
import {
	liveTemplateMatchesRemoteHashPin,
	normalizeTemplateSnapshotForWrite,
	resolveTemplateLiveVersion,
	selectTemplateRollbackTarget,
	TemplateRegistryDriftError,
	type TemplateRegistryVersion,
} from "../src/template-registry";

function storedVersion(
	versionId: string,
	second: number,
	hash: string,
): TemplateRegistryVersion {
	return {
		versionId,
		capturedAt: `2026-01-01T00:00:0${second}.000Z`,
		hash,
		snapshot: {
			id: 7,
			name: "Registry",
			type: "campaign",
			subject: "Subject",
			body: hash,
		},
	};
}

// Capture order v1..v4; v3 recorded v1's content again.
const history = [
	storedVersion("v1", 1, "hash-a"),
	storedVersion("v2", 2, "hash-b"),
	storedVersion("v3", 3, "hash-a"),
	storedVersion("v4", 4, "hash-c"),
];

function templateRecord(activeVersionId: string | undefined) {
	return { templateId: 7, activeVersionId, versions: history };
}

describe("resolveTemplateLiveVersion", () => {
	test("prefers the active version when it holds the live content", () => {
		expect(
			resolveTemplateLiveVersion(templateRecord("v1"), "hash-a"),
		).toMatchObject({ status: "active", version: { versionId: "v1" } });
		expect(
			resolveTemplateLiveVersion(templateRecord("v3"), "hash-a"),
		).toMatchObject({ status: "active", version: { versionId: "v3" } });
	});

	test("falls back to the latest capture when the active version is stale", () => {
		expect(
			resolveTemplateLiveVersion(templateRecord("v2"), "hash-c"),
		).toMatchObject({ status: "latest", version: { versionId: "v4" } });
		expect(
			resolveTemplateLiveVersion(
				{ activeVersionId: "v2", versions: [...history].reverse() },
				"hash-c",
			),
		).toMatchObject({ status: "latest", version: { versionId: "v4" } });
	});

	test("uses the persisted observation pointer instead of an older history tail", () => {
		expect(
			resolveTemplateLiveVersion(
				{ ...templateRecord("v2"), latestObservedVersionId: "v3" },
				"hash-a",
			),
		).toMatchObject({ status: "latest", version: { versionId: "v3" } });
		expect(
			resolveTemplateLiveVersion(
				{ ...templateRecord("v1"), latestObservedVersionId: "v1" },
				"hash-c",
			),
		).toEqual({ status: "drifted", matchingVersionIds: ["v4"] });
	});

	test("reports drift instead of placing content only older versions hold", () => {
		expect(resolveTemplateLiveVersion(templateRecord("v4"), "hash-a")).toEqual(
			{ status: "drifted", matchingVersionIds: ["v1", "v3"] },
		);
		expect(resolveTemplateLiveVersion(templateRecord("v4"), "hash-z")).toEqual(
			{ status: "drifted", matchingVersionIds: [] },
		);
	});
});

describe("normalizeTemplateSnapshotForWrite", () => {
	const campaign = {
		id: 7,
		name: "Newsletter",
		type: "campaign",
		subject: "",
		body: "<p>body</p>",
	};

	test("stores a non-transactional template's name as its subject", () => {
		expect(normalizeTemplateSnapshotForWrite(campaign)).toEqual({
			...campaign,
			subject: "Newsletter",
		});
		const visual = {
			...campaign,
			type: "campaign_visual",
			subject: "Custom",
			bodySource: '{"blocks":[]}',
		};
		expect(normalizeTemplateSnapshotForWrite(visual)).toEqual({
			...visual,
			subject: "Newsletter",
		});
	});

	test("keeps transactional and already-normalized snapshots as they are", () => {
		const transactional = {
			...campaign,
			type: "tx",
			subject: "Your receipt",
		};
		expect(normalizeTemplateSnapshotForWrite(transactional)).toBe(transactional);
		const normalized = { ...campaign, subject: "Newsletter" };
		expect(normalizeTemplateSnapshotForWrite(normalized)).toBe(normalized);
	});
});

// The history-hash pin matching Listmonk's subject rewrite needs real
// content hashes, so persistence.test.ts covers it end to end.
describe("liveTemplateMatchesRemoteHashPin", () => {
	test("matches the exact live hash a sync reported", () => {
		expect(
			liveTemplateMatchesRemoteHashPin(templateRecord("v4"), "hash-z", "hash-z"),
		).toBe(true);
		expect(liveTemplateMatchesRemoteHashPin(undefined, "hash-z", "hash-z")).toBe(
			true,
		);
	});

	test("conflicts when the pinned version does not hold the live content", () => {
		// hash-a is a stored version's hash, but the live content changed.
		expect(
			liveTemplateMatchesRemoteHashPin(templateRecord("v4"), "hash-z", "hash-a"),
		).toBe(false);
		// A pin naming no stored version cannot match other live content.
		expect(
			liveTemplateMatchesRemoteHashPin(templateRecord("v4"), "hash-a", "hash-y"),
		).toBe(false);
		// Without a registry record, only the exact live hash matches.
		expect(liveTemplateMatchesRemoteHashPin(undefined, "hash-z", "hash-a")).toBe(
			false,
		);
	});
});

describe("selectTemplateRollbackTarget", () => {
	test("targets the version captured immediately before the live one", () => {
		expect(
			selectTemplateRollbackTarget(templateRecord("v4"), "hash-c").versionId,
		).toBe("v3");
		// A stale active version does not shift the target.
		expect(
			selectTemplateRollbackTarget(templateRecord("v2"), "hash-c").versionId,
		).toBe("v3");
		expect(
			selectTemplateRollbackTarget(templateRecord("v3"), "hash-a").versionId,
		).toBe("v2");
		expect(() =>
			selectTemplateRollbackTarget(templateRecord("v1"), "hash-a"),
		).toThrow("Template 7 has no previous version to roll back to");
	});

	test("prefers the version that was active before the live capture", () => {
		const linkedHistory = history.map((version) =>
			version.versionId === "v4"
				? { ...version, previousVersionId: "v1" }
				: version,
		);

		expect(
			selectTemplateRollbackTarget(
				{ templateId: 7, activeVersionId: "v4", versions: linkedHistory },
				"hash-c",
			).versionId,
		).toBe("v1");
	});

	test("fails closed on drift unless a target is pinned", () => {
		let driftError: unknown;
		try {
			selectTemplateRollbackTarget(templateRecord("v4"), "hash-a");
		} catch (error) {
			driftError = error;
		}
		expect(driftError).toBeInstanceOf(TemplateRegistryDriftError);
		expect(driftError).toMatchObject({
			templateId: 7,
			liveHash: "hash-a",
			activeVersionId: "v4",
			matchingVersionIds: ["v1", "v3"],
		});
		expect((driftError as Error).message).toContain("Run registry-sync");
		expect((driftError as Error).message).toContain("pin to_version_id");

		// An explicit pin stays relative to the active version.
		expect(
			selectTemplateRollbackTarget(templateRecord("v4"), "hash-z", "v3")
				.versionId,
		).toBe("v3");
		expect(() =>
			selectTemplateRollbackTarget(templateRecord("v4"), "hash-z", "v2"),
		).toThrow("Rollback target v2 is no longer the previous version of template 7");
	});

	test("tells a missing base version from a missing predecessor", () => {
		// A drift pin bases the rollback on the stored active version.
		expect(() =>
			selectTemplateRollbackTarget(templateRecord("gone"), "hash-z", "v4"),
		).toThrow(
			"Template 7 base version gone for the rollback is not in its registry history",
		);
		expect(() =>
			selectTemplateRollbackTarget(templateRecord(undefined), "hash-z", "v4"),
		).toThrow(
			"Template 7 base version (none) for the rollback is not in its registry history",
		);
	});

	test("conflicts a pinned target that is not the live version's predecessor", () => {
		expect(
			selectTemplateRollbackTarget(templateRecord("v4"), "hash-c", "v3")
				.versionId,
		).toBe("v3");
		expect(() =>
			selectTemplateRollbackTarget(templateRecord("v4"), "hash-c", "v2"),
		).toThrow("Rollback target v2 is no longer the previous version of template 7");
	});
});
