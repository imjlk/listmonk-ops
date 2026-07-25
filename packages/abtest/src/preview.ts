/**
 * Preview and seed send gate for A/B tests.
 *
 * Implements the advanced experimentation followup's Change Set E:
 * a draft-level gate that requires content preview checks and optional
 * seed sends before launch. Content changes invalidate prior approvals.
 * Seed recipients are validated against an allowlist and never stored
 * in raw form — only counts and checksums are persisted.
 */

import { createHash, randomUUID } from "node:crypto";

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
 * Recursively canonicalize a value: sort object keys, preserve array order,
 * so the checksum is stable regardless of key insertion order.
 */
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(obj).sort()) {
			sorted[key] = canonicalize(obj[key]);
		}
		return sorted;
	}
	return value;
}

/**
 * Compute a canonical SHA-256 checksum over the content fields that
 * affect rendering. Used to detect post-approval content changes.
 * Nested objects (e.g. headers) are recursively canonicalized so any
 * header value change is detected.
 */
export function computeContentChecksum(input: ContentChecksumInput): string {
	const canonical = canonicalize({
		subject: input.subject,
		body: input.body,
		altbody: input.altbody ?? "",
		contentType: input.contentType ?? "",
		templateId: input.templateId ?? null,
		headers: input.headers ?? {},
		messenger: input.messenger ?? "",
		fromEmail: input.fromEmail ?? "",
		replyTo: input.replyTo ?? "",
	}) as Record<string, unknown>;
	const json = JSON.stringify(canonical);
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

/** Terminal seed variant states — no further transitions allowed. */
const TERMINAL_SEED_STATES: ReadonlySet<SeedVariantState["state"]> = new Set([
	"sent",
	"failed",
	"ambiguous",
]);

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
	rejectedAt?: string;
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
	if (
		typeof policy.maximumRecipients !== "number" ||
		!Number.isFinite(policy.maximumRecipients) ||
		policy.maximumRecipients < 1 ||
		!Number.isInteger(policy.maximumRecipients)
	) {
		throw new PreviewValidationError(
			`maximumRecipients must be a finite positive integer, received ${JSON.stringify(policy.maximumRecipients)}`,
		);
	}
	const seen = new Set<string>();
	const cleaned: string[] = [];
	// Normalize the allowed domains once, outside the per-email loop.
	const normalizedAllowed = policy.allowedDomains.map((d) =>
		d.trim().toLowerCase(),
	);
	for (const raw of rawEmails) {
		if (typeof raw !== "string") {
			throw new PreviewValidationError("Seed recipient emails must be strings");
		}
		const trimmed = raw.trim().toLowerCase();
		if (trimmed.length === 0) continue;
		// Reject emails with multiple @ signs, whitespace in local part,
		// or other common malformed patterns.
		const atCount = (trimmed.match(/@/g) ?? []).length;
		if (atCount !== 1) {
			throw new PreviewValidationError(
				`Invalid seed recipient email (expected exactly one @): ${JSON.stringify(raw)}`,
			);
		}
		const [localPart, domain] = trimmed.split("@");
		if (!localPart || localPart.length === 0 || /\s/.test(localPart)) {
			throw new PreviewValidationError(
				`Invalid seed recipient email (malformed local part): ${JSON.stringify(raw)}`,
			);
		}
		if (
			!domain ||
			domain.length === 0 ||
			!domain.includes(".") ||
			/\s/.test(domain) ||
			domain.startsWith(".") ||
			domain.endsWith(".") ||
			domain.includes("..")
		) {
			throw new PreviewValidationError(
				`Invalid seed recipient email (malformed domain): ${JSON.stringify(raw)}`,
			);
		}
		if (
			normalizedAllowed.length > 0 &&
			!normalizedAllowed.includes(domain)
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
 * Record preview check results for all variants. The gate transitions to
 * "pending" (awaiting approval) only when every variant passes all checks
 * (render succeeded, unsubscribe URL present, no forbidden placeholders).
 * Any failure keeps the gate in "not_started" until the operator fixes
 * and re-previews.
 */
export function recordPreviewChecks(
	gate: PreviewGate,
	checks: VariantPreviewCheck[],
	newContentChecksum: string,
	expectedVariantIds: string[],
): PreviewGate {
	if (checks.length === 0) {
		throw new PreviewValidationError(
			"At least one variant preview check is required",
		);
	}
	// Require a check for every expected variant and no extras.
	const checkIds = new Set(checks.map((c) => c.variantId));
	const expectedSet = new Set(expectedVariantIds);
	for (const id of expectedVariantIds) {
		if (!checkIds.has(id)) {
			throw new PreviewValidationError(
				`Missing preview check for variant "${id}"`,
			);
		}
	}
	for (const id of checkIds) {
		if (!expectedSet.has(id)) {
			throw new PreviewValidationError(
				`Unexpected preview check for variant "${id}"`,
			);
		}
	}
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
	const allChecksPassed = checks.every(
		(c) =>
			c.renderSucceeded &&
			c.unsubscribeUrlPresent &&
			c.forbiddenPlaceholderCount === 0,
	);
	return {
		...gate,
		previews: checks,
		// Only transition to pending when ALL checks pass. Render failures
		// or unsubscribe/placeholder issues keep the gate in not_started.
		status: allChecksPassed ? "pending" : "not_started",
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
	if (typeof approvedBy !== "string" || approvedBy.trim().length === 0) {
		throw new PreviewValidationError("approvedBy must be a non-empty string");
	}
	if (typeof approvedAt !== "string" || approvedAt.trim().length === 0) {
		throw new PreviewValidationError("approvedAt must be a non-empty string");
	}
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
	if (gate.status === "rejected") {
		throw new PreviewValidationError(
			"Cannot approve a rejected gate; re-preview first",
		);
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
		rejectedAt: undefined,
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
		rejectedAt,
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
	// Validate inputs before checking for idempotent reuse so invalid
	// params are never silently accepted via a stale completed run.
	if (variantIds.length === 0) {
		throw new PreviewValidationError(
			"At least one variant is required for a seed send run",
		);
	}
	const uniqueVariantIds = new Set(variantIds);
	if (uniqueVariantIds.size !== variantIds.length) {
		throw new PreviewValidationError(
			"Duplicate variant IDs are not allowed in a seed send run",
		);
	}
	if (campaignIds.length !== variantIds.length) {
		throw new PreviewValidationError(
			`campaignIds length (${campaignIds.length}) must equal variantIds length (${variantIds.length})`,
		);
	}
	for (const id of campaignIds) {
		if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
			throw new PreviewValidationError(
				`campaignIds must be positive integers, received ${JSON.stringify(id)}`,
			);
		}
	}
	const uniqueCampaignIds = new Set(campaignIds);
	if (uniqueCampaignIds.size !== campaignIds.length) {
		throw new PreviewValidationError(
			"Duplicate campaign IDs are not allowed in a seed send run",
		);
	}
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
		runId: `seed-${randomUUID()}`,
		contentChecksum,
		recipientSetChecksum,
		startedAt,
		variants: variantIds.map((variantId, i) => ({
			variantId,
			campaignId: campaignIds[i]!,
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
	// Single lookup for existence + current state.
	const current = run.variants.find((v) => v.variantId === variantId);
	if (!current) {
		throw new PreviewValidationError(
			`Variant "${variantId}" not found in seed run ${run.runId}`,
		);
	}
	// Same-state replay is a no-op (idempotent), not an error.
	if (current.state === newState) {
		return run;
	}
	// Reject transitions for variants already in a terminal state.
	if (TERMINAL_SEED_STATES.has(current.state)) {
		throw new PreviewValidationError(
			`Variant "${variantId}" is already in terminal state "${current.state}"; cannot transition to "${newState}"`,
		);
	}
	const variants = run.variants.map((v) => {
		if (v.variantId !== variantId) return v;
		return {
			...v,
			state: newState,
			attemptedAt: v.attemptedAt ?? timestamp,
			completedAt:
				newState === "sent" || newState === "failed" || newState === "ambiguous"
					? timestamp
					: undefined, // Clear when transitioning back to non-terminal.
			// Replace the error if a new one is provided; otherwise keep the
			// existing one so transitions don't silently clear it.
			error: error !== undefined ? error : v.error,
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
		// Clear completedAt when a variant transitions back to a non-terminal
		// state; set it when all variants are terminal.
		completedAt: allCompleted ? timestamp : undefined,
	};
}

/**
 * Check whether a seed run is complete (all variants in a terminal state).
 */
export function isSeedRunComplete(run: SeedSendRun): boolean {
	return run.variants.every((v) => TERMINAL_SEED_STATES.has(v.state));
}
