/**
 * Shared bound for campaign test-send recipients, referenced by both the
 * executable Zod schema and the published Typia contract so the published
 * agent-facing schema can never drift from the runtime cap.
 */
export const MAX_CAMPAIGN_TEST_RECIPIENTS = 10;

/** Maximum UTF-8 length accepted for one test-recipient email. */
export const MAX_CAMPAIGN_TEST_RECIPIENT_EMAIL_LENGTH = 254;
