import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest } from "./types";

/**
 * Opt-out propagation for temporary A/B test lists.
 *
 * An A/B test sends each variant campaign, and the holdout's winner
 * campaign, only to a temporary private list. Listmonk's public unsubscribe
 * link runs the `unsubscribe-by-campaign` query (Listmonk v6.2.0
 * `queries/subscribers.sql`), which marks the membership `unsubscribed` on
 * the campaign's lists only: the temporary list. The recipient stays
 * subscribed to the source lists the test drew its audience from, and
 * deleting the temporary list cascades its `subscriber_lists` rows away, so
 * the opt-out would be lost and later campaigns to the source lists would
 * still reach the recipient.
 *
 * Every path that deletes a temporary list a campaign may have reached (stop,
 * delete, provisioning rollback, and the legacy `cleanupHoldoutTest` and
 * `cleanup`) first calls {@link propagateTemporaryListOptOuts}. The
 * segmentation rollbacks do not: they only delete lists created moments
 * earlier in the same call, before any campaign targets them. The
 * propagation:
 *
 * 1. reads the subscribers whose membership on the temporary list is
 *    `unsubscribed` (`GET /subscribers` with `list_id` and
 *    `subscription_status=unsubscribed`, paginated) and fails closed unless
 *    every returned row really carries that membership: for an API user
 *    without permission on the list, Listmonk replaces the list filter with
 *    the user's other lists, or with none, instead of rejecting it;
 * 2. applies the `manageLists` `unsubscribe` action
 *    (`PUT /subscribers/lists`) to the source lists. Listmonk only updates
 *    existing memberships for this action, so it never subscribes anyone to a
 *    source list, and repeating it is harmless;
 * 3. reads the opt-outs again and confirms none of them is still subscribed
 *    to a source list, because Listmonk silently skips target lists the API
 *    user cannot manage.
 *
 * A temporary list is safe to delete only when it holds no opt-outs or every
 * opt-out is confirmed on the source lists. Otherwise the caller keeps the
 * list: its membership rows are the only record of the opt-outs, and a retry
 * or an operator can still carry them over.
 */

/** Page size for reading a temporary list's opt-outs. */
export const OPT_OUT_READ_PAGE_SIZE = 500;
/** Subscribers per `manageLists` unsubscribe request. */
export const OPT_OUT_UNSUBSCRIBE_CHUNK_SIZE = 500;
/** Upper bound on pages read from one list, so a looping server fails closed. */
const OPT_OUT_READ_MAX_PAGES = 10_000;
const UNSUBSCRIBED = "unsubscribed";
const MAX_FAILURE_DETAIL_LENGTH = 300;

/** One subscriber whose membership on a temporary list is `unsubscribed`. */
export interface TemporaryListOptOut {
	subscriberId: number;
	/**
	 * Listmonk's `subscription_status` for each of the subscriber's list
	 * memberships, keyed by list id.
	 */
	membershipStatuses: ReadonlyMap<number, string>;
}

/**
 * - `no_opt_outs`: nobody unsubscribed from the list; it may be deleted.
 * - `propagated`: every opt-out is confirmed on the source lists; it may be
 *   deleted.
 * - `blocked`: the list holds opt-outs but no source list is known to carry
 *   them to; it must be kept until an operator handles them.
 * - `failed`: reading, propagating, or confirming failed; it must be kept and
 *   the cleanup retried.
 */
export type TemporaryListOptOutPropagationStatus =
	| "no_opt_outs"
	| "propagated"
	| "blocked"
	| "failed";

export interface TemporaryListOptOutPropagation {
	listId: number;
	status: TemporaryListOptOutPropagationStatus;
	/** Whether the temporary list can be deleted without losing an opt-out. */
	safeToDelete: boolean;
	/**
	 * Subscribers whose membership on the temporary list is unsubscribed; 0
	 * when the opt-outs could not be read.
	 */
	optedOutCount: number;
	/**
	 * Opted-out subscribers this run unsubscribed from at least one source
	 * list and then confirmed; subscribers already unsubscribed there are not
	 * counted again.
	 */
	propagatedCount: number;
	/** Source lists the opt-outs are carried to. */
	sourceListIds: number[];
	/** Why the list must be kept; set whenever `safeToDelete` is false. */
	detail?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncateDetail(text: string): string {
	return text.length > MAX_FAILURE_DETAIL_LENGTH
		? `${text.slice(0, MAX_FAILURE_DETAIL_LENGTH)}... (truncated)`
		: text;
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		return truncateDetail(error.message);
	}
	if (typeof error === "string") {
		return truncateDetail(error);
	}
	if (isRecord(error) && typeof error.message === "string") {
		return truncateDetail(error.message);
	}
	try {
		return truncateDetail(JSON.stringify(error) ?? String(error));
	} catch {
		return truncateDetail(String(error));
	}
}

/**
 * Describe a client error envelope (`{ error, response }`) from its body and
 * HTTP status only; the request, whose headers carry the API credentials, is
 * never read. Returns undefined for a response without an error.
 */
function describeEnvelopeFailure(response: unknown): string | undefined {
	if (!isRecord(response) || response.error === undefined) {
		return undefined;
	}
	const message = describeError(response.error);
	const status = isRecord(response.response)
		? response.response.status
		: undefined;
	return typeof status === "number" ? `HTTP ${status}: ${message}` : message;
}

function normalizeListIds(listIds: readonly number[]): number[] {
	return [
		...new Set(listIds.filter((id) => Number.isSafeInteger(id) && id > 0)),
	].sort((left, right) => left - right);
}

/**
 * The source lists a test drew its audience from: the audience snapshot's
 * list ids together with the configured `baseConfig.lists`. Every A/B
 * create path requires at least one list, so an empty result only occurs
 * for a malformed or externally edited record; callers then keep temporary
 * lists that hold opt-outs instead of guessing a target.
 */
export function resolveOptOutSourceListIds(
	test: Pick<AbTest, "baseConfig" | "audienceSnapshot">,
): number[] {
	return normalizeListIds([
		...(test.audienceSnapshot?.sourceListIds ?? []),
		...(test.baseConfig?.lists ?? []),
	]);
}

function toTemporaryListOptOut(
	row: unknown,
	listId: number,
): TemporaryListOptOut {
	const subscriberId = isRecord(row) ? row.id : undefined;
	if (
		typeof subscriberId !== "number" ||
		!Number.isSafeInteger(subscriberId) ||
		subscriberId <= 0
	) {
		throw new Error(
			`Listmonk returned a subscriber without a numeric id while reading opt-outs on temporary list ${listId}`,
		);
	}
	const membershipStatuses = new Map<number, string>();
	const lists = isRecord(row) && Array.isArray(row.lists) ? row.lists : [];
	for (const membership of lists) {
		if (
			isRecord(membership) &&
			typeof membership.id === "number" &&
			typeof membership.subscription_status === "string"
		) {
			membershipStatuses.set(membership.id, membership.subscription_status);
		}
	}
	if (membershipStatuses.get(listId) !== UNSUBSCRIBED) {
		// Listmonk narrows list_id to the lists the API user may read and
		// falls back to other lists (or none) when nothing remains, so a row
		// without the unsubscribed membership means the filter was dropped.
		throw new Error(
			`Listmonk returned subscriber ${subscriberId} for temporary list ${listId} without an unsubscribed membership on it, so the list_id and subscription_status filter was not applied; check that the API user may read list ${listId}`,
		);
	}
	return { subscriberId, membershipStatuses };
}

/**
 * Read every subscriber whose membership on `listId` is `unsubscribed`.
 * Pages through `GET /subscribers` and throws, rather than returning a
 * partial or unfiltered set, when a page fails, a row does not carry the
 * unsubscribed membership, or fewer rows arrive than Listmonk reported.
 */
export async function readTemporaryListOptOuts(
	client: ListmonkClient,
	listId: number,
	options: { pageSize?: number } = {},
): Promise<TemporaryListOptOut[]> {
	const pageSize = options.pageSize ?? OPT_OUT_READ_PAGE_SIZE;
	if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
		throw new Error(
			`pageSize must be a positive integer, received ${pageSize}`,
		);
	}
	const optOuts = new Map<number, TemporaryListOptOut>();
	let reportedTotal: number | undefined;
	for (let page = 1; ; page += 1) {
		if (page > OPT_OUT_READ_MAX_PAGES) {
			throw new Error(
				`Reading opt-outs on temporary list ${listId} exceeded ${OPT_OUT_READ_MAX_PAGES} pages`,
			);
		}
		const response = await client.subscriber.list({
			query: {
				list_id: [listId],
				subscription_status: UNSUBSCRIBED,
				page,
				per_page: pageSize,
			},
		});
		const failure = describeEnvelopeFailure(response);
		if (failure !== undefined) {
			throw new Error(
				`Failed to read opt-outs on temporary list ${listId} (page ${page}): ${failure}`,
			);
		}
		const data = response.data;
		if (
			data === undefined ||
			!Array.isArray(data.results) ||
			typeof data.total !== "number" ||
			!Number.isSafeInteger(data.total) ||
			data.total < 0
		) {
			throw new Error(
				`Failed to read opt-outs on temporary list ${listId} (page ${page}): incomplete subscriber page payload`,
			);
		}
		if (reportedTotal !== undefined && reportedTotal !== data.total) {
			throw new Error(
				`Failed to read opt-outs on temporary list ${listId} (page ${page}): subscriber total changed from ${reportedTotal} to ${data.total}`,
			);
		}
		reportedTotal = data.total;
		const rows: readonly unknown[] = data.results;
		for (const row of rows) {
			const optOut = toTemporaryListOptOut(row, listId);
			optOuts.set(optOut.subscriberId, optOut);
		}
		if (rows.length < pageSize) {
			break;
		}
	}
	if (reportedTotal !== undefined && optOuts.size < reportedTotal) {
		throw new Error(
			`Read ${optOuts.size} of ${reportedTotal} opt-outs on temporary list ${listId}; the list changed or Listmonk capped the page size`,
		);
	}
	return [...optOuts.values()];
}

/**
 * Subscriber ids among `optOuts` that still hold a membership on one of the
 * source lists whose status is not `unsubscribed`. A subscriber who is not a
 * member of a source list needs nothing there: Listmonk 6.2 returns every
 * membership in `lists` and, for lists the API user cannot read, only masks
 * the name (keeping `id` and `subscription_status`), so a missing source list
 * means the subscriber left it or the list was deleted, not that it is hidden.
 */
export function findUnpropagatedOptOuts(
	optOuts: readonly TemporaryListOptOut[],
	sourceListIds: readonly number[],
): number[] {
	return optOuts
		.filter((optOut) =>
			sourceListIds.some((sourceListId) => {
				const status = optOut.membershipStatuses.get(sourceListId);
				return status !== undefined && status !== UNSUBSCRIBED;
			}),
		)
		.map((optOut) => optOut.subscriberId);
}

/**
 * Mark the subscribers' memberships on `listIds` as unsubscribed with the
 * `manageLists` `unsubscribe` action, in chunks. Listmonk updates only
 * memberships that already exist, so no one is added to a list. Throws on an
 * error envelope or an unacknowledged chunk.
 */
export async function unsubscribeSubscribersFromLists(
	client: ListmonkClient,
	subscriberIds: readonly number[],
	listIds: readonly number[],
	chunkSize: number = OPT_OUT_UNSUBSCRIBE_CHUNK_SIZE,
): Promise<void> {
	if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
		throw new Error(
			`chunkSize must be a positive integer, received ${chunkSize}`,
		);
	}
	if (subscriberIds.length === 0 || listIds.length === 0) {
		return;
	}
	for (let offset = 0; offset < subscriberIds.length; offset += chunkSize) {
		const chunk = subscriberIds.slice(offset, offset + chunkSize);
		const response = await client.subscriber.manageLists({
			body: {
				action: "unsubscribe",
				ids: chunk,
				target_list_ids: [...listIds],
			},
		});
		const failure = describeEnvelopeFailure(response);
		if (failure !== undefined) {
			throw new Error(
				`Failed to unsubscribe ${chunk.length} subscriber(s) from lists ${listIds.join(", ")}: ${failure}`,
			);
		}
		if (!isRecord(response) || response.data !== true) {
			throw new Error(
				`Listmonk did not acknowledge unsubscribing ${chunk.length} subscriber(s) from lists ${listIds.join(", ")}`,
			);
		}
	}
}

/**
 * Carry the opt-outs recorded on one temporary list to the source lists and
 * report whether the list can now be deleted. Never throws: every failure is
 * returned as a `failed` or `blocked` result so the caller keeps the list.
 * Repeating it after a partial failure is safe.
 */
export async function propagateTemporaryListOptOuts(
	client: ListmonkClient,
	input: {
		listId: number;
		sourceListIds: readonly number[];
		pageSize?: number;
		chunkSize?: number;
	},
): Promise<TemporaryListOptOutPropagation> {
	const { listId } = input;
	const sourceListIds = normalizeListIds(input.sourceListIds).filter(
		(sourceListId) => sourceListId !== listId,
	);
	const readOptions = { pageSize: input.pageSize };
	let optOuts: TemporaryListOptOut[];
	try {
		optOuts = await readTemporaryListOptOuts(client, listId, readOptions);
	} catch (error) {
		return {
			listId,
			status: "failed",
			safeToDelete: false,
			optedOutCount: 0,
			propagatedCount: 0,
			sourceListIds,
			detail: `its opt-outs could not be read: ${describeError(error)}`,
		};
	}
	if (optOuts.length === 0) {
		return {
			listId,
			status: "no_opt_outs",
			safeToDelete: true,
			optedOutCount: 0,
			propagatedCount: 0,
			sourceListIds,
		};
	}
	if (sourceListIds.length === 0) {
		return {
			listId,
			status: "blocked",
			safeToDelete: false,
			optedOutCount: optOuts.length,
			propagatedCount: 0,
			sourceListIds,
			detail: `${optOuts.length} subscriber(s) unsubscribed from it, but the test records no source lists to carry the opt-outs to; unsubscribe them from the lists they were drawn from, then remove them from list ${listId} and retry`,
		};
	}
	const pending = findUnpropagatedOptOuts(optOuts, sourceListIds);
	if (pending.length === 0) {
		return {
			listId,
			status: "propagated",
			safeToDelete: true,
			optedOutCount: optOuts.length,
			propagatedCount: 0,
			sourceListIds,
		};
	}
	try {
		await unsubscribeSubscribersFromLists(
			client,
			pending,
			sourceListIds,
			input.chunkSize,
		);
		const confirmed = await readTemporaryListOptOuts(
			client,
			listId,
			readOptions,
		);
		const unconfirmed = findUnpropagatedOptOuts(confirmed, sourceListIds);
		if (unconfirmed.length > 0) {
			const stillPending = new Set(unconfirmed);
			return {
				listId,
				status: "failed",
				safeToDelete: false,
				optedOutCount: confirmed.length,
				propagatedCount: pending.filter((id) => !stillPending.has(id)).length,
				sourceListIds,
				detail: `${unconfirmed.length} opted-out subscriber(s) are still subscribed to source lists ${sourceListIds.join(", ")} after the unsubscribe; check that the API user may manage those lists`,
			};
		}
		return {
			listId,
			status: "propagated",
			safeToDelete: true,
			optedOutCount: confirmed.length,
			propagatedCount: pending.length,
			sourceListIds,
		};
	} catch (error) {
		return {
			listId,
			status: "failed",
			safeToDelete: false,
			optedOutCount: optOuts.length,
			propagatedCount: 0,
			sourceListIds,
			detail: `${pending.length} opt-out(s) could not be carried to source lists ${sourceListIds.join(", ")}: ${describeError(error)}`,
		};
	}
}

/**
 * {@link propagateTemporaryListOptOuts} for several temporary lists, one
 * after another, in the given order.
 */
export async function propagateTemporaryListsOptOuts(
	client: ListmonkClient,
	input: { listIds: readonly number[]; sourceListIds: readonly number[] },
): Promise<TemporaryListOptOutPropagation[]> {
	const results: TemporaryListOptOutPropagation[] = [];
	for (const listId of input.listIds) {
		results.push(
			await propagateTemporaryListOptOuts(client, {
				listId,
				sourceListIds: input.sourceListIds,
			}),
		);
	}
	return results;
}

/** Operator-facing reason a temporary list was kept. */
export function describeRetainedTemporaryList(
	result: TemporaryListOptOutPropagation,
): string {
	return `temporary list ${result.listId} kept to preserve its opt-outs: ${result.detail ?? "they were not confirmed on the source lists"}`;
}
