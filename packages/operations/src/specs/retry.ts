export type OperationId = `${string}.${string}`;

export type UnconditionalRetrySemantics =
	| {
			kind: "safe";
			reason: string;
		}
	| {
			kind: "unsafe";
			reason: string;
		}
	| {
			kind: "reconcile";
			reconcileWith: OperationId;
			/**
			 * Whether repeating the same request after reconciliation is a
			 * semantic no-op. Reconciliation alone does not imply either
			 * idempotency or non-idempotency.
			 */
			idempotent: boolean;
			reason: string;
		};

export type RetrySemantics =
	| UnconditionalRetrySemantics
	| {
			kind: "conditional";
			cases: readonly [
				{
					when: string;
					semantics: UnconditionalRetrySemantics;
				},
				...{
					when: string;
					semantics: UnconditionalRetrySemantics;
				}[],
			];
			reason: string;
		};

function retryIsUnconditionallySafe(retry: RetrySemantics): boolean {
	if (retry.kind !== "conditional") {
		return retry.kind === "safe";
	}
	return retry.cases.every(({ semantics }) => semantics.kind === "safe");
}

const RETRY_CONDITION_STOP_WORDS = new Set(["are", "has", "have", "is"]);

function normalizedWords(value: string): readonly string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((word) => word.length > 0);
}

function clauseReferencesSafeRetryCase(
	retry: RetrySemantics,
	clause: string,
): boolean {
	if (retry.kind !== "conditional") return false;
	const clauseWords = new Set(normalizedWords(clause));
	return retry.cases.some(({ when, semantics }) => {
		if (semantics.kind !== "safe") return false;
		const conditionWords = normalizedWords(when).filter(
			(word) => word.length >= 3 && !RETRY_CONDITION_STOP_WORDS.has(word),
		);
		return (
			conditionWords.length > 0 &&
			conditionWords.every((word) => clauseWords.has(word))
		);
	});
}

function clauseAdvertisesSafeRetry(clause: string): boolean {
	if (/\b(?:never|not|unsafe)\b/i.test(clause)) return false;
	const mentionsRetry = /\bretr(?:y|ies|ying)\b/i.test(clause);
	const claimsSafety = /\bsafe(?:ly)?\b/i.test(clause);
	const prescribesBackoff = /\b(?:bounded|normal)\s+backoff\b/i.test(clause);
	return mentionsRetry && (claimsSafety || prescribesBackoff);
}

function guidanceAdvertisesUnsupportedSafeRetry(
	retry: RetrySemantics,
	retryGuidance: string,
): boolean {
	return retryGuidance.split(/[.!?;\n]/).some(
		(clause) =>
			clauseAdvertisesSafeRetry(clause) &&
			!clauseReferencesSafeRetryCase(retry, clause),
	);
}

/** Reject agent guidance that advertises retry safety outside declared safe semantics. */
export function assertRetryGuidanceMatchesSemantics(
	operationId: string,
	retry: RetrySemantics,
	retryGuidance: string,
): void {
	if (
		retryIsUnconditionallySafe(retry) ||
		!guidanceAdvertisesUnsupportedSafeRetry(retry, retryGuidance)
	) {
		return;
	}
	throw new TypeError(
		`Operation spec ${operationId} retry guidance contradicts its declared retry semantics`,
	);
}
