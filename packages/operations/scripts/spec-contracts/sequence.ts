import type { tags } from "typia";
import type {
	ResourceId,
	NonNegativeInteger,
	PositiveInteger,
	NonEmptyString,
	IsoDateTime,
} from "./primitives";
import type {
	TransactionalFromEmail,
	TransactionalMessenger,
	TransactionalSubject,
} from "./transactional";

export type SequenceStepId = NonEmptyString &
	tags.MaxLength<80> &
	tags.Pattern<"^[A-Za-z0-9._:-]+$">;

export type SequenceConditionPath = NonEmptyString &
	tags.MaxLength<200> &
	tags.Pattern<"^[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*$">;

export type SequenceName = NonEmptyString & tags.MaxLength<120>;

export type SequenceDescription = string & tags.MaxLength<500>;

export type SequenceStep =
	| {
			id: SequenceStepId;
			type: "send";
			template_id: ResourceId;
			from_email?: TransactionalFromEmail | undefined;
			data?: Record<string, unknown> | undefined;
			content_type?: "html" | "markdown" | "plain" | undefined;
			messenger?: TransactionalMessenger | undefined;
			subject?: TransactionalSubject | undefined;
			altbody?: NonEmptyString | undefined;
	  }
	| {
			id: SequenceStepId;
			type: "wait";
			duration_seconds: PositiveInteger;
	  }
	| {
			id: SequenceStepId;
			type: "wait_until";
			at: IsoDateTime;
	  }
	| {
			id: SequenceStepId;
			type: "condition";
			path: SequenceConditionPath;
			operator: "equals" | "not_equals" | "exists";
			value?: unknown;
			on_true: SequenceStepId;
			on_false: SequenceStepId;
	  }
	| {
			id: SequenceStepId;
			type: "stop";
	  };

export type SequenceSteps = SequenceStep[] & tags.MinItems<1>;

export interface SequenceRevision {
	revision: PositiveInteger;
	step_count: PositiveInteger;
	step_types: Array<SequenceStep["type"]> & tags.MinItems<1>;
	content_fingerprint: string & tags.Pattern<"^sha256:[a-f0-9]{64}$">;
	created_at: IsoDateTime;
}

export interface SequenceDefinition {
	id: string & tags.Format<"uuid">;
	name: SequenceName;
	description_present: boolean;
	status: "active" | "paused";
	current_revision: PositiveInteger;
	revisions: SequenceRevision[] & tags.MinItems<1>;
	created_at: IsoDateTime;
	updated_at: IsoDateTime;
}

export interface SequenceEnrollment {
	id: string & tags.Format<"uuid">;
	sequence_id: string & tags.Format<"uuid">;
	revision: PositiveInteger;
	subscriber_reference_present: true;
	status:
		| "pending"
		| "running"
		| "waiting"
		| "paused"
		| "completed"
		| "failed"
		| "ambiguous"
		| "cancelled";
	retry_count: NonNegativeInteger;
	current_step_id: SequenceStepId;
	next_run_at: IsoDateTime;
	last_error_present: boolean;
	created_at: IsoDateTime;
	updated_at: IsoDateTime;
}

export interface SequenceValidateInput {
	steps: SequenceSteps;
}

export interface SequenceValidateOutput {
	valid: true;
	step_count: PositiveInteger;
	step_ids: SequenceStepId[];
}

export interface SequenceCreateInput {
	name: SequenceName;
	description?: SequenceDescription | undefined;
	steps: SequenceSteps;
}

export interface SequenceDefinitionOutput {
	sequence: SequenceDefinition;
}

export interface SequenceCreateOutput {
	sequence: SequenceDefinition;
	created: boolean;
}

export interface SequenceUpdateInput {
	id: string & tags.Format<"uuid">;
	name?: SequenceName | undefined;
	description?: SequenceDescription | undefined;
	steps: SequenceSteps;
}

export interface SequenceListInput {
	status?: "active" | "paused" | undefined;
}

export interface SequenceListOutput {
	sequences: SequenceDefinition[];
}

export interface SequenceIdInput {
	id: string & tags.Format<"uuid">;
}

// sequence is present exactly when deleted is true; the flat optional shape
// keeps the object root the operation schema projection requires.
export interface SequenceDeleteOutput {
	deleted: boolean;
	sequence?: SequenceDefinition | undefined;
}

export interface SequenceUpdateOutput {
	sequence: SequenceDefinition;
	updated: boolean;
}

export interface SequenceEnrollInput {
	id: string & tags.Format<"uuid">;
	subscriber_id: ResourceId;
	context?: Record<string, unknown> | undefined;
	start_at?: IsoDateTime | undefined;
	/**
	 * Generation guard: the number of enrollments (any status) that already
	 * existed for this sequence and subscriber, observed via
	 * sequences.enrollments.list. With the guard, an ambiguous retry
	 * converges across the whole lifecycle — it creates only while the
	 * count still matches, replays the landed enrollment (terminal
	 * included) as created: false, and conflicts when more than one landed.
	 */
	expected_prior_enrollments?: (number & tags.Type<"int64"> & tags.Minimum<0> & tags.Maximum<998>) | undefined;
}

export interface SequenceEnrollOutput {
	enrollment: SequenceEnrollment;
	created: boolean;
}

export interface SequenceEnrollmentOutput {
	enrollment: SequenceEnrollment;
}

export interface SequenceEnrollmentListInput {
	sequence_id?: (string & tags.Format<"uuid">) | undefined;
	subscriber_id?: ResourceId | undefined;
	status?: SequenceEnrollment["status"] | undefined;
	limit: PositiveInteger;
}

export interface SequenceEnrollmentListOutput {
	enrollments: SequenceEnrollment[];
}

export interface SequenceEnrollmentGetInput {
	id: string & tags.Format<"uuid">;
}

export interface SequenceTickInput {
	limit: PositiveInteger;
	lease_ms: PositiveInteger;
	/**
	 * Echoed claim set from a prior tick's claimed_steps output: recover
	 * exactly these enrollments at their originally claimed steps instead
	 * of claiming new due work.
	 */
	recovery_set?: SequenceRecoveryClaim[] & tags.MinItems<1> & tags.MaxItems<100>;
}

/** One echoed claim position: the enrollment plus its originally claimed step. */
export interface SequenceRecoveryClaim {
	enrollment_id: string & tags.Format<"uuid">;
	step_id: NonEmptyString;
}

export interface SequenceTickOutput {
	claimed: NonNegativeInteger;
	/** Echoed ids of the exact enrollments this tick claimed. */
	claimed_ids: (string & tags.Format<"uuid">)[];
	/** Echoed claim positions for a convergent recovery retry. */
	claimed_steps: SequenceRecoveryClaim[];
	advanced: NonNegativeInteger;
	waiting: NonNegativeInteger;
	completed: NonNegativeInteger;
	failed: NonNegativeInteger;
	ambiguous: NonNegativeInteger;
	cancelled: NonNegativeInteger;
	completed_at: IsoDateTime;
	/** Recovery passes only: size of the echoed claim set. */
	requested?: NonNegativeInteger;
	/** Recovery passes only: echoed-set members left untouched. */
	already_done?: NonNegativeInteger;
	/** Recovery passes only: skipped members still at their claimed step under a live lease — retry after that lease expires. */
	pending_ids?: (string & tags.Format<"uuid">)[];
}

export interface SequenceReconcileInput {
	enrollment_id?: (string & tags.Format<"uuid">) | undefined;
	/**
	 * Echoed scanned set from a prior reconcile's scanned_ids output:
	 * re-examine exactly that batch. Enrollment ids must be unique.
	 */
	recovery_set?: (string & tags.Format<"uuid">)[] & tags.MinItems<1>;
	resolution?: "sent" | "not_sent" | undefined;
	limit: PositiveInteger;
	dry_run: boolean;
}

export interface SequenceReconcileOutput {
	/** Echoed ids of the enrollments the scan considered. */
	scanned_ids: (string & tags.Format<"uuid">)[];
	scanned: NonNegativeInteger;
	recovered: NonNegativeInteger;
	unchanged: NonNegativeInteger;
	dry_run: boolean;
	enrollment?: SequenceEnrollment | undefined;
}

export interface SequenceStatusInput {
	worker_stale_ms: PositiveInteger;
}

export interface SequenceStatusOutput {
	store: "file" | "postgres";
	schema_version: PositiveInteger;
	healthy: boolean;
	checked_at: IsoDateTime;
	definitions: {
		total: NonNegativeInteger;
		active: NonNegativeInteger;
		paused: NonNegativeInteger;
	};
	enrollments: {
		pending: NonNegativeInteger;
		running: NonNegativeInteger;
		waiting: NonNegativeInteger;
		paused: NonNegativeInteger;
		completed: NonNegativeInteger;
		failed: NonNegativeInteger;
		ambiguous: NonNegativeInteger;
		cancelled: NonNegativeInteger;
		due: NonNegativeInteger;
		leased: NonNegativeInteger;
		oldest_due_at?: IsoDateTime | undefined;
	};
	workers: {
		running: NonNegativeInteger;
		stale: NonNegativeInteger;
		stopped: NonNegativeInteger;
		failed: NonNegativeInteger;
		last_heartbeat_at?: IsoDateTime | undefined;
	};
}
