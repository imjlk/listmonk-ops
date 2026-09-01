/**
 * Source pattern for the ISO calendar dates (YYYY-MM-DD) the campaign
 * analytics range accepts, shared by the executable Zod schema and the
 * published Typia contract.
 */
export const CAMPAIGN_ANALYTICS_DATE_PATTERN_SOURCE = "^\\d{4}-\\d{2}-\\d{2}$";

/** Bound on campaigns aggregated by one analytics read. */
export const MAX_CAMPAIGN_ANALYTICS_IDS = 20;
