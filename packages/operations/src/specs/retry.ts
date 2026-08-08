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

function unconditionalRetryIsSafe(
	retry: UnconditionalRetrySemantics,
): boolean {
	return (
		retry.kind === "safe" ||
		(retry.kind === "reconcile" && retry.idempotent)
	);
}

function guidanceAdvertisesSafeRetry(retryGuidance: string): boolean {
	return retryGuidance.split(/[.!?;\n]/).some((clause) => {
		if (/\b(?:never|not|unsafe)\b/i.test(clause)) return false;
		const mentionsRetry = /\bretr(?:y|ies|ying)\b/i.test(clause);
		const claimsSafety = /\bsafe(?:ly)?\b/i.test(clause);
		const prescribesBackoff = /\b(?:bounded|normal)\s+backoff\b/i.test(clause);
		return mentionsRetry && (claimsSafety || prescribesBackoff);
	});
}

function retryIsUnconditionallySafe(retry: RetrySemantics): boolean {
	if (retry.kind !== "conditional") {
		return unconditionalRetryIsSafe(retry);
	}
	return retry.cases.every(({ semantics }) =>
		unconditionalRetryIsSafe(semantics),
	);
}

/** Reject agent guidance that advertises unconditional safety for an unsafe retry. */
export function assertRetryGuidanceMatchesSemantics(
	operationId: string,
	retry: RetrySemantics,
	retryGuidance: string,
): void {
	if (
		retryIsUnconditionallySafe(retry) ||
		!guidanceAdvertisesSafeRetry(retryGuidance)
	) {
		return;
	}
	throw new TypeError(
		`Operation spec ${operationId} retry guidance contradicts its declared retry semantics`,
	);
}
