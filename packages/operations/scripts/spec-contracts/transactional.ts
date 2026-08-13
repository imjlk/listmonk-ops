import type { tags } from "typia";
import type { TRANSACTIONAL_FROM_EMAIL_PATTERN_SOURCE } from "../../src/transactional";
import type {
	ResourceId,
	NonEmptyString,
	TrimmedNonEmptyString,
	EmailAddress,
	IsoDateTime,
	IdempotencyKey,
	ResourceIdInput,
} from "./primitives";

export type TransactionalSubject = string &
	tags.MinLength<1> &
	tags.Pattern<"^(?=[^\\u0000-\\u001f\\u007f]*\\S)[^\\u0000-\\u001f\\u007f]+$">;

export type TransactionalFromEmail = string &
	tags.MinLength<1> &
	tags.MaxLength<512> &
	tags.Pattern<typeof TRANSACTIONAL_FROM_EMAIL_PATTERN_SOURCE>;

export type TransactionalMessenger = TrimmedNonEmptyString;

export interface TransactionalSendBaseInput {
	template_id: ResourceId;
	/**
	 * RFC 5322 From header value. This may include a display name such as
	 * `Newsletter <news@example.com>`, so it is intentionally not narrowed to
	 * the bare-address-only EmailAddress contract.
	 */
	from_email?: TransactionalFromEmail | undefined;
	data?: Record<string, unknown> | undefined;
	headers?: Record<string, string>[] | undefined;
	content_type?: "html" | "markdown" | "plain" | undefined;
	messenger?: TransactionalMessenger | undefined;
	subject?: TransactionalSubject | undefined;
	altbody?: NonEmptyString | undefined;
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
