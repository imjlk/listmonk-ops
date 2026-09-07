/**
 * Source pattern for the RFC3339 cutoff the unconfirmed-subscription
 * collection accepts, shared by the executable Zod schema and the
 * published Typia contract.
 */
export const MAINTENANCE_BEFORE_DATE_PATTERN_SOURCE =
	"^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?(Z|[+-]\\d{2}:\\d{2})$";
