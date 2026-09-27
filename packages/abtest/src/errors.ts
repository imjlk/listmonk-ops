import type { AbTest } from "./types";

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
