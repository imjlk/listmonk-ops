import type { tags } from "typia";

export type ResourceId = number &
	tags.Type<"int64"> &
	tags.Minimum<1> &
	tags.Maximum<9007199254740991>;

export type NonNegativeInteger = number &
	tags.Type<"int64"> &
	tags.Minimum<0> &
	tags.Maximum<9007199254740991>;

export type PositiveInteger = number &
	tags.Type<"int64"> &
	tags.Minimum<1> &
	tags.Maximum<9007199254740991>;

export type NonEmptyString = string & tags.MinLength<1>;
export type EmailAddress = string & tags.Format<"email">;
export type IsoDateTime = string & tags.Format<"date-time">;
export type IdempotencyKey = string &
	tags.MinLength<1> &
	tags.MaxLength<128> &
	tags.Pattern<"^[A-Za-z0-9._:-]+$">;
export type WebhookSecretRef = string &
	tags.Pattern<"^LISTMONK_OPS_WEBHOOK_SECRET(?:_[A-Z0-9]+)*$">;

export interface CampaignGetInput {
	/** Listmonk campaign ID. */
	id: ResourceId;
	/** Omit the potentially large message body when the server supports it. */
	no_body?: boolean | undefined;
}

export interface CampaignGetOutput {
	id?: ResourceId | undefined;
	created_at?: string | undefined;
	updated_at?: string | undefined;
	uuid?: string | undefined;
	name?: string | undefined;
	subject?: string | undefined;
	from_email?: string | undefined;
	body?: string | undefined;
	body_source?: string | null | undefined;
	altbody?: string | null | undefined;
	send_at?: string | null | undefined;
	status?: string | undefined;
	type?: "regular" | "optin" | undefined;
	content_type?:
		| "richtext"
		| "html"
		| "markdown"
		| "plain"
		| "visual"
		| undefined;
	tags?: string[] | undefined;
	template_id?: ResourceId | null | undefined;
	messenger?: string | undefined;
	lists?: Record<string, unknown>[] | undefined;
	archive?: boolean | undefined;
	media?: Record<string, unknown>[] | undefined;
	views?: number | null | undefined;
	clicks?: number | null | undefined;
	bounces?: number | null | undefined;
	to_send?: number | null | undefined;
	sent?: number | null | undefined;
	started_at?: string | null | undefined;
	/**
	 * Preserve additional fields returned by newer Listmonk releases so this
	 * read contract remains forward-compatible at the handwritten API boundary.
	 */
	[key: string]: unknown;
}

export interface CampaignScheduleInput {
	/** Listmonk campaign ID. */
	id: ResourceId;
	/**
	 * ISO 8601 or Listmonk-compatible `YYYY-MM-DD HH:MM:SS` send timestamp.
	 * Stateful validation remains in the campaign domain executor.
	 */
	send_at: NonEmptyString;
}

export interface CampaignScheduleOutput {
	id: ResourceId;
	status: string;
}

export interface CampaignLifecycleInput {
	/** Listmonk campaign ID. */
	id: ResourceId;
}

export interface CampaignLifecycleOutput {
	id: ResourceId;
	status: string;
}

export interface CampaignPreflightInput {
	/** Listmonk campaign ID. */
	campaign_id: ResourceId;
	/** Warning threshold for the resolved audience size. */
	max_audience: PositiveInteger;
	/** Whether to validate outbound links after SSRF policy checks. */
	check_links: boolean;
	/** Per-link timeout in milliseconds. */
	link_check_timeout_ms: PositiveInteger;
}

export interface CampaignPreflightCheck {
	id: string;
	level: "pass" | "warn" | "fail";
	message: string;
	details?: Record<string, unknown> | undefined;
}

export interface CampaignPreflightOutput {
	campaignId: ResourceId;
	campaignName: string;
	status: string;
	audienceEstimate: NonNegativeInteger;
	checkedAt: IsoDateTime;
	checks: CampaignPreflightCheck[];
	summary: {
		pass: NonNegativeInteger;
		warn: NonNegativeInteger;
		fail: NonNegativeInteger;
	};
}

export interface SubscriberBlocklistInput {
	/** One or more Listmonk subscriber IDs. */
	subscriber_ids: ResourceId[] & tags.MinItems<1>;
	/** Resolve the audience and report work without mutating Listmonk. */
	dry_run: boolean;
	/** Maximum number of subscribers accepted by this invocation. */
	max_items: PositiveInteger;
	/** Continue processing later chunks when an earlier chunk fails. */
	continue_on_error: boolean;
}

export interface SubscriberBulkOutput {
	processed: NonNegativeInteger;
	succeeded: NonNegativeInteger;
	failed: NonNegativeInteger;
	errors: string[];
}

interface TransactionalSendBaseInput {
	template_id: ResourceId;
	/**
	 * RFC 5322 From header value. This may include a display name such as
	 * `Newsletter <news@example.com>`, so it is intentionally not narrowed to
	 * the bare-address-only EmailAddress contract.
	 */
	from_email?: NonEmptyString | undefined;
	data?: Record<string, unknown> | undefined;
	headers?: Record<string, string>[] | undefined;
	content_type?: "html" | "markdown" | "plain" | undefined;
	idempotency_key?: IdempotencyKey | undefined;
}

export type TransactionalSendInput = TransactionalSendBaseInput &
	(
		| {
				subscriber_email: EmailAddress;
				subscriber_id?: never;
		  }
		| {
				subscriber_email?: never;
				subscriber_id: ResourceId;
		  }
	);

export interface TransactionalSendOutput {
	sent: boolean;
	status: "accepted" | "replayed" | "failed";
	duplicate?: boolean | undefined;
	idempotency_key?: IdempotencyKey | undefined;
	expires_at?: IsoDateTime | undefined;
}

export type OperationSpecCoverage = "described" | "migration";

export interface OperationDiscoverySafety {
	read_only: boolean;
	destructive: boolean;
	idempotent: boolean;
	confirmation_required: boolean;
	audit_required: boolean;
	dry_run_supported: boolean;
}

export interface OperationSearchResult {
	family: NonEmptyString;
	id: NonEmptyString;
	mcp_name: NonEmptyString;
	title: NonEmptyString;
	description: NonEmptyString;
	score: NonNegativeInteger;
	coverage: OperationSpecCoverage;
	resource?: NonEmptyString | undefined;
	verb?: NonEmptyString | undefined;
	stability?: "experimental" | "stable" | "deprecated" | undefined;
	safety: OperationDiscoverySafety;
	use_when: string[];
	avoid_when: string[];
}

export interface SpecSearchInput {
	query: NonEmptyString;
	family?: NonEmptyString | undefined;
	resource?: NonEmptyString | undefined;
	verb?: NonEmptyString | undefined;
	limit?: PositiveInteger | undefined;
}

export interface SpecSearchOutput {
	query: NonEmptyString;
	total: NonNegativeInteger;
	results: OperationSearchResult[];
}

export interface SpecDescribeInput {
	/** Shared operation ID or MCP tool name. */
	operation: NonEmptyString;
}

export interface OperationDescription extends Omit<
	OperationSearchResult,
	"score"
> {
	family_title: NonEmptyString;
	input_schema: Record<string, unknown>;
	output_schema: Record<string, unknown>;
	spec?: Record<string, unknown> | undefined;
	migration?: Record<string, unknown> | undefined;
}

export interface SpecDescribeOutput {
	operation: OperationDescription;
}

export interface EmptyInput {}

export interface PlaybookSummary {
	id: NonEmptyString;
	title: NonEmptyString;
	goal: NonEmptyString;
	step_count: PositiveInteger;
	recovery_operation: NonEmptyString;
}

export interface PlaybookListOutput {
	playbooks: PlaybookSummary[];
}

export interface PlaybookGetInput {
	id: NonEmptyString;
}

export interface PlaybookOperationReference {
	step_id: NonEmptyString;
	operation: OperationSearchResult;
	approval: "none" | "human";
}

export type PlaybookPrimitive = string | number | boolean | null;

export interface PlaybookInput {
	name: NonEmptyString;
	type: "string" | "number" | "boolean";
	required: boolean;
	description: NonEmptyString;
}

export type PlaybookValueSource =
	| {
			kind: "playbook-input";
			name: NonEmptyString;
	  }
	| {
			kind: "step-output";
			step_id: NonEmptyString;
			path: NonEmptyString;
	  }
	| {
			kind: "literal";
			value: PlaybookPrimitive;
	  };

export interface PlaybookInputBinding {
	parameter: NonEmptyString;
	source: PlaybookValueSource;
}

export interface PlaybookResultGuard {
	path: NonEmptyString;
	operator: "equals" | "not-equals";
	expected: PlaybookPrimitive;
	on_failure: "stop";
	message: NonEmptyString;
}

export interface PlaybookStep {
	id: NonEmptyString;
	operation: NonEmptyString;
	approval: "none" | "human";
	description: NonEmptyString;
	depends_on: NonEmptyString[];
	input: PlaybookInputBinding[];
	result_guard?: PlaybookResultGuard | undefined;
}

export interface PlaybookDetail {
	id: NonEmptyString;
	title: NonEmptyString;
	goal: NonEmptyString;
	inputs: PlaybookInput[];
	steps: PlaybookStep[] & tags.MinItems<1>;
	recovery_operation: NonEmptyString;
}

export interface PlaybookGetOutput {
	playbook: PlaybookDetail;
	operations: PlaybookOperationReference[];
}

export interface CapabilityFamily {
	id: NonEmptyString;
	title: NonEmptyString;
	operations: PositiveInteger;
	described: NonNegativeInteger;
}

export interface ControlCapabilitiesOutput {
	schema_version: NonEmptyString;
	resources: NonNegativeInteger;
	playbooks: NonNegativeInteger;
	operations: NonNegativeInteger;
	described_operations: NonNegativeInteger;
	migration_operations: NonNegativeInteger;
	spec_coverage_complete: boolean;
	families: CapabilityFamily[];
}

export interface ControlPrimeInput {
	goal?: NonEmptyString | undefined;
	limit?: PositiveInteger | undefined;
}

export interface ControlPrimeOutput {
	goal?: NonEmptyString | undefined;
	capabilities: ControlCapabilitiesOutput;
	recommended_operations: OperationSearchResult[];
	recommended_playbooks: PlaybookSummary[];
	guidance: string[];
}

export interface ControlStatusInput {}

export interface ControlStatusOutput {
	surface: "cli" | "mcp";
	version: NonEmptyString;
	runtime: Record<string, string>;
	target?: {
		url: NonEmptyString;
		auth: "token" | "none";
	} | undefined;
	listmonk: {
		configured: boolean;
		reachable: boolean;
		health_error?: string | undefined;
	};
	specs: {
		schema_version: NonEmptyString;
		operations: NonNegativeInteger;
		described: NonNegativeInteger;
		migrations: NonNegativeInteger;
		complete: boolean;
	};
	readiness: {
		catalog: boolean;
		specs: boolean;
		listmonk: boolean;
	};
}

export type Uuid = string & tags.Format<"uuid">;
export type WebhookId = Uuid;
export type SubscriberUuid = Uuid;
/**
 * Public HTTPS webhook URL. Stateful URL parsing, credential/query rejection,
 * DNS resolution, and private-address checks remain in the domain executor.
 *
 * Typia currently cannot combine its URI format tag with a pattern tag, so the
 * contract encodes the security-relevant HTTPS scheme while runtime validation
 * enforces the complete absolute-URL policy.
 */
export type WebhookUrl = NonEmptyString & tags.Pattern<"^https://\\S+$">;
export type WebhookName = NonEmptyString & tags.MaxLength<120>;
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
	| "webhook.test";
export type WebhookEventFamily =
	| "operation"
	| "campaign"
	| "subscriber"
	| "delivery"
	| "abtest"
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
	url: WebhookUrl;
	secret_ref: WebhookSecretRef;
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

export interface WebhookDeleteOutput {
	deleted: true;
	endpoint: WebhookEndpoint;
}

export interface WebhookTestInput {
	id: WebhookId;
	correlation_id?: NonEmptyString | undefined;
}

export interface WebhookDispatchInput {
	limit?: WebhookDispatchLimit | undefined;
}

export type WebhookDispatchResult =
	| {
			delivery_id: WebhookId;
			endpoint_id: WebhookId;
			status: "succeeded" | "retry" | "exhausted";
			status_code?: PositiveInteger | undefined;
			error?: NonEmptyString | undefined;
	  }
	| {
			delivery_id: WebhookId;
			endpoint_id: WebhookId;
			status: "skipped";
			error: NonEmptyString;
	  };

export interface WebhookDispatchOutput {
	claimed: NonNegativeInteger;
	succeeded: NonNegativeInteger;
	retried: NonNegativeInteger;
	exhausted: NonNegativeInteger;
	skipped: NonNegativeInteger;
	results: WebhookDispatchResult[];
}

export interface WebhookTestOutput {
	event_id: WebhookId;
	delivery_id?: WebhookId | undefined;
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
	| "webhook";

export interface WebhookDeliveryEventSummary {
	id: WebhookId;
	type: WebhookEventType;
	schema_version: PositiveInteger;
	occurred_at: IsoDateTime;
	source: WebhookEventSource;
	correlation_id?: NonEmptyString | undefined;
	subject?: {
		kind: WebhookSubjectKind;
		key: NonEmptyString;
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
	last_error?: NonEmptyString | undefined;
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
}

export interface WebhookDeliveryRetryOutput {
	delivery: WebhookDelivery;
}

export interface WebhookReconcileInput {
	limit?: WebhookDeliveryListLimit | undefined;
	dry_run?: boolean | undefined;
}

export interface WebhookReconcileOutput {
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
	limit?: WebhookDeliveryListLimit | undefined;
	dry_run?: boolean | undefined;
}

export interface WebhookPruneOutput {
	eligible: NonNegativeInteger;
	deleted: NonNegativeInteger;
	dry_run: boolean;
	before: IsoDateTime;
}

export interface WebhookTickInput {
	dispatch_limit?: WebhookDispatchLimit | undefined;
	reconcile_limit?: WebhookDeliveryListLimit | undefined;
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

export type InboundDeliveryEventKind =
	| "delivered"
	| "bounced"
	| "complained"
	| "unsubscribed"
	| "delayed"
	| "rejected";

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

export interface WebhookDlqReplayInput {
	endpoint_id?: WebhookId | undefined;
	limit?: WebhookDeliveryListLimit | undefined;
	dry_run?: boolean | undefined;
}

export interface WebhookDlqReplayOutput {
	eligible: NonNegativeInteger;
	replayed: NonNegativeInteger;
	failed: NonNegativeInteger;
	dry_run: boolean;
	delivery_ids: WebhookId[];
	errors: {
		delivery_id: WebhookId;
		error: NonEmptyString;
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
