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

const RECONCILIATION_DISQUALIFIERS = new Set([
	"before",
	"no",
	"not",
	"never",
	"omit",
	"omitted",
	"optional",
	"skipped",
	"unless",
	"unneeded",
	"unnecessary",
	"without",
]);

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

function wordsMatchAt(
	words: readonly string[],
	sequence: readonly string[],
	start: number,
): boolean {
	return sequence.every((word, offset) => words[start + offset] === word);
}

function isRetryActionWord(word: string): boolean {
	return /^(?:retr(?:y|ies|ied|ying)|repeat(?:s|ed|ing)?)$/.test(word);
}

function findConditionReference(
	clauseWords: readonly string[],
	when: string,
): { readonly end: number } | undefined {
	const conditionWords = normalizedWords(when);
	if (conditionWords.length === 0) return undefined;

	for (
		let start = 1;
		start <= clauseWords.length - conditionWords.length;
		start += 1
	) {
		const marker = clauseWords[start - 1];
		if (marker !== "if" && marker !== "when") continue;
		if (
			clauseWords
				.slice(0, start - 1)
				.some((word) => word === "if" || word === "when")
		) {
			continue;
		}
		if (wordsMatchAt(clauseWords, conditionWords, start)) {
			return { end: start + conditionWords.length };
		}
	}
	return undefined;
}

function clauseReferencesSafeRetryCase(
	retry: RetrySemantics,
	clause: string,
): boolean {
	if (retry.kind !== "conditional") return false;
	const clauseWords = normalizedWords(clause);
	return retry.cases.some(({ when, semantics }) => {
		if (semantics.kind !== "safe") return false;
		const condition = findConditionReference(clauseWords, when);
		if (!condition) return false;

		const remainder = clauseWords.slice(condition.end);
		if (remainder.length === 0) return true;
		if (
			/^(?:then )?(?:retr(?:y|ies|ied|ying)|repeat(?:s|ed|ing)?) (?:is|are) safe(?:ly)?$/.test(
				remainder.join(" "),
			)
		) {
			return true;
		}
		return false;
	});
}

function clauseReferencesRequiredReconciliation(
	retry: RetrySemantics,
	clause: string,
): boolean {
	const words = normalizedWords(expandNegationContractions(clause));
	const actionIndex = words.findIndex(isRetryActionWord);
	if (actionIndex === -1) return false;
	const reconciliationSemantics: Extract<
		UnconditionalRetrySemantics,
		{ kind: "reconcile" }
	>[] = [];
	if (retry.kind === "reconcile" && retry.idempotent) {
		reconciliationSemantics.push(retry);
	} else if (retry.kind === "conditional") {
		for (const { when, semantics } of retry.cases) {
			if (
				semantics.kind === "reconcile" &&
				semantics.idempotent &&
				findConditionReference(words, when)
			) {
				reconciliationSemantics.push(semantics);
			}
		}
	}

	for (const semantics of reconciliationSemantics) {
		const reconcileWithWords = normalizedWords(semantics.reconcileWith);
		for (let index = 0; index < words.length; index += 1) {
			const isReconciliation = words[index]?.startsWith("reconcil") ?? false;
			const isReconcileOperation = wordsMatchAt(
				words,
				reconcileWithWords,
				index,
			);
			if (!isReconciliation && !isReconcileOperation) continue;

			const precedingWords = words.slice(Math.max(0, index - 4), index);
			const targetLength = isReconcileOperation ? reconcileWithWords.length : 1;
			const followingWords = words.slice(
				index + targetLength,
				index + targetLength + 4,
			);
			if (
				precedingWords.some((word) => RECONCILIATION_DISQUALIFIERS.has(word)) ||
				followingWords.some((word) => RECONCILIATION_DISQUALIFIERS.has(word))
			) {
				continue;
			}
			const hasPositiveSequence = precedingWords.some((word) =>
				["after", "following", "once"].includes(word),
			);
			const hasInspection =
				isReconcileOperation &&
				precedingWords.some(
					(word) =>
						word.startsWith("inspect") ||
						word.startsWith("check") ||
						word.startsWith("read") ||
						word.startsWith("reconcil"),
				);
			if (
				hasPositiveSequence ||
				(hasInspection && index < actionIndex) ||
				(isReconciliation &&
					["reconcile", "reconciled", "reconciling"].includes(
						words[index] ?? "",
					) &&
					index < actionIndex)
			) {
				return true;
			}
		}
	}
	return false;
}

function expandNegationContractions(clause: string): string {
	return clause
		.replace(/\bcannot\b/gi, "can not")
		.replace(
			/\b(is|are|was|were|do|does|did|can|could|should|would|must|has|have|had)n['’]t\b/gi,
			"$1 not",
		)
		.replace(/\bwon['’]t\b/gi, "will not");
}

function clauseAdvertisesSafeRetry(clause: string): boolean {
	const expandedClause = expandNegationContractions(clause);
	if (
		/\b(?:not|never)(?:\s+[a-z-]+){0,2}\s+safe(?:ly)?\b|\bunsafe\b|\b(?:(?:do|can|could|should|would|must|will)\s+not|never)\s+(?:automatically\s+)?(?:retr(?:y|ies|ied|ying)|repeat(?:s|ed|ing)?)\b/i.test(
			expandedClause,
		)
	) {
		return false;
	}
	const mentionsRetry =
		/\b(?:retr(?:y|ies|ied|ying)|repeat(?:s|ed|ing)?)\b/i.test(expandedClause);
	const claimsSafety = /\bsafe(?:ly)?\b/i.test(expandedClause);
	const prescribesBackoff =
		/\b(?:bounded|normal)\s+backoff\b/i.test(expandedClause);
	const grantsPermission =
		/\b(?:can|may|should)\s+(?:safely\s+)?(?:retr(?:y|ies|ied|ying)|repeat(?:s|ed|ing)?)\b/i.test(
			expandedClause,
		) ||
		/\b(?:retr(?:y|ies|ied|ying)|repeat(?:s|ed|ing)?)\s+(?:is|are)\s+(?:allowed|permitted)\b/i.test(
			expandedClause,
		);
	return mentionsRetry && (claimsSafety || prescribesBackoff || grantsPermission);
}

function guidanceAdvertisesUnsupportedSafeRetry(
	retry: RetrySemantics,
	retryGuidance: string,
): boolean {
	return retryGuidance
		.split(
			/\.(?:\s+|$)|[!?;\n]|,?\s+(?:but|however|whereas|yet)(?:,?\s+)/i,
		)
		.some(
		(clause) =>
			clauseAdvertisesSafeRetry(clause) &&
			!clauseReferencesSafeRetryCase(retry, clause) &&
			!clauseReferencesRequiredReconciliation(retry, clause),
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
