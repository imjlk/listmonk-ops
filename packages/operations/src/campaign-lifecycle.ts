/**
 * Campaign lifecycle state machine.
 *
 * Listmonk's `PUT /campaigns/{id}/status` endpoint accepts any of the four
 * target statuses (`scheduled`, `running`, `paused`, `cancelled`) without
 * documenting which transitions are legal from the campaign's current
 * status. Observed Listmonk 6.x behaviour is encoded below so the CLI/MCP
 * surfaces reject obviously invalid transitions before they reach the API.
 *
 * The map is intentionally permissive of resume paths (`paused -> running`)
 * and conservative about terminal statuses (`finished`, `cancelled`).
 */
export const CAMPAIGN_TRANSITIONS: Readonly<
	Record<string, ReadonlySet<string>>
> = {
	draft: new Set(["scheduled", "running"]),
	scheduled: new Set(["running", "paused", "cancelled"]),
	running: new Set(["paused", "cancelled"]),
	paused: new Set(["running", "cancelled"]),
	finished: new Set(),
	cancelled: new Set(),
};

/**
 * Target statuses accepted by `PUT /campaigns/{id}/status`. Campaigns can
 * never transition back into `draft` or directly into `finished`, which is
 * why those values are absent.
 */
export const CAMPAIGN_LIFECYCLE_TARGETS = [
	"scheduled",
	"running",
	"paused",
	"cancelled",
] as const;

export type CampaignLifecycleTarget =
	(typeof CAMPAIGN_LIFECYCLE_TARGETS)[number];

/**
 * Statuses that can never transition out. Any lifecycle operation targeting
 * a terminal campaign should be rejected up front.
 */
export const TERMINAL_CAMPAIGN_STATUSES: ReadonlySet<string> = new Set([
	"finished",
	"cancelled",
]);

/**
 * Returns true when a campaign in `current` status is allowed to move into
 * `target` according to {@link CAMPAIGN_TRANSITIONS}. Returns false for
 * unknown or undefined current statuses and for terminal statuses.
 */
export function canTransitionTo(
	current: string | undefined,
	target: CampaignLifecycleTarget,
): boolean {
	if (current === undefined) return false;
	const allowed = CAMPAIGN_TRANSITIONS[current];
	return allowed !== undefined && allowed.has(target);
}

/**
 * Returns true when `status` is a terminal campaign status (`finished` or
 * `cancelled`). Terminal campaigns cannot transition into any other status.
 */
export function isTerminalCampaignStatus(
	status: string | undefined,
): boolean {
	return status !== undefined && TERMINAL_CAMPAIGN_STATUSES.has(status);
}

/**
 * Error thrown by {@link assertCampaignTransition} when a requested campaign
 * status transition is not permitted by the state machine. Carries the
 * source and target statuses for structured logging.
 */
export class InvalidCampaignTransitionError extends Error {
	constructor(
		public readonly currentStatus: string | undefined,
		public readonly targetStatus: CampaignLifecycleTarget,
	) {
		super(
			`Campaign ${currentStatus ?? "<unknown>"} -> ${targetStatus} is not a valid lifecycle transition`,
		);
		this.name = "InvalidCampaignTransitionError";
	}
}

/**
 * Assert that `current` can transition into `target`. Throws a descriptive
 * {@link InvalidCampaignTransitionError} when the transition is not allowed,
 * including the terminal-status case where the campaign can never move
 * again.
 */
export function assertCampaignTransition(
	current: string | undefined,
	target: CampaignLifecycleTarget,
): void {
	if (!canTransitionTo(current, target)) {
		throw new InvalidCampaignTransitionError(current, target);
	}
}

const ISO_8601_TIMESTAMP_PATTERN =
	/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(:(?<second>\d{2})(?:\.\d{1,9})?)?(?:Z|(?<offsetSign>[+-])(?<offsetHour>\d{2}):?(?<offsetMinute>\d{2}))$/;
const LISTMONK_DATETIME_PATTERN =
	/^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2}) (?<hour>\d{2}):(?<minute>\d{2})(:(?<second>\d{2})(?:\.\d{1,9})?)?$/;

/**
 * Listmonk accepts two `send_at` shapes: ISO 8601 (e.g.
 * `2026-08-01T09:00:00Z`) and its own `YYYY-MM-DD HH:MM:SS` form. We reject
 * anything that does not match one of these so callers find out about
 * malformed input before the campaign's `send_at` is updated. We avoid the
 * broader `Date.parse` fallback because engines accept inconsistent
 * inputs (e.g. some treat a bare year like `"2026"` as valid).
 *
 * After the structural regex check passes we additionally verify each
 * component is in range using named capture groups. We do NOT rely on
 * `new Date(value)` round-trips because some engines silently roll over
 * impossible components (e.g. month 13 → January of next year) for the
 * `YYYY-MM-DD HH:MM:SS` form, which would let invalid input through.
 */
export function isParseableCampaignSendAt(value: string): boolean {
	if (value.length === 0) return false;
	const isoMatch = ISO_8601_TIMESTAMP_PATTERN.exec(value);
	if (isoMatch) {
		return validateDateComponents(isoMatch);
	}
	const listmonkMatch = LISTMONK_DATETIME_PATTERN.exec(value);
	if (listmonkMatch) {
		return validateDateComponents(listmonkMatch);
	}
	return false;
}

function validateDateComponents(match: RegExpExecArray): boolean {
	const groups = match.groups ?? {};
	const year = Number(groups.year);
	const month = Number(groups.month);
	const day = Number(groups.day);
	const hour = Number(groups.hour);
	const minute = Number(groups.minute);
	// `second` is optional in both patterns; treat absence as 0.
	const second = groups.second === undefined ? 0 : Number(groups.second);
	if (
		!Number.isInteger(year) ||
		year < 1 ||
		!Number.isInteger(month) ||
		month < 1 ||
		month > 12 ||
		!Number.isInteger(day) ||
		day < 1 ||
		day > daysInMonth(year, month) ||
		!Number.isInteger(hour) ||
		hour > 23 ||
		!Number.isInteger(minute) ||
		minute > 59 ||
		!Number.isInteger(second) ||
		second > 59
	) {
		return false;
	}
	// Validate the timezone offset when the ISO pattern captured one. The
	// LISTMONK_DATETIME_PATTERN never populates these groups. Real-world
	// offsets are bounded: the largest current IANA offset is +14:00, and
	// the most negative is -12:00. We accept up to ±23:59 so we do not
	// reject hypothetical (but still well-formed) military offsets, and
	// reject obvious garbage like `+99:99` that the regex alone would let
	// through.
	//
	// `+00:00` is a valid UTC offset and equivalent to `Z` per ISO 8601 /
	// RFC 3339 (many systems — Postgres, Python datetime.isoformat(),
	// Go time.RFC3339 — emit it instead of `Z`), so it must be accepted.
	// `-00:00` carries the distinct RFC 3339 meaning "offset unknown" and
	// is rejected to keep the contract unambiguous.
	if (groups.offsetHour !== undefined) {
		const offsetHour = Number(groups.offsetHour);
		const offsetMinute =
			groups.offsetMinute === undefined ? 0 : Number(groups.offsetMinute);
		const isNegative = groups.offsetSign === "-";
		if (
			!Number.isInteger(offsetHour) ||
			offsetHour > 23 ||
			!Number.isInteger(offsetMinute) ||
			offsetMinute > 59
		) {
			return false;
		}
		if (isNegative && offsetHour === 0 && offsetMinute === 0) {
			return false;
		}
	}
	return true;
}

function daysInMonth(year: number, month: number): number {
	// month is 1-indexed and already range-checked by the caller.
	switch (month) {
		case 1:
		case 3:
		case 5:
		case 7:
		case 8:
		case 10:
		case 12:
			return 31;
		case 4:
		case 6:
		case 9:
		case 11:
			return 30;
		case 2:
			return isLeapYear(year) ? 29 : 28;
		default:
			// Unreachable: validateDateComponents range-checks month to 1-12
			// before calling. Kept so TypeScript sees a total return.
			return 0;
	}
}

function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
