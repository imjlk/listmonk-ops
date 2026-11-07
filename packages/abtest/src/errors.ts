import type { AbTest } from "./types";
import type { TemporaryListOptOutPropagation } from "./unsubscribe-propagation";

export class AbTestNotFoundError extends Error {
	constructor(testId: string) {
		super(`Test with ID ${testId} not found`);
		this.name = "AbTestNotFoundError";
	}
}

export class AbTestConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AbTestConflictError";
	}
}

/**
 * A stop or delete failed after it may have carried opt-outs to the source
 * lists or deleted temporary lists, and it recorded that on the test
 * (`AbTest.optOutSync`) before throwing; nothing else changes before it is
 * thrown. A stored write transaction commits that record and then raises
 * the failure, so a retry, however much later, does not carry those
 * opt-outs again and cannot unsubscribe a person who re-subscribed in
 * between.
 */
export class AbTestOptOutProgressError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "AbTestOptOutProgressError";
	}
}

/**
 * `deleteTestResources` could not remove every resource. Carries the opt-out
 * propagation of every temporary list it checked and the lists it did
 * delete, so the caller can record that progress before failing.
 */
export class AbTestCleanupError extends Error {
	readonly optOutPropagation: readonly TemporaryListOptOutPropagation[];
	readonly deletedListIds: readonly number[];

	constructor(
		message: string,
		progress: {
			optOutPropagation: readonly TemporaryListOptOutPropagation[];
			deletedListIds: readonly number[];
		},
	) {
		super(message);
		this.name = "AbTestCleanupError";
		this.optOutPropagation = [...progress.optOutPropagation];
		this.deletedListIds = [...progress.deletedListIds];
	}
}

/**
 * A lifecycle action was requested for a test whose status does not permit
 * it. The refusal is deterministic — retrying cannot succeed until the
 * status changes — so adapters surface the observed and permitted statuses
 * as structured details rather than a generic execution failure. Throw it
 * only as a precondition, before any remote or local mutation: stored write
 * transactions pass it through without partial-change guidance.
 */
export class AbTestInvalidStatusError extends Error {
	readonly testId: string;
	readonly action: string;
	readonly status: AbTest["status"];
	readonly allowedStatuses: readonly AbTest["status"][];

	constructor(params: {
		testId: string;
		action: string;
		status: AbTest["status"];
		allowedStatuses: readonly AbTest["status"][];
		reason: string;
	}) {
		super(
			`Cannot ${params.action} for A/B test ${params.testId} in status "${params.status}": ${params.reason}`,
		);
		this.name = "AbTestInvalidStatusError";
		this.testId = params.testId;
		this.action = params.action;
		this.status = params.status;
		this.allowedStatuses = [...params.allowedStatuses];
	}

	toStructuredDetails(): Record<string, unknown> {
		return {
			test_id: this.testId,
			status: this.status,
			allowed_statuses: [...this.allowedStatuses],
		};
	}
}
