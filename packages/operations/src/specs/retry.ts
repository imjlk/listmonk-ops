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
	return (
		retry.cases.length > 0 &&
		retry.cases.every(({ semantics }) => semantics.kind === "safe")
	);
}

function normalizedWords(value: string): readonly string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(
			(word) =>
				word.length > 0 && word !== "a" && word !== "an" && word !== "the",
		);
}

function clauseReferencesSafeRetryCase(
	retry: RetrySemantics,
	clause: string,
): boolean {
	if (retry.kind !== "conditional") return false;
	const clauseWords = normalizedWords(clause);
	return retry.cases.some(({ when, semantics }) => {
		if (semantics.kind !== "safe") return false;
		const conditionWords = normalizedWords(when);
		if (conditionWords.length === 0) return false;

		for (
			let start = 1;
			start <= clauseWords.length - conditionWords.length;
			start += 1
		) {
			const marker = clauseWords[start - 1];
			if (marker !== "if" && marker !== "when") continue;
			if (
				!conditionWords.every(
					(word, offset) => clauseWords[start + offset] === word,
				)
			) {
				continue;
			}

			const remainder = clauseWords.slice(start + conditionWords.length);
			if (remainder.length === 0) return true;
			if (
				/^(?:then )?retr(?:y|ies|ying) (?:is|are) safe(?:ly)?$/.test(
					remainder.join(" "),
				)
			) {
				return true;
			}
		}
		return false;
	});
}

function clauseAdvertisesSafeRetry(clause: string): boolean {
	if (
		/\b(?:not|never)(?:\s+[a-z-]+){0,2}\s+safe\b|\bunsafe\b|\b(?:do\s+not|never)\s+(?:automatically\s+)?retr(?:y|ies|ying)\b/i.test(
			clause,
		)
	) {
		return false;
	}
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
