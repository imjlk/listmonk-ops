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
