import { CAMPAIGN_SEND_AT_PATTERN } from "./campaign-send-at";

/**
 * Campaign lifecycle state machine.
 *
 * The transitions mirror Listmonk 6.2's `Core.UpdateCampaignStatus`
 * (`internal/core/campaigns.go`), which rejects everything else with 400:
 *
 * - `scheduled` from `draft` or `paused` (and only with a `send_at`);
 * - `running` from `draft` or `paused` — a `scheduled` campaign is started
 *   by Listmonk's scheduler at `send_at`, and starting it early needs an
 *   unschedule (`scheduled → draft`) first;
 * - `paused` from `running`;
 * - `cancelled` from `running` or `paused`, so a campaign paused by the
 *   deliverability guard can still be cancelled. A `draft` or `scheduled`
 *   campaign cannot be cancelled; delete it instead.
 *
 * Terminal statuses (`finished`, `cancelled`) cannot transition anywhere.
 */
export const CAMPAIGN_TRANSITIONS: Readonly<
	Record<string, ReadonlySet<string>>
> = {
	draft: new Set(["scheduled", "running"]),
	scheduled: new Set(),
	running: new Set(["paused", "cancelled"]),
	paused: new Set(["scheduled", "running", "cancelled"]),
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
			`Campaign ${currentStatus ?? "<unknown>"} -> ${targetStatus} is not a valid lifecycle transition${transitionHint(currentStatus, targetStatus)}`,
		);
		this.name = "InvalidCampaignTransitionError";
	}
}

function transitionHint(
	current: string | undefined,
	target: CampaignLifecycleTarget,
): string {
	if (current === "scheduled" && target === "running") {
		return "; Listmonk starts a scheduled campaign at its send_at, so unschedule it to draft before starting it early";
	}
	if (
		(current === "draft" || current === "scheduled") &&
		target === "cancelled"
	) {
		return "; only running or paused campaigns can be cancelled, so delete it instead";
	}
	return "";
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

/**
 * Listmonk accepts two `send_at` shapes: ISO 8601 (e.g.
 * `2026-08-01T09:00:00Z`) and its own `YYYY-MM-DD HH:MM:SS` form. We reject
 * anything that does not match one of these so callers find out about
 * malformed input before the campaign's `send_at` is updated. We avoid the
 * broader `Date.parse` fallback because engines accept inconsistent
 * inputs (e.g. some treat a bare year like `"2026"` as valid).
 *
 * The shared pattern encodes calendar and clock ranges directly. We do NOT
 * rely on `new Date(value)` round-trips because some engines silently roll
 * over impossible components (e.g. month 13 → January of next year) for the
 * `YYYY-MM-DD HH:MM:SS` form, which would let invalid input through.
 */
export function isParseableCampaignSendAt(value: string): boolean {
	return CAMPAIGN_SEND_AT_PATTERN.test(value);
}
