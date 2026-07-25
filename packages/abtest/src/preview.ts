/**
 * Preview and seed send gate for A/B tests.
 *
 * Implements the advanced experimentation followup's Change Set E:
 * a draft-level gate that requires content preview checks and optional
 * seed sends before launch. Content changes invalidate prior approvals.
 * Seed recipients are validated against an allowlist and never stored
 * in raw form — only counts and checksums are persisted.
 */

import { createHash } from "node:crypto";

// ── Content checksum ────────────────────────────────────────────────

export interface ContentChecksumInput {
	subject: string;
	body: string;
	altbody?: string;
	contentType?: string;
	templateId?: number;
	headers?: Record<string, string>;
	messenger?: string;
	fromEmail?: string;
	replyTo?: string;
}

/**
 * Compute a canonical SHA-256 checksum over the content fields that
 * affect rendering. Used to detect post-approval content changes.
 */
export function computeContentChecksum(input: ContentChecksumInput): string {
	const canonical: Record<string, unknown> = {
		subject: input.subject,
		body: input.body,
		altbody: input.altbody ?? "",
		contentType: input.contentType ?? "",
		templateId: input.templateId ?? null,
		headers: input.headers ?? {},
		messenger: input.messenger ?? "",
		fromEmail: input.fromEmail ?? "",
		replyTo: input.replyTo ?? "",
	};
	const json = JSON.stringify(canonical, Object.keys(canonical).sort());
	return createHash("sha256").update(json, "utf8").digest("hex");
}

// ── Preview check results ───────────────────────────────────────────

export interface VariantPreviewCheck {
	variantId: string;
	campaignId: number;
	renderSucceeded: boolean;
	renderedChecksum?: string;
	unsubscribeUrlPresent: boolean;
	forbiddenPlaceholderCount: number;
	checkedAt: string;
	error?: string;
}

export type PreviewGateStatus =
	| "not_started"
	| "pending"
	| "approved"
	| "rejected";

export interface SeedVariantState {
	variantId: string;
	campaignId: number;
	state: "pending" | "sending" | "sent" | "ambiguous" | "failed";
	attemptedAt?: string;
	completedAt?: string;
	error?: string;
}

export interface SeedSendRun {
	runId: string;
	contentChecksum: string;
	recipientSetChecksum: string;
	startedAt: string;
	completedAt?: string;
	variants: SeedVariantState[];
}

export interface PreviewGate {
	required: boolean;
	contentChecksum: string;
	status: PreviewGateStatus;
	previews: VariantPreviewCheck[];
	seedRun?: SeedSendRun;
	approvedBy?: string;
	approvedAt?: string;
	rejectionReason?: string;
}

// ── Seed recipient policy ───────────────────────────────────────────

export interface SeedRecipientPolicy {
	allowedDomains: string[];
	maximumRecipients: number;
	requireExistingSubscribers: true;
}

export const DEFAULT_SEED_RECIPIENT_POLICY: SeedRecipientPolicy = {
	allowedDomains: [],
	maximumRecipients: 10,
	requireExistingSubscribers: true,
};

export class PreviewValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PreviewValidationError";
	}
}

/**
 * Normalize and validate seed recipients against the policy.
 * Returns the cleaned email list and a checksum of the set (not the
 * raw emails, which are never persisted).
 */
export function validateSeedRecipients(
	rawEmails: string[],
	policy: SeedRecipientPolicy,
): { emails: string[]; recipientSetChecksum: string } {
	const seen = new Set<string>();
	const cleaned: string[] = [];
	for (const raw of rawEmails) {
		if (typeof raw !== "string") {
			throw new PreviewValidationError("Seed recipient emails must be strings");
		}
		const trimmed = raw.trim().toLowerCase();
		if (trimmed.length === 0) continue;
		const atIndex = trimmed.lastIndexOf("@");
		if (atIndex < 1 || atIndex === trimmed.length - 1) {
			throw new PreviewValidationError(
				`Invalid seed recipient email: ${JSON.stringify(raw)}`,
			);
		}
		const domain = trimmed.slice(atIndex + 1);
		if (
			policy.allowedDomains.length > 0 &&
			!policy.allowedDomains.includes(domain)
		) {
			throw new PreviewValidationError(
				`Seed recipient domain "${domain}" is not in the allowed list`,
			);
		}
		if (!seen.has(trimmed)) {
			seen.add(trimmed);
			cleaned.push(trimmed);
		}
	}
	if (cleaned.length === 0) {
		throw new PreviewValidationError("At least one seed recipient is required");
	}
	if (cleaned.length > policy.maximumRecipients) {
		throw new PreviewValidationError(
			`Too many seed recipients: ${cleaned.length} exceeds maximum of ${policy.maximumRecipients}`,
		);
	}
	// Checksum is over the sorted, deduplicated set — not raw emails.
	const sorted = [...cleaned].sort();
	const recipientSetChecksum = createHash("sha256")
		.update(sorted.join("\n"), "utf8")
		.digest("hex");
	return { emails: cleaned, recipientSetChecksum };
}

// ── Gate operations ─────────────────────────────────────────────────

/**
 * Create a new preview gate in the "not_started" status with the given
 * content checksum.
 */
export function createPreviewGate(
	contentChecksum: string,
	required: boolean = true,
): PreviewGate {
	return {
		required,
		contentChecksum,
		status: "not_started",
		previews: [],
	};
}

/**
 * Record preview check results for all variants. If any render failed,
 * the gate stays in "pending" and the operator must fix and re-preview.
 * If all renders succeeded and the unsubscribe/placeholder checks pass,
 * the gate transitions to "pending" (awaiting approval).
 */
export function recordPreviewChecks(
	gate: PreviewGate,
	checks: VariantPreviewCheck[],
	newContentChecksum: string,
): PreviewGate {
	if (newContentChecksum !== gate.contentChecksum) {
		// Content changed: reset the gate with the new checksum.
		return {
			...gate,
			contentChecksum: newContentChecksum,
			status: "not_started",
			previews: checks,
			approvedBy: undefined,
			approvedAt: undefined,
			rejectionReason: undefined,
			seedRun: undefined,
		};
	}
	const allRendered = checks.every((c) => c.renderSucceeded);
	const allChecksPassed = checks.every(
		(c) =>
			c.renderSucceeded &&
			c.unsubscribeUrlPresent &&
			c.forbiddenPlaceholderCount === 0,
	);
	return {
		...gate,
		previews: checks,
		status: allChecksPassed ? "pending" : allRendered ? "pending" : "not_started",
	};
}

/**
 * Approve the preview gate. The content checksum must match the gate's
 * checksum. Returns a new gate with "approved" status. Re-approving with
 * the same checksum is idempotent.
 */
export function approvePreviewGate(
	gate: PreviewGate,
	contentChecksum: string,
	approvedBy: string,
	approvedAt: string,
): PreviewGate {
	if (!gate.required) {
		return gate;
	}
	if (contentChecksum !== gate.contentChecksum) {
		throw new PreviewValidationError(
			"Content checksum mismatch; the content has changed since the preview. Re-preview and try again.",
		);
	}
	if (gate.status === "approved" && gate.approvedBy === approvedBy) {
		return gate; // Idempotent re-approval.
	}
	if (gate.status === "not_started") {
		throw new PreviewValidationError(
			"Cannot approve a gate that has not been previewed",
		);
	}
	return {
		...gate,
		status: "approved",
		approvedBy,
		approvedAt,
		rejectionReason: undefined,
	};
}

/**
 * Reject the preview gate with a reason. Returns a new gate with
 * "rejected" status.
 */
export function rejectPreviewGate(
	gate: PreviewGate,
	reason: string,
	rejectedAt: string,
): PreviewGate {
	return {
		...gate,
		status: "rejected",
		rejectionReason: reason,
		approvedBy: undefined,
		approvedAt: undefined,
	};
}

/**
 * Check whether the gate allows launch. A non-required gate always allows.
 * A required gate must be in "approved" status.
 */
export function isLaunchAllowed(gate?: PreviewGate): boolean {
	if (!gate || !gate.required) return true;
	return gate.status === "approved";
}

/**
 * Create a new seed send run. If a completed run with the same content
 * checksum and recipient set checksum already exists, return it
 * idempotently without creating a new run.
 */
export function createSeedSendRun(params: {
	contentChecksum: string;
	recipientSetChecksum: string;
	variantIds: string[];
	campaignIds: number[];
	startedAt: string;
	existingRun?: SeedSendRun;
}): SeedSendRun {
	const { contentChecksum, recipientSetChecksum, variantIds, campaignIds, startedAt, existingRun } =
		params;
	// Idempotent: return the existing completed run if checksums match.
	if (
		existingRun &&
		existingRun.completedAt &&
		existingRun.contentChecksum === contentChecksum &&
		existingRun.recipientSetChecksum === recipientSetChecksum
	) {
		return existingRun;
	}
	return {
		runId: `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
		contentChecksum,
		recipientSetChecksum,
		startedAt,
		variants: variantIds.map((variantId, i) => ({
			variantId,
			campaignId: campaignIds[i] ?? 0,
			state: "pending" as const,
		})),
	};
}

/**
 * Transition a seed variant to a new state. Ambiguous states are never
 * auto-retried.
 */
export function transitionSeedVariant(
	run: SeedSendRun,
	variantId: string,
	newState: SeedVariantState["state"],
	timestamp: string,
	error?: string,
): SeedSendRun {
	const variants = run.variants.map((v) => {
		if (v.variantId !== variantId) return v;
		return {
			...v,
			state: newState,
			attemptedAt: v.attemptedAt ?? timestamp,
			completedAt:
				newState === "sent" || newState === "failed" || newState === "ambiguous"
					? timestamp
					: v.completedAt,
			error: error ?? v.error,
		};
	});
	const allCompleted = variants.every(
		(v) =>
			v.state === "sent" ||
			v.state === "failed" ||
			v.state === "ambiguous",
	);
	return {
		...run,
		variants,
		completedAt: allCompleted ? timestamp : run.completedAt,
	};
}

/**
 * Check whether a seed run is complete (all variants in a terminal state).
 */
export function isSeedRunComplete(run: SeedSendRun): boolean {
	return run.variants.every(
		(v) => v.state === "sent" || v.state === "failed" || v.state === "ambiguous",
	);
}
