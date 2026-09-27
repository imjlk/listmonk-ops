/**
 * Shared bounds for the subscriber import, referenced by both the
 * executable Zod schema and the published Typia contract so the
 * published agent-facing schema can never drift from the runtime caps.
 */

/** Maximum UTF-8 payload accepted for one import CSV (1 MiB). */
export const MAX_SUBSCRIBER_IMPORT_CSV_BYTES = 1024 * 1024;

/** Bound on target lists for one subscribe-mode import. */
export const MAX_SUBSCRIBER_IMPORT_LISTS = 20;

/**
 * Subscription statuses accepted for imported rows. Listmonk 6.2 accepts
 * only `unconfirmed`, `confirmed`, and `unsubscribed` and rejects anything
 * else with 400; `pending` is a deprecated alias sent as `unconfirmed`.
 */
export const SUBSCRIBER_IMPORT_SUBSCRIPTION_STATUSES = [
	"unconfirmed",
	"confirmed",
	"unsubscribed",
	"pending",
] as const;

export type SubscriberImportSubscriptionStatus =
	(typeof SUBSCRIBER_IMPORT_SUBSCRIPTION_STATUSES)[number];

/** Map an accepted import status to the value Listmonk 6.2 validates. */
export function toListmonkImportSubscriptionStatus(
	status: SubscriberImportSubscriptionStatus,
): Exclude<SubscriberImportSubscriptionStatus, "pending"> {
	return status === "pending" ? "unconfirmed" : status;
}
