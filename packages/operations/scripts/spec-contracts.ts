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

export type SearchResultLimit = number &
	tags.Type<"int64"> &
	tags.Minimum<1> &
	tags.Maximum<100>;

export type PrimeRecommendationLimit = number &
	tags.Type<"int64"> &
	tags.Minimum<1> &
	tags.Maximum<20>;

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

export type SequenceStep =
	| {
			id: NonEmptyString;
			type: "send";
			template_id: ResourceId;
			from_email?: NonEmptyString | undefined;
			data?: Record<string, unknown> | undefined;
			content_type?: "html" | "markdown" | "plain" | undefined;
	  }
	| {
			id: NonEmptyString;
			type: "wait";
			duration_seconds: PositiveInteger;
	  }
	| {
			id: NonEmptyString;
			type: "wait_until";
			at: IsoDateTime;
	  }
	| {
			id: NonEmptyString;
			type: "condition";
			path: NonEmptyString;
			operator: "equals" | "not_equals" | "exists";
			value?: unknown;
			on_true: NonEmptyString;
			on_false: NonEmptyString;
	  }
	| {
			id: NonEmptyString;
			type: "stop";
	  };

export interface SequenceRevision {
	revision: PositiveInteger;
	steps: SequenceStep[];
	created_at: IsoDateTime;
}

export interface SequenceDefinition {
	id: string & tags.Format<"uuid">;
	name: NonEmptyString;
	description?: string | undefined;
	status: "active" | "paused";
	current_revision: PositiveInteger;
	revisions: SequenceRevision[];
	created_at: IsoDateTime;
	updated_at: IsoDateTime;
}

export interface SequenceEnrollment {
	id: string & tags.Format<"uuid">;
	sequence_id: string & tags.Format<"uuid">;
	revision: PositiveInteger;
	subscriber_id: ResourceId;
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
	current_step_id: NonEmptyString;
	next_run_at: IsoDateTime;
	last_error?: string | undefined;
	created_at: IsoDateTime;
	updated_at: IsoDateTime;
}

export interface SequenceValidateInput {
	steps: SequenceStep[];
}

export interface SequenceValidateOutput {
	valid: true;
	step_count: PositiveInteger;
	step_ids: NonEmptyString[];
}

export interface SequenceCreateInput {
	name: NonEmptyString;
	description?: string | undefined;
	steps: SequenceStep[];
}

export interface SequenceDefinitionOutput {
	sequence: SequenceDefinition;
}

export interface SequenceUpdateInput {
	id: string & tags.Format<"uuid">;
	name?: NonEmptyString | undefined;
	description?: string | undefined;
	steps: SequenceStep[];
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

export interface SequenceDeleteOutput {
	deleted: true;
	sequence: SequenceDefinition;
}

export interface SequenceEnrollInput {
	id: string & tags.Format<"uuid">;
	subscriber_id: ResourceId;
	context?: Record<string, unknown> | undefined;
	start_at?: IsoDateTime | undefined;
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
}

export interface SequenceTickOutput {
	claimed: NonNegativeInteger;
	advanced: NonNegativeInteger;
	waiting: NonNegativeInteger;
	completed: NonNegativeInteger;
	failed: NonNegativeInteger;
	ambiguous: NonNegativeInteger;
	cancelled: NonNegativeInteger;
	completed_at: IsoDateTime;
}

export interface SequenceReconcileInput {
	enrollment_id?: (string & tags.Format<"uuid">) | undefined;
	resolution?: "sent" | "not_sent" | undefined;
	limit: PositiveInteger;
	dry_run: boolean;
}

export interface SequenceReconcileOutput {
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
	limit?: SearchResultLimit | undefined;
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
	limit?: PrimeRecommendationLimit | undefined;
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

export type ProviderProfileId = NonEmptyString &
	tags.MaxLength<80> &
	tags.Pattern<"^[a-z][a-z0-9._-]*$">;
export type ProviderKind = "ses" | "smtp";
export type DoctorCheckStatus = "pass" | "warn" | "fail" | "unknown";
export type ProviderWebhookMaxAgeHours = number &
	tags.Type<"int64"> &
	tags.Minimum<1> &
	tags.Maximum<8760>;

export interface ProviderListInput {}

export interface ProviderProfileSummary {
	id: ProviderProfileId;
	kind: ProviderKind;
	messenger: NonEmptyString;
	sending_domain: NonEmptyString;
	from_email?: EmailAddress | undefined;
	region?: NonEmptyString | undefined;
	smtp_hosts: string[];
	webhook_source: NonEmptyString;
	credential_reference_configured: boolean;
}

export interface ProviderListOutput {
	configured: boolean;
	profiles: ProviderProfileSummary[];
}

export interface ProviderIdInput {
	provider_id: ProviderProfileId;
}

export interface ProviderWebhookStatusInput {
	provider_id: ProviderProfileId;
	max_age_hours?: ProviderWebhookMaxAgeHours | undefined;
}

export interface DoctorCheck {
	id: NonEmptyString;
	status: DoctorCheckStatus;
	message: NonEmptyString;
	details?: Record<string, unknown> | undefined;
}

export interface ProviderApiProbe {
	supported: boolean;
	reachable: boolean;
	authenticated: boolean;
	latency_ms?: NonNegativeInteger | undefined;
	error_code?: NonEmptyString | undefined;
	error_message?: NonEmptyString | undefined;
}

export interface SesAccountSnapshot {
	production_access_enabled?: boolean | undefined;
	sending_enabled?: boolean | undefined;
	enforcement_status?: NonEmptyString | undefined;
	max_24_hour_send?: number | undefined;
	max_send_rate?: number | undefined;
	sent_last_24_hours?: number | undefined;
	suppressed_reasons: string[];
}

export interface SesIdentitySnapshot {
	identity_type?: NonEmptyString | undefined;
	verified_for_sending?: boolean | undefined;
	verification_status?: NonEmptyString | undefined;
	feedback_forwarding_enabled?: boolean | undefined;
	dkim_signing_enabled?: boolean | undefined;
	dkim_status?: NonEmptyString | undefined;
	dkim_tokens: string[];
	mail_from_domain?: NonEmptyString | undefined;
	mail_from_status?: NonEmptyString | undefined;
	mail_from_behavior?: NonEmptyString | undefined;
}

export interface ProviderListmonkSnapshot {
	from_email?: string | undefined;
	from_domain?: NonEmptyString | undefined;
	messenger: NonEmptyString;
	messenger_binding_ambiguous: boolean;
	messenger_configured: boolean;
	messenger_enabled: boolean;
	smtp_hosts: string[];
	enabled_smtp_hosts: string[];
	matching_smtp_hosts: string[];
	smtp_configured: boolean;
	smtp_enabled: boolean;
	smtp_pool_exact: boolean;
	smtp_credential_binding_required: boolean;
	smtp_credentials_bound: boolean;
	unsubscribe_header_enabled: boolean;
	bounce_processing_enabled: boolean;
	bounce_webhooks_enabled: boolean;
	provider_bounce_enabled?: boolean | undefined;
}

export interface ProviderStatusOutput {
	provider: ProviderProfileSummary;
	health: "healthy" | "degraded" | "unavailable";
	checked_at: IsoDateTime;
	api: ProviderApiProbe;
	account?: SesAccountSnapshot | undefined;
	identity?: SesIdentitySnapshot | undefined;
	listmonk?: ProviderListmonkSnapshot | undefined;
	checks: DoctorCheck[];
}

export interface ProviderTestOutput {
	provider_id: ProviderProfileId;
	checked_at: IsoDateTime;
	probe: ProviderApiProbe;
}

export interface ProviderQuotaOutput {
	provider_id: ProviderProfileId;
	supported: boolean;
	checked_at: IsoDateTime;
	max_24_hour_send?: number | undefined;
	max_send_rate?: number | undefined;
	sent_last_24_hours?: number | undefined;
	remaining_24_hours?: number | undefined;
	utilization_percent?: number | undefined;
	production_access_enabled?: boolean | undefined;
	sending_enabled?: boolean | undefined;
	enforcement_status?: NonEmptyString | undefined;
}

export interface ProviderWebhookStatusOutput {
	provider_id: ProviderProfileId;
	source: NonEmptyString;
	evidence_scope: "profile" | "shared";
	checked_at: IsoDateTime;
	max_age_hours: ProviderWebhookMaxAgeHours;
	bounce_processing_enabled: boolean;
	bounce_webhooks_enabled: boolean;
	provider_bounce_enabled?: boolean | undefined;
	last_event_at?: IsoDateTime | undefined;
	last_event_type?: NonEmptyString | undefined;
	freshness: "fresh" | "stale" | "unknown";
	healthy: boolean;
	checks: DoctorCheck[];
}

export interface DnsObservation {
	name: NonEmptyString;
	type: "TXT" | "CNAME" | "MX";
	values: string[];
	error?: NonEmptyString | undefined;
}

export interface DeliverabilityDnsCheckOutput {
	provider_id: ProviderProfileId;
	sending_domain: NonEmptyString;
	from_domain: NonEmptyString;
	mail_from_domain?: NonEmptyString | undefined;
	checked_at: IsoDateTime;
	observations: DnsObservation[];
	checks: DoctorCheck[];
	healthy: boolean;
}

export interface DeliverabilityDoctorOutput {
	provider_id: ProviderProfileId;
	checked_at: IsoDateTime;
	ready: boolean;
	summary: {
		pass: NonNegativeInteger;
		warn: NonNegativeInteger;
		fail: NonNegativeInteger;
		unknown: NonNegativeInteger;
	};
	status: ProviderStatusOutput;
	quota: ProviderQuotaOutput;
	webhook: ProviderWebhookStatusOutput;
	dns: DeliverabilityDnsCheckOutput;
	checks: DoctorCheck[];
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
	| "sequence"
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
