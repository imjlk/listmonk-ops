import type { tags } from "typia";
import type {
	NonNegativeInteger,
	NonEmptyString,
	EmailAddress,
	IsoDateTime,
	SesAccountSnapshot,
	SesIdentitySnapshot,
	DoctorCheck,
	DnsObservation,
	DoctorCheckStatus,
} from "./primitives";

export type ProviderProfileId = NonEmptyString &
	tags.MaxLength<80> &
	tags.Pattern<"^[a-z][a-z0-9._-]*$">;

export type ProviderKind = "ses" | "smtp";

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

export interface ProviderApiProbe {
	supported: boolean;
	reachable: boolean;
	authenticated: boolean;
	latency_ms?: NonNegativeInteger | undefined;
	error_code?: NonEmptyString | undefined;
	error_message?: NonEmptyString | undefined;
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
