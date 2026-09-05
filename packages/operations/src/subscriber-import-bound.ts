/**
 * Shared bounds for the subscriber import, referenced by both the
 * executable Zod schema and the published Typia contract so the
 * published agent-facing schema can never drift from the runtime caps.
 */

/** Maximum UTF-8 payload accepted for one import CSV (1 MiB). */
export const MAX_SUBSCRIBER_IMPORT_CSV_BYTES = 1024 * 1024;

/** Bound on target lists for one subscribe-mode import. */
export const MAX_SUBSCRIBER_IMPORT_LISTS = 20;
