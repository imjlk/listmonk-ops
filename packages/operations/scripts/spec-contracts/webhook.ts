import type { tags } from "typia";
import type {
	ResourceId,
	NonNegativeInteger,
	PositiveInteger,
	NonEmptyString,
	IsoDateTime,
	Uuid,
	InboundDeliveryEventKind,
} from "./primitives";
import type { SubscriberUuid } from "./subscriber";

export type WebhookSecretRef = string &
	tags.Pattern<"^LISTMONK_OPS_WEBHOOK_SECRET(?:_[A-Z0-9]+)*$">;

export type WebhookId = Uuid;

export type WebhookUrl = NonEmptyString & tags.Pattern<"^https://\\S+$">;

export type WebhookUrlOrigin = NonEmptyString &
	tags.Pattern<"^https://[^/?#]+$">;

export type WebhookUrlFingerprint = string &
	tags.Pattern<"^sha256:[a-f0-9]{64}$">;

export type WebhookName = NonEmptyString & tags.MaxLength<120>;

export type WebhookCorrelationId = NonEmptyString & tags.MaxLength<200>;

export type WebhookTimeoutMs = number &
	tags.Type<"int32"> &
	tags.Minimum<100> &
	tags.Maximum<30_000>;

export type WebhookMaxAttempts = number &
	tags.Type<"int32"> &
	tags.Minimum<1> &
	tags.Maximum<12>;

export type WebhookCircuitFailureThreshold = number &
	tags.Type<"int32"> &
	tags.Minimum<1> &
	tags.Maximum<100>;

export type WebhookCircuitCooldownMs = number &
	tags.Type<"int32"> &
	tags.Minimum<1000> &
	tags.Maximum<86_400_000>;

export type WebhookDispatchLimit = number &
	tags.Type<"int32"> &
	tags.Minimum<1> &
	tags.Maximum<100>;

export type WebhookDeliveryListLimit = number &
	tags.Type<"int32"> &
	tags.Minimum<1> &
	tags.Maximum<1000>;

export type WebhookEventType =
	| "operation.started"
	| "operation.blocked"
	| "operation.succeeded"
	| "operation.failed"
	| "campaign.scheduled"
	| "campaign.started"
	| "campaign.paused"
	| "campaign.cancelled"
	| "campaign.finished"
	| "subscriber.created"
	| "subscriber.updated"
	| "subscriber.blocklisted"
	| "subscriber.unsubscribed"
	| "delivery.delivered"
	| "delivery.bounced"
	| "delivery.complained"
	| "delivery.delayed"
	| "delivery.rejected"
	| "abtest.started"
	| "abtest.ready-for-analysis"
	| "abtest.winner-selected"
	| "abtest.inconclusive"
	| "abtest.failed"
	| "sequence.created"
	| "sequence.revised"
	| "sequence.enrolled"
	| "sequence.paused"
	| "sequence.resumed"
	| "sequence.reconciled"
	| "sequence.deleted"
	| "webhook.test";

export type WebhookEventFamily =
	| "operation"
	| "campaign"
	| "subscriber"
	| "delivery"
	| "abtest"
	| "sequence"
	| "webhook";

export type WebhookEventFilter =
	| WebhookEventType
	| `${WebhookEventFamily}.*`
	| "*";

export type WebhookDeliveryStatus =
	| "pending"
	| "delivering"
	| "retry"
	| "succeeded"
	| "exhausted";

export interface WebhookEndpoint {
	id: WebhookId;
	name: WebhookName;
	url_origin: WebhookUrlOrigin;
	url_fingerprint: WebhookUrlFingerprint;
	secret_reference_configured: boolean;
	event_filters: WebhookEventFilter[] & tags.MinItems<1>;
	enabled: boolean;
	timeout_ms: WebhookTimeoutMs;
	max_attempts: WebhookMaxAttempts;
	circuit_failure_threshold: WebhookCircuitFailureThreshold;
	circuit_cooldown_ms: WebhookCircuitCooldownMs;
	created_at: IsoDateTime;
	updated_at: IsoDateTime;
}

export interface WebhookListInput {
	enabled?: boolean | undefined;
}

export interface WebhookListOutput {
	endpoints: WebhookEndpoint[];
}

export interface WebhookCreateInput {
	name: WebhookName;
	url: WebhookUrl;
	/** Environment variable name; the signing secret value is never persisted. */
	secret_ref: WebhookSecretRef;
	event_filters: WebhookEventFilter[] & tags.MinItems<1>;
	enabled?: boolean | undefined;
	timeout_ms?: WebhookTimeoutMs | undefined;
	max_attempts?: WebhookMaxAttempts | undefined;
	circuit_failure_threshold?: WebhookCircuitFailureThreshold | undefined;
	circuit_cooldown_ms?: WebhookCircuitCooldownMs | undefined;
}

export interface WebhookCreateOutput {
	endpoint: WebhookEndpoint;
	created: boolean;
}

export interface WebhookUpdateInput {
	id: WebhookId;
	name?: WebhookName | undefined;
	url?: WebhookUrl | undefined;
	secret_ref?: WebhookSecretRef | undefined;
	event_filters?: (WebhookEventFilter[] & tags.MinItems<1>) | undefined;
	enabled?: boolean | undefined;
	timeout_ms?: WebhookTimeoutMs | undefined;
	max_attempts?: WebhookMaxAttempts | undefined;
	circuit_failure_threshold?: WebhookCircuitFailureThreshold | undefined;
	circuit_cooldown_ms?: WebhookCircuitCooldownMs | undefined;
}

export interface WebhookUpdateOutput {
	endpoint: WebhookEndpoint;
}

export interface WebhookDeleteInput {
	id: WebhookId;
}

// endpoint is present exactly when deleted is true; the flat optional shape
// keeps the object root the operation schema projection requires.
export interface WebhookDeleteOutput {
	deleted: boolean;
	endpoint?: WebhookEndpoint | undefined;
}

export interface WebhookTestInput {
	id: WebhookId;
	correlation_id?: WebhookCorrelationId | undefined;
}

export interface WebhookDispatchInput {
	limit?: WebhookDispatchLimit | undefined;
	/**
	 * Echoed claim set from a prior dispatch's claim_steps output: claim
	 * exactly these deliveries at their originally claimed attempt counts.
	 * Delivery ids must be unique.
	 */
	recovery_set?: readonly WebhookDispatchRecoveryClaim[] &
		tags.MinItems<1>;
}

/** One echoed dispatch claim position: the delivery plus its attempt count at claim. */
export interface WebhookDispatchRecoveryClaim {
	delivery_id: string & tags.Format<"uuid">;
	attempt_count: NonNegativeInteger;
}

export type WebhookDispatchErrorCode =
	| "endpoint_unavailable"
	| "delivery_unavailable"
	| "signing_secret_unavailable"
	| "url_policy_blocked"
	| "http_rejected"
	| "lease_conflict"
	| "delivery_state_conflict"
	| "delivery_failed";

export type WebhookDispatchResult =
	| {
			delivery_id: WebhookId;
			endpoint_id: WebhookId;
			status: "succeeded" | "retry" | "exhausted";
			status_code?: PositiveInteger | undefined;
			error_code?: WebhookDispatchErrorCode | undefined;
	  }
	| {
			delivery_id: WebhookId;
			endpoint_id: WebhookId;
			status: "skipped";
			error_code: WebhookDispatchErrorCode;
	  };

/** One echoed webhook claim position: the delivery plus its attempt count at claim. */
export interface WebhookRecoveryClaim {
	delivery_id: string & tags.Format<"uuid">;
	attempt_count: NonNegativeInteger;
}

export interface WebhookDispatchOutput {
	claimed: NonNegativeInteger;
	succeeded: NonNegativeInteger;
	retried: NonNegativeInteger;
	exhausted: NonNegativeInteger;
	skipped: NonNegativeInteger;
	claimed_ids: (string & tags.Format<"uuid">)[];
	claim_steps: WebhookRecoveryClaim[];
	requested?: NonNegativeInteger;
	pending_ids?: (string & tags.Format<"uuid">)[];
	already_done?: NonNegativeInteger;
	results: WebhookDispatchResult[];
}

export interface WebhookTestOutput {
	event_id: WebhookId;
	delivery_id?: WebhookId | undefined;
	/** True when the call reused an already-queued delivery instead of enqueuing a new one (a resumed delivery still pings). */
	replayed: boolean;
	/** The endpoint configuration revision the probe identity was bound to; a later dispatch may still resolve a newer revision. */
	bound_revision: string;
	dispatch: WebhookDispatchOutput;
}

export type WebhookEventSource =
	| "listmonk"
	| "provider"
	| "operation"
	| "abtest"
	| "sequence"
	| "webhook";

export type WebhookSubjectKind =
	| "operation"
	| "campaign"
	| "subscriber"
	| "message"
	| "experiment"
	| "sequence"
	| "webhook";

export interface WebhookDeliveryEventSummary {
	id: WebhookId;
	type: WebhookEventType;
	schema_version: PositiveInteger;
	occurred_at: IsoDateTime;
	source: WebhookEventSource;
	correlation_id_present: boolean;
	subject?: {
		kind: WebhookSubjectKind;
		key_redacted: true;
	} | undefined;
}

export interface WebhookDelivery {
	id: WebhookId;
	event_id: WebhookId;
	endpoint_id: WebhookId;
	event: WebhookDeliveryEventSummary;
	status: WebhookDeliveryStatus;
	attempt_count: NonNegativeInteger;
	manual_retry_count: NonNegativeInteger;
	next_attempt_at: IsoDateTime;
	last_attempt_at?: IsoDateTime | undefined;
	completed_at?: IsoDateTime | undefined;
	status_code?: PositiveInteger | undefined;
	last_error_present: boolean;
}

export interface WebhookDeliveryListInput {
	endpoint_id?: WebhookId | undefined;
	status?: WebhookDeliveryStatus | undefined;
	event_type?: WebhookEventType | undefined;
	limit?: WebhookDeliveryListLimit | undefined;
}

export interface WebhookDeliveryListOutput {
	deliveries: WebhookDelivery[];
}

export interface WebhookDeliveryRetryInput {
	id: WebhookId;
	/**
	 * Echoed pre-request generation (the prior retry's retry_generation
	 * output): only retry while the delivery still sits at that manual
	 * retry count.
	 */
	expected_manual_retry_count?: NonNegativeInteger;
}

export interface WebhookDeliveryRetryOutput {
	delivery: WebhookDelivery;
	retried: boolean;
	/** The manual retry count observed before this request moved it — echo it back as expected_manual_retry_count on a retry. */
	retry_generation: NonNegativeInteger;
}

export interface WebhookReconcileInput {
	limit?: WebhookDeliveryListLimit | undefined;
	dry_run?: boolean | undefined;

	/**
	 * Echoed scanned set from a prior reconcile's scanned_ids output:
	 * re-examine exactly that batch. Delivery ids must be unique.
	 */
	recovery_set?: (string & tags.Format<"uuid">)[] & tags.MinItems<1>;
}

export interface WebhookReconcileOutput {
	/** Echoed ids of the deliveries the scan considered. */
	scanned_ids: (string & tags.Format<"uuid">)[];
	scanned: NonNegativeInteger;
	recovered: NonNegativeInteger;
	exhausted: NonNegativeInteger;
	unchanged: NonNegativeInteger;
	dry_run: boolean;
}

export type WebhookRetentionDays = number &
	tags.Type<"int32"> &
	tags.Minimum<1> &
	tags.Maximum<3650>;

export interface WebhookPruneInput {
	older_than_days?: WebhookRetentionDays | undefined;
	before?: IsoDateTime | undefined;
	ids?: (readonly WebhookId[] & tags.MaxItems<1_000>) | undefined;
	limit?: WebhookDeliveryListLimit | undefined;
	dry_run?: boolean | undefined;
}

export interface WebhookPruneOutput {
	eligible: NonNegativeInteger;
	deleted: NonNegativeInteger;
	dry_run: boolean;
	before: IsoDateTime;
	ids: readonly WebhookId[];
}

export interface WebhookTickInput {
	dispatch_limit?: WebhookDispatchLimit | undefined;
	reconcile_limit?: WebhookDeliveryListLimit | undefined;

	/** Echoed claim set from a prior tick's dispatch.claim_steps output: recover exactly these deliveries at their originally claimed attempt counts. */
	recovery_set?: WebhookRecoveryClaim[] & tags.MinItems<1> & tags.MaxItems<100>;
}

export interface WebhookTickOutput {
	reconcile: WebhookReconcileOutput;
	dispatch: WebhookDispatchOutput;
}

export interface WebhookRuntimeStatusInput {
	worker_stale_ms?:
		| (number &
				tags.Type<"int64"> &
				tags.Minimum<1_000> &
				tags.Maximum<86_400_000>)
		| undefined;
}

export interface WebhookRuntimeStatusOutput {
	store: "file" | "postgres";
	schema_version: PositiveInteger;
	healthy: boolean;
	checked_at: IsoDateTime;
	endpoints: {
		total: NonNegativeInteger;
		enabled: NonNegativeInteger;
		circuit_open: NonNegativeInteger;
	};
	deliveries: {
		pending: NonNegativeInteger;
		delivering: NonNegativeInteger;
		retry: NonNegativeInteger;
		succeeded: NonNegativeInteger;
		exhausted: NonNegativeInteger;
		due: NonNegativeInteger;
		dead_letter: NonNegativeInteger;
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

export interface WebhookInboundIngestBaseInput {
	provider: NonEmptyString & tags.MaxLength<100>;
	provider_event_id: NonEmptyString & tags.MaxLength<200>;
	occurred_at?: IsoDateTime | undefined;
	message_id?: (NonEmptyString & tags.MaxLength<300>) | undefined;
	campaign_id?: ResourceId | undefined;
	metadata?: Record<string, unknown> | undefined;
}

export type WebhookInboundIngestInput =
	| (WebhookInboundIngestBaseInput & {
			kind: "unsubscribed";
			subscriber_uuid: SubscriberUuid;
	  })
	| (WebhookInboundIngestBaseInput & {
			kind: Exclude<InboundDeliveryEventKind, "unsubscribed">;
			subscriber_uuid?: SubscriberUuid | undefined;
	  });

export interface WebhookInboundIngestOutput {
	event_id: WebhookId;
	event_type: WebhookEventType;
	matched_endpoints: NonNegativeInteger;
	queued_deliveries: NonNegativeInteger;
	duplicate_deliveries: NonNegativeInteger;
	delivery_ids: WebhookId[];
}

export interface WebhookDlqListInput {
	endpoint_id?: WebhookId | undefined;
	limit?: WebhookDeliveryListLimit | undefined;
}

export type WebhookDlqListOutput = WebhookDeliveryListOutput;

export type WebhookDlqReplayInput =
	| {
			endpoint_id?: WebhookId | undefined;
			limit?: WebhookDeliveryListLimit | undefined;
			/** Dry runs preview the bounded newest batch and report the eligible ids. Defaults to true. */
			dry_run?: true | undefined;
	  }
	| {
			endpoint_id?: WebhookId | undefined;
			/** Exact dead-letter set reported by a dry run; a retry replays nothing new. */
			delivery_ids: readonly WebhookId[] & tags.MinItems<1> & tags.MaxItems<1_000>;
			/** Echoed dead-letter generations: replay a delivery only while it is still exhausted at that manual retry count. */
			recovery_generations?: readonly WebhookDlqRecoveryGeneration[] &
			tags.MinItems<1> &
			tags.MaxItems<1_000>;
			limit?: WebhookDeliveryListLimit | undefined;
			dry_run: false;
	  };

/** One echoed dead-letter generation position. */
export interface WebhookDlqRecoveryGeneration {
	delivery_id: WebhookId;
	manual_retry_count: NonNegativeInteger;
}

export interface WebhookDlqReplayOutput {
	eligible: NonNegativeInteger;
	replayed: NonNegativeInteger;
	failed: NonNegativeInteger;
	dry_run: boolean;
	delivery_ids: WebhookId[];
	/** Echoed dead-letter generations observed before any replay moved them. */
	replayed_generations: WebhookDlqRecoveryGeneration[];
	errors: {
		delivery_id: WebhookId;
		error_code: WebhookDispatchErrorCode;
	}[];
}

export interface WebhookCircuitResetInput {
	id: WebhookId;
}

export interface WebhookCircuitResetOutput {
	endpoint_id: WebhookId;
	circuit_state: "closed";
	consecutive_failures: 0;
}
