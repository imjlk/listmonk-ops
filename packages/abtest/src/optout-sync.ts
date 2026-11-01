import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest, AbTestOptOutSyncState } from "./types";
import { TERMINAL_STATUSES } from "./types";
import {
	previewTemporaryListOptOuts,
	propagateTemporaryListOptOuts,
	resolveOptOutSourceListIds,
	type TemporaryListOptOutPreview,
	type TemporaryListOptOutPropagation,
} from "./unsubscribe-propagation";

/**
 * Opt-out sync for temporary A/B lists that are kept.
 *
 * Cleanup carries a temporary list's opt-outs to the source lists before it
 * deletes the list (`unsubscribe-propagation.ts`), but most temporary lists
 * are never deleted: a completed test keeps its variant lists and the
 * holdout list its winner campaign went to, and a stop keeps lists while a
 * cancelled or finished campaign still references them. Those campaigns'
 * unsubscribe links keep marking only the temporary list, days or weeks
 * after the send, so the opt-outs must be carried while the lists exist.
 *
 * {@link syncAbTestOptOuts} runs the same fail-closed propagation on every
 * temporary list of a test that still exists and records the outcome in
 * `AbTest.optOutSync`:
 *
 * - each confirmed opt-out is recorded as settled and never written again,
 *   so a person who later re-subscribes to a source list stays subscribed;
 * - a list Listmonk reports as deleted is recorded as missing and no longer
 *   read, since it can hold no opt-outs;
 * - `syncedAt` advances only when every remaining list was confirmed, so a
 *   failed or blocked list is retried by the next sync.
 *
 * Automatic syncs run from the A/B tick (see {@link isOptOutSyncDue}):
 * at most every {@link OPT_OUT_SYNC_INTERVAL_MS} while a test is active and
 * for {@link OPT_OUT_SYNC_RECENT_PERIOD_MS} after it ends, when nearly all
 * opt-outs arrive, then at most every
 * {@link OPT_OUT_SYNC_LONG_TAIL_INTERVAL_MS} for as long as a temporary
 * list exists, because Listmonk unsubscribe links never expire.
 */

/** Minimum time between automatic syncs of an active or recently ended test. */
export const OPT_OUT_SYNC_INTERVAL_MS = 60 * 60 * 1000;
/** How long after a test ends it keeps the hourly cadence. */
export const OPT_OUT_SYNC_RECENT_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
/** Minimum time between automatic syncs after the recent period. */
export const OPT_OUT_SYNC_LONG_TAIL_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * - `missing`: Listmonk reports the list deleted; nothing to carry.
 * - `no_opt_outs`: nobody unsubscribed from the list.
 * - `up_to_date`: every opt-out is already carried.
 * - `propagated`: this run carried `carriedCount` opt-outs and confirmed them.
 * - `pending`: dry run only; `pendingCount` opt-outs would be carried.
 * - `blocked`: the list holds opt-outs but the test records no source lists.
 * - `failed`: reading, carrying, or confirming failed; retried next time.
 */
export type AbTestOptOutSyncListStatus =
	| "missing"
	| "no_opt_outs"
	| "up_to_date"
	| "propagated"
	| "pending"
	| "blocked"
	| "failed";

export interface AbTestOptOutSyncListResult {
	listId: number;
	status: AbTestOptOutSyncListStatus;
	/** Subscribers whose membership on the temporary list is unsubscribed. */
	optedOutCount: number;
	/** Opt-outs this run unsubscribed from at least one source list. */
	carriedCount: number;
	/** Opt-outs a dry run would carry, or that remain after a failure. */
	pendingCount: number;
	detail?: string;
}

export interface AbTestOptOutSyncResult {
	testId: string;
	testStatus: AbTest["status"];
	/** The test was deleted; its record is retained for this sync only. */
	deleted: boolean;
	sourceListIds: number[];
	lists: AbTestOptOutSyncListResult[];
	/** No list failed or was blocked. */
	ok: boolean;
	/** Why the sync stopped before checking every list, if it did. */
	detail?: string;
}

export interface AbTestOptOutSyncOutcome {
	result: AbTestOptOutSyncResult;
	/** The test's next sync state; undefined for a dry run. */
	state?: AbTestOptOutSyncState;
}

function sortedUniqueIds(ids: Iterable<number>): number[] {
	return [
		...new Set([...ids].filter((id) => Number.isSafeInteger(id) && id > 0)),
	].sort((left, right) => left - right);
}

function toEpochMilliseconds(value: Date | string | undefined): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const time = value instanceof Date ? value.getTime() : Date.parse(value);
	return Number.isFinite(time) ? time : undefined;
}

/** Every temporary list a test created: its variant lists and holdout list. */
export function resolveTemporaryListIds(
	test: Pick<AbTest, "testListMappings" | "holdoutListId">,
): number[] {
	return sortedUniqueIds([
		...test.testListMappings.map((mapping) => mapping.listId),
		...(test.holdoutListId === undefined ? [] : [test.holdoutListId]),
	]);
}

/** The test's temporary lists not yet recorded as deleted in Listmonk. */
export function resolveTrackedTemporaryListIds(
	test: Pick<AbTest, "testListMappings" | "holdoutListId" | "optOutSync">,
): number[] {
	const missing = new Set(test.optOutSync?.missingListIds ?? []);
	return resolveTemporaryListIds(test).filter((listId) => !missing.has(listId));
}

/**
 * Whether a sync of every test should include this one: it finished
 * provisioning, has left draft (so a campaign may have reached its lists),
 * and still has a temporary list that exists.
 */
export function isOptOutSyncTracked(test: AbTest): boolean {
	return (
		test.pendingCreate === undefined &&
		test.status !== "draft" &&
		resolveTrackedTemporaryListIds(test).length > 0
	);
}

/**
 * Minimum time between automatic syncs of a test: hourly while it is active
 * and during the recent period after it ends (its terminal transition is
 * its last `updatedAt`), daily afterwards.
 */
export function resolveOptOutSyncInterval(test: AbTest, now: number): number {
	if (!TERMINAL_STATUSES.has(test.status)) {
		return OPT_OUT_SYNC_INTERVAL_MS;
	}
	const endedAt = toEpochMilliseconds(test.updatedAt);
	return endedAt !== undefined && now - endedAt >= OPT_OUT_SYNC_RECENT_PERIOD_MS
		? OPT_OUT_SYNC_LONG_TAIL_INTERVAL_MS
		: OPT_OUT_SYNC_INTERVAL_MS;
}

/**
 * Whether the automatic (tick) sync should check this test now: it is
 * tracked and its last confirmed sync is older than its interval. A test
 * whose last sync failed has no newer `syncedAt`, so it is retried at once.
 */
export function isOptOutSyncDue(test: AbTest, now: number): boolean {
	if (!isOptOutSyncTracked(test)) {
		return false;
	}
	const syncedAt = toEpochMilliseconds(test.optOutSync?.syncedAt);
	if (syncedAt === undefined || syncedAt > now) {
		return true;
	}
	return now - syncedAt >= resolveOptOutSyncInterval(test, now);
}

/**
 * Combine a test's sync state with newly settled opt-outs, newly missing
 * lists, and a new `syncedAt`. Both id sets only grow, so merging updates
 * from concurrent or repeated runs in any order gives the same state.
 */
export function mergeOptOutSyncState(
	current: AbTestOptOutSyncState | undefined,
	update: {
		settledSubscriberIds?: Iterable<number>;
		missingListIds?: Iterable<number>;
		syncedAt?: string;
	},
): AbTestOptOutSyncState {
	const missingListIds = sortedUniqueIds([
		...(current?.missingListIds ?? []),
		...(update.missingListIds ?? []),
	]);
	const syncedAt = update.syncedAt ?? current?.syncedAt;
	return {
		settledSubscriberIds: sortedUniqueIds([
			...(current?.settledSubscriberIds ?? []),
			...(update.settledSubscriberIds ?? []),
		]),
		...(missingListIds.length > 0 ? { missingListIds } : {}),
		...(syncedAt === undefined ? {} : { syncedAt }),
	};
}

/**
 * Settled ids only stop a later propagation of the same temporary lists
 * from carrying an opt-out twice, so once Listmonk reports every temporary
 * list of the test deleted (no opt-out can reach the test any more) they are
 * dropped. The missing list ids stay so the lists are not read again. While
 * a list exists its settled ids are kept, however many accumulate.
 */
function dropSettledIdsOnceListsAreGone(
	test: Pick<AbTest, "testListMappings" | "holdoutListId">,
	state: AbTestOptOutSyncState,
): AbTestOptOutSyncState {
	const missing = new Set(state.missingListIds ?? []);
	return state.settledSubscriberIds.length > 0 &&
		resolveTemporaryListIds(test).every((listId) => missing.has(listId))
		? { ...state, settledSubscriberIds: [] }
		: state;
}

/**
 * Record what a cleanup path's propagation settled on the test: the
 * confirmed opt-outs, the lists Listmonk reported missing, and the lists the
 * caller deleted. Leaves a test without sync state untouched when there is
 * nothing to record.
 */
export function recordTemporaryListOptOutPropagation(
	test: AbTest,
	input: {
		propagations: readonly TemporaryListOptOutPropagation[];
		removedListIds?: readonly number[];
		syncedAt?: string;
	},
): void {
	const settledSubscriberIds = input.propagations.flatMap(
		(propagation) => propagation.settledSubscriberIds,
	);
	const missingListIds = [
		...input.propagations
			.filter((propagation) => propagation.listMissing === true)
			.map((propagation) => propagation.listId),
		...(input.removedListIds ?? []),
	];
	if (
		test.optOutSync === undefined &&
		settledSubscriberIds.length === 0 &&
		missingListIds.length === 0 &&
		input.syncedAt === undefined
	) {
		return;
	}
	test.optOutSync = dropSettledIdsOnceListsAreGone(
		test,
		mergeOptOutSyncState(test.optOutSync, {
			settledSubscriberIds,
			missingListIds,
			syncedAt: input.syncedAt,
		}),
	);
}

function toListResultFromPropagation(
	propagation: TemporaryListOptOutPropagation,
): AbTestOptOutSyncListResult {
	let status: AbTestOptOutSyncListStatus = propagation.status;
	if (propagation.listMissing === true) {
		status = "missing";
	} else if (
		propagation.status === "propagated" &&
		propagation.propagatedCount === 0
	) {
		status = "up_to_date";
	}
	return {
		listId: propagation.listId,
		status,
		optedOutCount: propagation.optedOutCount,
		carriedCount: propagation.propagatedCount,
		pendingCount: propagation.pendingCount,
		...(propagation.detail === undefined ? {} : { detail: propagation.detail }),
	};
}

function toListResultFromPreview(
	preview: TemporaryListOptOutPreview,
): AbTestOptOutSyncListResult {
	return {
		listId: preview.listId,
		status: preview.listMissing ? "missing" : preview.status,
		optedOutCount: preview.optedOutCount,
		carriedCount: 0,
		pendingCount: preview.pendingCount,
		...(preview.detail === undefined ? {} : { detail: preview.detail }),
	};
}

/**
 * Carry the opt-outs on every tracked temporary list of one test to its
 * source lists (or, with `dryRun`, report what would be carried without
 * writing). Returns the per-list result and the test's next sync state;
 * applying the state is the caller's job so it lands in the same store
 * transaction. Never throws for a Listmonk failure: a failed or blocked list
 * is reported and leaves `syncedAt` unchanged so it is retried.
 */
export async function syncAbTestOptOuts(
	client: ListmonkClient,
	test: AbTest,
	options: { dryRun?: boolean; now?: Date } = {},
): Promise<AbTestOptOutSyncOutcome> {
	const sourceListIds = resolveOptOutSourceListIds(test);
	const settled = new Set(test.optOutSync?.settledSubscriberIds ?? []);
	const lists: AbTestOptOutSyncListResult[] = [];
	const newlySettled: number[] = [];
	const missingListIds: number[] = [];
	for (const listId of resolveTrackedTemporaryListIds(test)) {
		if (options.dryRun === true) {
			lists.push(
				toListResultFromPreview(
					await previewTemporaryListOptOuts(client, {
						listId,
						sourceListIds,
						settledSubscriberIds: settled,
					}),
				),
			);
			continue;
		}
		const propagation = await propagateTemporaryListOptOuts(client, {
			listId,
			sourceListIds,
			settledSubscriberIds: settled,
		});
		lists.push(toListResultFromPropagation(propagation));
		// Fold them in before the next list, one id at a time: a long-lived
		// list can settle more ids than a spread call accepts.
		for (const subscriberId of propagation.settledSubscriberIds) {
			settled.add(subscriberId);
			newlySettled.push(subscriberId);
		}
		if (propagation.listMissing === true) {
			missingListIds.push(listId);
		}
	}
	const ok = lists.every(
		(list) => list.status !== "failed" && list.status !== "blocked",
	);
	const result: AbTestOptOutSyncResult = {
		testId: test.id,
		testStatus: test.status,
		deleted: test.deletedAt !== undefined,
		sourceListIds,
		lists,
		ok,
	};
	if (options.dryRun === true) {
		return { result };
	}
	return {
		result,
		state: dropSettledIdsOnceListsAreGone(
			test,
			mergeOptOutSyncState(test.optOutSync, {
				settledSubscriberIds: newlySettled,
				missingListIds,
				syncedAt: ok ? (options.now ?? new Date()).toISOString() : undefined,
			}),
		),
	};
}

/** Operator-facing summary of the lists a sync could not confirm. */
export function describeOptOutSyncFailures(
	result: AbTestOptOutSyncResult,
): string {
	return result.lists
		.filter((list) => list.status === "failed" || list.status === "blocked")
		.map(
			(list) =>
				`temporary list ${list.listId} (${list.status}): ${list.detail ?? "its opt-outs were not confirmed on the source lists"}`,
		)
		.join("; ");
}
