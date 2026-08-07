import type { tags } from "typia";
import type { CAMPAIGN_SEND_AT_PATTERN_SOURCE } from "../../src/campaign-send-at";

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

export type TrimmedNonEmptyString = NonEmptyString &
	tags.Pattern<"^\\s*\\S[\\s\\S]*$">;

export type EmailAddress = string & tags.Format<"email">;

export type IsoDateTime = string & tags.Format<"date-time">;

export type IdempotencyKey = string &
	tags.MinLength<1> &
	tags.MaxLength<128> &
	tags.Pattern<"^[A-Za-z0-9._:-]+$">;

export interface PaginationInput {
	/** One-based result page. Omitted values use the shared operation default. */
	page?: PositiveInteger | undefined;
	/** Number of records per page. Omitted values use the shared operation default. */
	per_page?: PositiveInteger | undefined;
}

export interface ResourceIdInput {
	/** Positive Listmonk resource ID. */
	id: ResourceId;
}

export interface CapabilityFamily {
	id: NonEmptyString;
	title: NonEmptyString;
	operations: PositiveInteger;
	described: NonNegativeInteger;
}

export type DoctorCheckStatus = "pass" | "warn" | "fail" | "unknown";

export interface DoctorCheck {
	id: NonEmptyString;
	status: DoctorCheckStatus;
	message: NonEmptyString;
	details?: Record<string, unknown> | undefined;
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

export interface DnsObservation {
	name: NonEmptyString;
	type: "TXT" | "CNAME" | "MX";
	values: string[];
	error?: NonEmptyString | undefined;
}

export type Uuid = string & tags.Format<"uuid">;

export type InboundDeliveryEventKind =
	| "delivered"
	| "bounced"
	| "complained"
	| "unsubscribed"
	| "delayed"
	| "rejected";
