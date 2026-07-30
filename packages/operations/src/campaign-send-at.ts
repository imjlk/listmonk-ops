/**
 * Exact shared contract for Listmonk campaign scheduling timestamps.
 *
 * It accepts ISO 8601 timestamps with a `Z` or numeric offset and Listmonk's
 * timezone-less `YYYY-MM-DD HH:MM[:SS]` form. Calendar dates, leap days, clock
 * components, offsets, and the RFC 3339 unknown offset `-00:00` are encoded in
 * the pattern so the TypeScript product contract and executable Zod boundary
 * expose the same accepted language.
 */
export const CAMPAIGN_SEND_AT_PATTERN_SOURCE =
	"^(?!0000-)(?:(?:[0-9]{4}-(?:(?:01|03|05|07|08|10|12)-(?:0[1-9]|[12][0-9]|3[01])|(?:04|06|09|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8])))|(?:(?:(?:[0-9]{2}(?:0[48]|[2468][048]|[13579][26]))|(?:(?:[02468][048]|[13579][26])00))-02-29))(?:(?:T(?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]{1,9})?)?(?:Z|\\+(?:[01][0-9]|2[0-3]):?[0-5][0-9]|-(?:(?:0[1-9]|1[0-9]|2[0-3]):?[0-5][0-9]|00:?(?:0[1-9]|[1-5][0-9]))))|(?: (?:[01][0-9]|2[0-3]):[0-5][0-9](?::[0-5][0-9](?:\\.[0-9]{1,9})?)?))$" as const;

export const CAMPAIGN_SEND_AT_PATTERN = new RegExp(
	CAMPAIGN_SEND_AT_PATTERN_SOURCE,
);
