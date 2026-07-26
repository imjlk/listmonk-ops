import { describe, expect, it } from "bun:test";
import {
	approvePreviewGate,
	computeContentChecksum,
	createPreviewGate,
	createSeedSendRun,
	DEFAULT_SEED_RECIPIENT_POLICY,
	isLaunchAllowed,
	isSeedRunComplete,
	PreviewValidationError,
	recordPreviewChecks,
	rejectPreviewGate,
	transitionSeedVariant,
	validateSeedRecipients,
	type SeedRecipientPolicy,
	type VariantPreviewCheck,
} from "../src/preview";

function makeCheck(
	variantId: string,
	overrides: Partial<VariantPreviewCheck> = {},
): VariantPreviewCheck {
	return {
		variantId,
		campaignId: 1,
		renderSucceeded: true,
		renderedChecksum: "abc123",
		unsubscribeUrlPresent: true,
		forbiddenPlaceholderCount: 0,
		checkedAt: "2026-07-25T10:00:00Z",
		...overrides,
	};
}

describe("computeContentChecksum", () => {
	it("produces a deterministic 64-char hex", () => {
		const cs = computeContentChecksum({
			subject: "Test",
			body: "<p>Body</p>",
		});
		expect(cs).toMatch(/^[0-9a-f]{64}$/);
		expect(
			computeContentChecksum({ subject: "Test", body: "<p>Body</p>" }),
		).toBe(cs);
	});

	it("changes when content changes", () => {
		const a = computeContentChecksum({ subject: "A", body: "B" });
		const b = computeContentChecksum({ subject: "A2", body: "B" });
		expect(a).not.toBe(b);
	});
});

describe("validateSeedRecipients", () => {
	const policy: SeedRecipientPolicy = {
		allowedDomains: ["example.com", "test.org"],
		maximumRecipients: 5,
		requireExistingSubscribers: true,
	};

	it("trims, lowercases, and deduplicates", () => {
		const { emails } = validateSeedRecipients(
			["  Alice@Example.COM  ", "bob@example.com", "alice@example.com"],
			policy,
		);
		expect(emails).toEqual(["alice@example.com", "bob@example.com"]);
	});

	it("produces a stable checksum over the sorted set", () => {
		const { recipientSetChecksum: cs1 } = validateSeedRecipients(
			["a@example.com", "b@example.com"],
			policy,
		);
		const { recipientSetChecksum: cs2 } = validateSeedRecipients(
			["b@example.com", "a@example.com"],
			policy,
		);
		expect(cs1).toBe(cs2);
	});

	it("rejects invalid emails", () => {
		expect(() =>
			validateSeedRecipients(["not-an-email"], policy),
		).toThrow(PreviewValidationError);
	});

	it("rejects disallowed domains", () => {
		expect(() =>
			validateSeedRecipients(["user@evil.com"], policy),
		).toThrow(PreviewValidationError);
	});

	it("rejects exceeding the maximum", () => {
		expect(() =>
			validateSeedRecipients(
				["1@example.com", "2@example.com", "3@example.com", "4@example.com", "5@example.com", "6@example.com"],
				policy,
			),
		).toThrow(PreviewValidationError);
	});

	it("rejects an empty list", () => {
		expect(() => validateSeedRecipients([], policy)).toThrow(
			PreviewValidationError,
		);
	});

	it("accepts any domain when allowedDomains is empty", () => {
		const openPolicy: SeedRecipientPolicy = {
			...DEFAULT_SEED_RECIPIENT_POLICY,
			allowedDomains: [],
		};
		expect(() =>
			validateSeedRecipients(["user@anywhere.net"], openPolicy),
		).not.toThrow();
	});
});

describe("createPreviewGate", () => {
	it("creates a not_started gate", () => {
		const gate = createPreviewGate("checksum-1");
		expect(gate.status).toBe("not_started");
		expect(gate.required).toBe(true);
		expect(gate.previews).toEqual([]);
	});
});

describe("recordPreviewChecks", () => {
	it("transitions to pending when all checks pass", () => {
		const gate = createPreviewGate("cs1");
		const updated = recordPreviewChecks(
			gate,
			[makeCheck("A"), makeCheck("B")],
			"cs1",
			["A", "B"],
		);
		expect(updated.status).toBe("pending");
		expect(updated.previews).toHaveLength(2);
	});

	it("stays not_started when a render fails", () => {
		const gate = createPreviewGate("cs1");
		const updated = recordPreviewChecks(
			gate,
			[makeCheck("A"), makeCheck("B", { renderSucceeded: false })],
			"cs1",
			["A", "B"],
		);
		expect(updated.status).toBe("not_started");
	});

	it("resets the gate when content checksum changes", () => {
		const gate = createPreviewGate("cs1");
		const approved = approvePreviewGate(
			{ ...gate, status: "pending" },
			"cs1",
			"user-1",
			"2026-07-25T10:00:00Z",
		);
		const updated = recordPreviewChecks(
			approved,
			[makeCheck("A")],
			"cs2-different",
			["A"],
		);
		expect(updated.status).toBe("not_started");
		expect(updated.contentChecksum).toBe("cs2-different");
		expect(updated.approvedBy).toBeUndefined();
	});
});

describe("approvePreviewGate", () => {
	it("approves a pending gate", () => {
		const gate = createPreviewGate("cs1");
		const pending = recordPreviewChecks(gate, [makeCheck("A")], "cs1", ["A"]);
		const approved = approvePreviewGate(
			pending,
			"cs1",
			"user-1",
			"2026-07-25T10:00:00Z",
		);
		expect(approved.status).toBe("approved");
		expect(approved.approvedBy).toBe("user-1");
	});

	it("is idempotent for the same approver", () => {
		const gate = createPreviewGate("cs1");
		const pending = recordPreviewChecks(gate, [makeCheck("A")], "cs1", ["A"]);
		const approved = approvePreviewGate(pending, "cs1", "user-1", "2026-07-25T10:00:00Z");
		const reApproved = approvePreviewGate(approved, "cs1", "user-1", "2026-07-25T10:01:00Z");
		expect(reApproved).toBe(approved);
	});

	it("rejects approval on checksum mismatch", () => {
		const gate = createPreviewGate("cs1");
		const pending = recordPreviewChecks(gate, [makeCheck("A")], "cs1", ["A"]);
		expect(() =>
			approvePreviewGate(pending, "cs2-different", "user-1", "2026-07-25T10:00:00Z"),
		).toThrow(PreviewValidationError);
	});

	it("rejects approval when not previewed", () => {
		const gate = createPreviewGate("cs1");
		expect(() =>
			approvePreviewGate(gate, "cs1", "user-1", "2026-07-25T10:00:00Z"),
		).toThrow(PreviewValidationError);
	});
});

describe("rejectPreviewGate", () => {
	it("sets rejected status with reason", () => {
		const gate = createPreviewGate("cs1");
		const rejected = rejectPreviewGate(
			gate,
			"Bad content",
			"2026-07-25T10:00:00Z",
		);
		expect(rejected.status).toBe("rejected");
		expect(rejected.rejectionReason).toBe("Bad content");
	});
});

describe("isLaunchAllowed", () => {
	it("allows when gate is not required", () => {
		expect(isLaunchAllowed({ ...createPreviewGate("cs1"), required: false })).toBe(
			true,
		);
	});

	it("allows when no gate is present", () => {
		expect(isLaunchAllowed(undefined)).toBe(true);
	});

	it("blocks when required and not approved", () => {
		expect(isLaunchAllowed(createPreviewGate("cs1"))).toBe(false);
	});

	it("allows when required and approved", () => {
		const gate = createPreviewGate("cs1");
		const pending = recordPreviewChecks(gate, [makeCheck("A")], "cs1", ["A"]);
		const approved = approvePreviewGate(
			pending,
			"cs1",
			"user-1",
			"2026-07-25T10:00:00Z",
		);
		expect(isLaunchAllowed(approved)).toBe(true);
	});
});

describe("createSeedSendRun", () => {
	it("creates a run with pending variants", () => {
		const run = createSeedSendRun({
			contentChecksum: "cs1",
			recipientSetChecksum: "rcs1",
			variantIds: ["A", "B"],
			campaignIds: [1, 2],
			startedAt: "2026-07-25T10:00:00Z",
		});
		expect(run.variants).toHaveLength(2);
		expect(run.variants[0]?.state).toBe("pending");
		expect(run.completedAt).toBeUndefined();
	});

	it("returns existing completed run idempotently", () => {
		const existing = createSeedSendRun({
			contentChecksum: "cs1",
			recipientSetChecksum: "rcs1",
			variantIds: ["A"],
			campaignIds: [1],
			startedAt: "2026-07-25T10:00:00Z",
		});
		const completed = transitionSeedVariant(
			existing,
			"A",
			"sent",
			"2026-07-25T10:01:00Z",
		);
		const result = createSeedSendRun({
			contentChecksum: "cs1",
			recipientSetChecksum: "rcs1",
			variantIds: ["A"],
			campaignIds: [1],
			startedAt: "2026-07-25T10:02:00Z",
			existingRun: completed,
		});
		expect(result).toBe(completed);
	});
});

describe("transitionSeedVariant", () => {
	it("transitions a variant to sent", () => {
		const run = createSeedSendRun({
			contentChecksum: "cs1",
			recipientSetChecksum: "rcs1",
			variantIds: ["A", "B"],
			campaignIds: [1, 2],
			startedAt: "2026-07-25T10:00:00Z",
		});
		const updated = transitionSeedVariant(
			run,
			"A",
			"sent",
			"2026-07-25T10:01:00Z",
		);
		expect(updated.variants[0]?.state).toBe("sent");
		expect(updated.variants[0]?.completedAt).toBe("2026-07-25T10:01:00Z");
	});

	it("marks run completed when all variants are terminal", () => {
		const run = createSeedSendRun({
			contentChecksum: "cs1",
			recipientSetChecksum: "rcs1",
			variantIds: ["A", "B"],
			campaignIds: [1, 2],
			startedAt: "2026-07-25T10:00:00Z",
		});
		const sent1 = transitionSeedVariant(
			run,
			"A",
			"sent",
			"2026-07-25T10:01:00Z",
		);
		const sent2 = transitionSeedVariant(
			sent1,
			"B",
			"sent",
			"2026-07-25T10:02:00Z",
		);
		expect(sent2.completedAt).toBe("2026-07-25T10:02:00Z");
		expect(isSeedRunComplete(sent2)).toBe(true);
	});

	it("handles ambiguous timeout without auto-retry", () => {
		const run = createSeedSendRun({
			contentChecksum: "cs1",
			recipientSetChecksum: "rcs1",
			variantIds: ["A"],
			campaignIds: [1],
			startedAt: "2026-07-25T10:00:00Z",
		});
		const ambiguous = transitionSeedVariant(
			run,
			"A",
			"ambiguous",
			"2026-07-25T10:01:00Z",
			"Request timeout",
		);
		expect(ambiguous.variants[0]?.state).toBe("ambiguous");
		expect(ambiguous.variants[0]?.error).toBe("Request timeout");
		expect(isSeedRunComplete(ambiguous)).toBe(true);
	});
});
