import { CAMPAIGN_SEND_AT_PATTERN } from "./campaign-send-at";

/**
 * Campaign lifecycle state machine.
 *
 * The transitions encoded below match the verified Listmonk 6.2.0 spike
 * recorded in `packages/abtest/src/lifecycle.ts`: `paused` and `cancelled`
 * are accepted **only** when the campaign is `running` (the server replies
 * `400 Only active campaigns can be cancelled` for `draft` or `scheduled`
 * sources). A scheduled campaign therefore cannot be cancelled directly;
 * callers must delete it instead.
 *
 * `running` is reachable from `draft` and `scheduled`; `scheduled` is
 * reachable from `draft`. Resuming from `paused` is allowed because
 * Listmonk treats a paused campaign as still active. Terminal statuses
 * (`finished`, `cancelled`) cannot transition anywhere.
 */
export const CAMPAIGN_TRANSITIONS: Readonly<
	Record<string, ReadonlySet<string>>
> = {
	draft: new Set(["scheduled", "running"]),
	scheduled: new Set(["running"]),
	running: new Set(["paused", "cancelled"]),
	paused: new Set(["running"]),
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
