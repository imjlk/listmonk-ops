/**
 * Source pattern for the ISO calendar dates (YYYY-MM-DD) the campaign
 * analytics range accepts, shared by the executable Zod schema and the
 * published Typia contract.
 */
export const CAMPAIGN_ANALYTICS_DATE_PATTERN_SOURCE = "^\\d{4}-\\d{2}-\\d{2}$";

/** Bound on campaigns aggregated by one analytics read. */
export const MAX_CAMPAIGN_ANALYTICS_IDS = 20;

/**
 * Listmonk 6.2 filters analytics with `created_at <= to`, so a bare
 * `YYYY-MM-DD` upper bound means midnight at the start of that day and
 * drops the whole day. Send the last microsecond of the inclusive end day
 * instead; like the bare start date, the database time zone applies.
 */
export function campaignAnalyticsRangeEnd(to: string): string {
	return `${to} 23:59:59.999999`;
}
