import type { AbTestOptOutSourceSettlement } from "./types";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { formatListmonkError, listmonkResponseStatus } from "./listmonk-errors";
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
 * earlier in the same call, before any campaign targets them. Lists that are
 * kept (a completed test's variant and holdout lists, or lists a stop keeps
 * for cancelled or finished campaigns) keep recording opt-outs from those
 * campaigns' unsubscribe links, so `optout-sync.ts` runs the same
 * propagation on them repeatedly. The propagation:
 *
 * 1. reads the subscribers whose membership on the temporary list is
 *    `unsubscribed` (`GET /subscribers` with `list_id` and
 *    `subscription_status=unsubscribed`, paginated) after first verifying
 *    that the list exists and is readable, and fails closed unless every
 *    returned row really carries that membership. For an API user without
 *    permission on the list, Listmonk may replace the list filter with the
 *    user's other lists, or with none, instead of rejecting it;
 * 2. skips the opt-outs the caller reports as already carried (settled), so
 *    a person who re-subscribes to a source list after their opt-out was
 *    carried is never unsubscribed again;
 * 3. applies the `manageLists` `unsubscribe` action
 *    (`PUT /subscribers/lists`) to the source lists. Listmonk only updates
 *    existing memberships for this action, so it never subscribes anyone to a
 *    source list, and repeating it is harmless. Like `unsubscribe-by-campaign`,
 *    which marks the memberships that exist when the person opts out, a
 *    source membership Listmonk reports as created after the opt-out is left
 *    alone: it is a later subscription the opt-out does not cover;
 * 4. reads the opt-outs again and confirms none of them is still subscribed
 *    to a source list, because Listmonk silently skips target lists the API
 *    user cannot manage, and reports every opt-out it confirmed so the caller
 *    can record it as settled.
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
	/**
	 * When each membership was created (epoch milliseconds), keyed by list
	 * id, for the memberships Listmonk reported a parseable
	 * `subscription_created_at` for.
	 */
	membershipCreatedAt?: ReadonlyMap<number, number>;
	/** Raw Listmonk creation timestamps, retaining PostgreSQL microseconds. */
	membershipCreatedTimestamps?: ReadonlyMap<number, string>;
	membershipUpdatedAt?: ReadonlyMap<number, string>;
	optedOutTimestamp?: string;
	/**
	 * When the temporary-list membership last changed (epoch milliseconds),
	 * taken as the opt-out time: `unsubscribe-by-campaign` stamps
	 * `updated_at` when it marks the membership, and a later write to a
	 * private temporary list's membership (a blocklist, for example) only
	 * moves it later, which can make the opt-out cover more source
	 * memberships, never fewer. Undefined when Listmonk did not report a
	 * parseable time.
	 */
	optedOutAt?: number;
	/** Source lists already covered by another test, not synthetic remote status. */
	settledSourceListIds?: ReadonlySet<number>;
}

/**
 * - `no_opt_outs`: nobody unsubscribed from the list, or the list no longer
 *   exists (`listMissing`); it may be deleted.
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
	 * Set when Listmonk reports that the list no longer exists, so it can
	 * hold no opt-outs now or later.
	 */
	listMissing?: true;
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
	/**
	 * Opt-outs still to be carried after this run: unconfirmed, not attempted
	 * after a failed write, or blocked; 0 when the opt-outs could not be read.
	 */
	pendingCount: number;
	/**
	 * Opt-outs, other than the ones passed in as already settled, that this
	 * run confirmed on the source lists: carried now, or with nothing left to
	 * carry. Record them so a later run skips them.
	 */
	settledSubscriberIds: number[];
	/** Source lists the opt-outs are carried to. */
	sourceListIds: number[];
	/** Why the list must be kept; set whenever `safeToDelete` is false. */
	detail?: string;
}

/**
 * Read-only counterpart of {@link TemporaryListOptOutPropagation} for dry
 * runs: `up_to_date` when every opt-out is already carried and `pending`
 * when `pendingCount` opt-outs would be carried.
 */
export interface TemporaryListOptOutPreview {
	listId: number;
	status: "no_opt_outs" | "up_to_date" | "pending" | "blocked" | "failed";
	/** Set when Listmonk reports that the list no longer exists. */
	listMissing?: true;
	optedOutCount: number;
	pendingCount: number;
	/**
	 * The opt-outs a successful run would record as settled (every one not
	 * already settled), so a preview of several lists can skip them on the
	 * later lists exactly as a real run does.
	 */
	wouldSettleSubscriberIds: number[];
	sourceListIds: number[];
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
	return typeof status === "number" && (status < 200 || status >= 300)
		? `HTTP ${status}: ${message}`
		: message;
}

function isMissingListResponse(response: unknown): boolean {
	const status = listmonkResponseStatus(response);
	if (
		(status !== 400 && status !== 404) ||
		!isRecord(response) ||
		response.error === undefined
	) {
		return false;
	}
	return /^list(?:\s+(?:with\s+id\s+)?\d+)?\s+not found\.?$/i.test(
		formatListmonkError(response.error).trim(),
	);
}

type ListReadability =
	| { status: "readable" | "not_found" }
	| { status: "unreadable"; detail: string };

async function probeListReadability(
	client: ListmonkClient,
	listId: number,
): Promise<ListReadability> {
	try {
		const response = await client.list.getById({ path: { list_id: listId } });
		if (isMissingListResponse(response)) {
			return { status: "not_found" };
		}
		const failure = describeEnvelopeFailure(response);
		if (failure !== undefined) {
			return { status: "unreadable", detail: failure };
		}
		if (
			!isRecord(response) ||
			!("data" in response) ||
			!isRecord(response.data) ||
			response.data.id !== listId
		) {
			return {
				status: "unreadable",
				detail: "the response did not confirm the requested list",
			};
		}
		return { status: "readable" };
	} catch (error) {
		return { status: "unreadable", detail: describeError(error) };
	}
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
	const membershipCreatedAt = new Map<number, number>();
	const membershipCreatedTimestamps = new Map<number, string>();
	const membershipUpdatedAt = new Map<number, string>();
	let optedOutTimestamp: string | undefined;
	let optedOutAt: number | undefined;
	const lists = isRecord(row) && Array.isArray(row.lists) ? row.lists : [];
	for (const membership of lists) {
		if (
			isRecord(membership) &&
			typeof membership.id === "number" &&
			typeof membership.subscription_status === "string"
		) {
			membershipStatuses.set(membership.id, membership.subscription_status);
			const rawCreatedAt = membership.subscription_created_at;
			if (typeof rawCreatedAt === "string") {
				membershipCreatedTimestamps.set(membership.id, rawCreatedAt);
			}
			const createdAt = parseListmonkTimestamp(rawCreatedAt);
			if (createdAt !== undefined) {
				membershipCreatedAt.set(membership.id, createdAt);
			}
			const rawUpdatedAt = membership.subscription_updated_at;
			const updatedAt = typeof rawUpdatedAt === "string" && parseOptOutTimestampMicros(rawUpdatedAt) !== undefined
				? rawUpdatedAt
				: undefined;
			if (updatedAt !== undefined) membershipUpdatedAt.set(membership.id, updatedAt);
			if (membership.id === listId) {
				optedOutTimestamp = updatedAt;
				optedOutAt = parseListmonkTimestamp(
					membership.subscription_updated_at,
				);
			}
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
	return {
		subscriberId,
		membershipStatuses,
		membershipCreatedAt,
		membershipCreatedTimestamps,
		membershipUpdatedAt,
		...(optedOutTimestamp === undefined ? {} : { optedOutTimestamp }),
		...(optedOutAt === undefined ? {} : { optedOutAt }),
	};
}

/** PostgreSQL membership timestamps retain microseconds; Date.parse alone truncates them. */
export function parseOptOutTimestampMicros(value: string): bigint | undefined {
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds)) return undefined;
	const fraction = /\.(\d+)(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.exec(value)?.[1] ?? "";
 // Unknown finer-than-Postgres precision must not be treated as equal evidence.
	if (fraction.length > 6 && /[1-9]/.test(fraction.slice(6))) return undefined;
	return BigInt(milliseconds) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3, 6));
}

/**
 * Epoch milliseconds for a Listmonk timestamp (`subscription_created_at`
 * and `subscription_updated_at` are PostgreSQL `timestamptz` values such as
 * `2026-10-01T12:34:56.789012+00:00`), or undefined when absent or
 * unparseable.
 */
function parseListmonkTimestamp(value: unknown): number | undefined {
	if (typeof value !== "string" || value.trim() === "") {
		return undefined;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Read every subscriber whose membership on `listId` is `unsubscribed`.
 * Pages through the raw `GET /subscribers` response and throws, rather than
 * returning a partial or unfiltered set, when the client cannot preserve raw
 * pages, a page fails, a row does not carry the unsubscribed membership, or
 * fewer rows arrive than Listmonk reported.
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
		const options = {
			query: {
				list_id: [listId],
				subscription_status: UNSUBSCRIBED,
				page,
				per_page: pageSize,
			},
		};
		const rawListPage = client.subscriber.listRaw;
		if (rawListPage === undefined) {
			throw new Error(
				"the Listmonk client does not support raw subscriber page reads",
			);
		}
		const response: unknown = await rawListPage(options);
		const failure = describeEnvelopeFailure(response);
		if (failure !== undefined) {
			throw new Error(
				`Failed to read opt-outs on temporary list ${listId} (page ${page}): ${failure}`,
			);
		}
		const data = isRecord(response) && "data" in response
			? response.data
			: undefined;
		if (
			!isRecord(data) ||
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
 * Whether Listmonk reports the subscriber's membership on `listId` as
 * created after the opt-out. Unknown times count as earlier, so a missing or
 * unparseable timestamp never shields a membership from the opt-out.
 */
function isMembershipNewerThanOptOut(
	optOut: TemporaryListOptOut,
	listId: number,
): boolean {
	if (optOut.settledSourceListIds?.has(listId)) return true;
	const rawCreatedAt = optOut.membershipCreatedTimestamps?.get(listId);
	if (rawCreatedAt !== undefined || optOut.optedOutTimestamp !== undefined) {
		const created = rawCreatedAt === undefined
			? undefined
			: parseOptOutTimestampMicros(rawCreatedAt);
		const optedOut = optOut.optedOutTimestamp === undefined
			? undefined
			: parseOptOutTimestampMicros(optOut.optedOutTimestamp);
		return created !== undefined && optedOut !== undefined && created > optedOut;
	}
	// Compatibility for in-memory callers supplying already-resolved millisecond values.
	const createdAt = optOut.membershipCreatedAt?.get(listId);
	return (
		optOut.optedOutAt !== undefined &&
		createdAt !== undefined &&
		createdAt > optOut.optedOutAt
	);
}

/**
 * The source lists one opt-out still has to be carried to: lists the
 * subscriber holds a membership on whose status is not `unsubscribed`. A
 * subscriber who is not a member of a source list needs nothing there:
 * Listmonk 6.2 returns every membership in `lists` and, for lists the API
 * user cannot read, only masks the name (keeping `id` and
 * `subscription_status`), so a missing source list means the subscriber left
 * it or the list was deleted, not that it is hidden. A membership created
 * after the opt-out is a later subscription that `unsubscribe-by-campaign`
 * would not have touched either, so it is left alone.
 */
export function resolvePendingSourceListIds(
	optOut: TemporaryListOptOut,
	sourceListIds: readonly number[],
): number[] {
	return sourceListIds.filter((sourceListId) => {
		const status = optOut.membershipStatuses.get(sourceListId);
		return (
			status !== undefined &&
			status !== UNSUBSCRIBED &&
			!isMembershipNewerThanOptOut(optOut, sourceListId)
		);
	});
}

/**
 * Subscriber ids among `optOuts` that still have to be carried to at least
 * one source list (see {@link resolvePendingSourceListIds}).
 */
export function findUnpropagatedOptOuts(
	optOuts: readonly TemporaryListOptOut[],
	sourceListIds: readonly number[],
): number[] {
	return optOuts
		.filter(
			(optOut) =>
				resolvePendingSourceListIds(optOut, sourceListIds).length > 0,
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
 * Unsubscribe each opt-out from the source lists, leaving alone any
 * membership Listmonk reports as created after the opt-out. Opt-outs are
 * grouped by the lists they target, so the common case, in which every
 * source membership predates the opt-out, stays one chunked request series
 * against all source lists.
 */
async function unsubscribeOptOutsFromSourceLists(
	client: ListmonkClient,
	optOuts: readonly TemporaryListOptOut[],
	sourceListIds: readonly number[],
	chunkSize: number = OPT_OUT_UNSUBSCRIBE_CHUNK_SIZE,
	onChunk?: (subscriberIds: readonly number[]) => Promise<void>,
): Promise<void> {
	if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
		throw new Error(
			`chunkSize must be a positive integer, received ${chunkSize}`,
		);
	}
	const groups = new Map<
		string,
		{ listIds: number[]; subscriberIds: number[] }
	>();
	for (const optOut of optOuts) {
		const listIds = sourceListIds.filter(
			(sourceListId) => !isMembershipNewerThanOptOut(optOut, sourceListId),
		);
		const key = listIds.join(",");
		const group = groups.get(key) ?? { listIds, subscriberIds: [] };
		group.subscriberIds.push(optOut.subscriberId);
		groups.set(key, group);
	}
	for (const group of groups.values()) {
		for (let offset = 0; offset < group.subscriberIds.length; offset += chunkSize) {
			const chunk = group.subscriberIds.slice(offset, offset + chunkSize);
			await unsubscribeSubscribersFromLists(
				client,
				chunk,
				group.listIds,
				chunkSize,
			);
			await onChunk?.(chunk);
		}
	}
}

/**
 * The outcome of reading one temporary list, shared by the propagation and
 * its dry-run preview so both classify a list the same way:
 *
 * - `missing`: Listmonk reports the list deleted;
 * - `failed`: the list or its opt-outs could not be read;
 * - `no_opt_outs`: nobody unsubscribed from it;
 * - `blocked`: it holds opt-outs but no source list is known;
 * - `read`: its opt-outs, the ones not settled by an earlier run, and the
 *   unsettled ones that still have a source membership to carry to.
 */
type TemporaryListOptOutClassification =
	| { kind: "missing" }
	| { kind: "failed"; detail: string }
	| { kind: "no_opt_outs" }
	| {
			kind: "blocked";
			optedOutCount: number;
			unsettledCount: number;
			detail: string;
	  }
	| {
			kind: "read";
			optOuts: TemporaryListOptOut[];
			unsettled: TemporaryListOptOut[];
			pending: TemporaryListOptOut[];
	  };

export type OptOutSourceConfirmed = (subscriberId: number, sourceListId: number, through: string | undefined) => void;

interface SourceSettlementEvidence {
	alreadySettled?: Pick<ReadonlySet<number>, "has">;
	sourceSettlements?: readonly AbTestOptOutSourceSettlement[];
	legacySourceSettlements?: readonly { subscriberId: number; sourceListId: number }[];
	onSourceUnsubscribed?: OptOutSourceConfirmed;
}

function reconcileSourceSettlements(optOuts: TemporaryListOptOut[], sourceListIds: readonly number[], evidence: SourceSettlementEvidence): TemporaryListOptOut[] {
	const checkpoints = new Map<string, bigint>();
	const unknown = new Set<string>();
	const legacy = new Set(
		evidence.legacySourceSettlements?.map(
			(entry) => `${entry.subscriberId}:${entry.sourceListId}`,
		),
	);
	for (const entry of evidence.sourceSettlements ?? []) {
		const key = `${entry.subscriberId}:${entry.sourceListId}`;
		const through = entry.through === null
			? undefined
			: parseOptOutTimestampMicros(entry.through);
		if (through === undefined) unknown.add(key);
		else if (!checkpoints.has(key) || through > checkpoints.get(key)!) checkpoints.set(key, through);
	}
	return optOuts.map((optOut) => {
  // Previously confirmed recipients are deliberately never re-checked after reconsent.
  if (evidence.alreadySettled?.has(optOut.subscriberId)) return optOut;
  const settledSourceListIds = new Set<number>();
  for (const sourceListId of sourceListIds) {
   const status = optOut.membershipStatuses.get(sourceListId);
   if (status === UNSUBSCRIBED) {
    // Only remote event timestamps establish chronology, never the local clock.
    const knownTimes = [optOut.optedOutTimestamp, optOut.membershipUpdatedAt?.get(sourceListId)].filter((value): value is string => value !== undefined);
    const through = knownTimes.reduce<string | undefined>((latest, time) => latest === undefined || parseOptOutTimestampMicros(time)! > parseOptOutTimestampMicros(latest)! ? time : latest, undefined);
    evidence.onSourceUnsubscribed?.(optOut.subscriberId, sourceListId, through);
    continue;
   }
   if (status === undefined) continue;
   const key = `${optOut.subscriberId}:${sourceListId}`;
   const through = checkpoints.get(key);
   if (unknown.has(key) || (through === undefined && legacy.has(key))) {
    throw new Error("Shared-source settlement has no chronology; fresh consent was not overwritten and requires operator reconciliation");
   }
   if (through !== undefined) {
    const optOutTime = optOut.optedOutTimestamp === undefined ? undefined : parseOptOutTimestampMicros(optOut.optedOutTimestamp);
    if (optOutTime === undefined) throw new Error("Cannot reconcile shared-source opt-outs without parseable timestamps; fresh consent was not overwritten");
    if (optOutTime <= through) settledSourceListIds.add(sourceListId);
   }
  }
  return { ...optOut, settledSourceListIds };
 });
}

/**
 * Verify that the list exists and is readable, read its opt-outs, and
 * classify them. Never throws: a missing list and every failure are
 * returned as results. `sourceListIds` must already be normalized.
 */
async function classifyTemporaryListOptOuts(
	client: ListmonkClient,
	input: {
		listId: number;
		sourceListIds: readonly number[];
		settled: ReadonlySet<number>;
		pageSize?: number;
	} & SourceSettlementEvidence,
): Promise<TemporaryListOptOutClassification> {
	const { listId, sourceListIds, settled } = input;
	const readability = await probeListReadability(client, listId);
	if (readability.status === "not_found") {
		return { kind: "missing" };
	}
	if (readability.status === "unreadable") {
		return {
			kind: "failed",
			detail: `its opt-outs could not be verified because list ${listId} could not be read: ${readability.detail}`,
		};
	}
	let optOuts: TemporaryListOptOut[];
	try {
		optOuts = reconcileSourceSettlements(await readTemporaryListOptOuts(client, listId, {
			pageSize: input.pageSize,
		}), sourceListIds, { ...input, alreadySettled: input.settled });
	} catch (error) {
		return {
			kind: "failed",
			detail: `its opt-outs could not be read: ${describeError(error)}`,
		};
	}
	if (optOuts.length === 0) {
		return { kind: "no_opt_outs" };
	}
	const unsettled = optOuts.filter(
		(optOut) => !settled.has(optOut.subscriberId),
	);
	if (sourceListIds.length === 0) {
		return {
			kind: "blocked",
			optedOutCount: optOuts.length,
			unsettledCount: unsettled.length,
			detail: `${optOuts.length} subscriber(s) unsubscribed from it, but the test records no source lists to carry the opt-outs to; unsubscribe them from the lists they were drawn from, then remove them from list ${listId} and retry`,
		};
	}
	return {
		kind: "read",
		optOuts,
		unsettled,
		pending: unsettled.filter(
			(optOut) =>
				resolvePendingSourceListIds(optOut, sourceListIds).length > 0,
		),
	};
}

/** The source lists to carry to: positive, unique, and not the list itself. */
function resolveCarrySourceListIds(
	listId: number,
	sourceListIds: readonly number[],
): number[] {
	return normalizeListIds(sourceListIds).filter(
		(sourceListId) => sourceListId !== listId,
	);
}

/**
 * Carry the opt-outs recorded on one temporary list to the source lists and
 * report whether the list can now be deleted. Opt-outs listed in
 * `settledSubscriberIds` were carried by an earlier run; they are neither
 * written nor re-checked, so a person who re-subscribed to a source list
 * since then stays subscribed. Never throws: every failure is returned as a
 * `failed` or `blocked` result so the caller keeps the list. Repeating it
 * after a partial failure is safe.
 */
export async function propagateTemporaryListOptOuts(
	client: ListmonkClient,
	input: {
		listId: number;
		sourceListIds: readonly number[];
		settledSubscriberIds?: Iterable<number>;
		pageSize?: number;
		chunkSize?: number;
	} & SourceSettlementEvidence,
): Promise<TemporaryListOptOutPropagation> {
	const { listId } = input;
	const sourceListIds = resolveCarrySourceListIds(listId, input.sourceListIds);
	const settled = new Set(input.settledSubscriberIds ?? []);
	const classification = await classifyTemporaryListOptOuts(client, {
		listId,
		sourceListIds,
		settled,
		pageSize: input.pageSize,
		sourceSettlements: input.sourceSettlements,
		legacySourceSettlements: input.legacySourceSettlements,
		onSourceUnsubscribed: input.onSourceUnsubscribed,
	});
	switch (classification.kind) {
		case "missing":
			return {
				listId,
				status: "no_opt_outs",
				safeToDelete: true,
				listMissing: true,
				optedOutCount: 0,
				propagatedCount: 0,
				pendingCount: 0,
				settledSubscriberIds: [],
				sourceListIds,
			};
		case "failed":
			return {
				listId,
				status: "failed",
				safeToDelete: false,
				optedOutCount: 0,
				propagatedCount: 0,
				pendingCount: 0,
				settledSubscriberIds: [],
				sourceListIds,
				detail: classification.detail,
			};
		case "no_opt_outs":
			return {
				listId,
				status: "no_opt_outs",
				safeToDelete: true,
				optedOutCount: 0,
				propagatedCount: 0,
				pendingCount: 0,
				settledSubscriberIds: [],
				sourceListIds,
			};
		case "blocked":
			return {
				listId,
				status: "blocked",
				safeToDelete: false,
				optedOutCount: classification.optedOutCount,
				propagatedCount: 0,
				pendingCount: classification.unsettledCount,
				settledSubscriberIds: [],
				sourceListIds,
				detail: classification.detail,
			};
		case "read":
			break;
	}
	const { optOuts, unsettled, pending } = classification;
	const pendingIds = new Set(pending.map((optOut) => optOut.subscriberId));
	// Opt-outs with nothing left to carry are settled as read.
	const settledAsRead = unsettled
		.filter((optOut) => !pendingIds.has(optOut.subscriberId))
		.map((optOut) => optOut.subscriberId);
	if (pending.length === 0) {
		return {
			listId,
			status: "propagated",
			safeToDelete: true,
			optedOutCount: optOuts.length,
			propagatedCount: 0,
			pendingCount: 0,
			settledSubscriberIds: settledAsRead,
			sourceListIds,
		};
	}
	// Retain only read-confirmed chunk progress if a later chunk fails.
	// An acknowledgement alone is not proof: Listmonk can silently skip lists.
	const newlySettled = new Set(settledAsRead);
	let reread = optOuts;
	const carriedCount = () => pending.filter((optOut) =>
		newlySettled.has(optOut.subscriberId),
	).length;
	try {
		await unsubscribeOptOutsFromSourceLists(
			client,
			pending,
			sourceListIds,
			input.chunkSize,
			async (chunk) => {
				reread = reconcileSourceSettlements(await readTemporaryListOptOuts(client, listId, { pageSize: input.pageSize }), sourceListIds, { ...input, alreadySettled: { has: (id) => settled.has(id) || newlySettled.has(id) } });
				const chunkIds = new Set(chunk);
				for (const optOut of reread) {
					if (chunkIds.has(optOut.subscriberId) && resolvePendingSourceListIds(optOut, sourceListIds).length === 0) {
						newlySettled.add(optOut.subscriberId);
					}
				}
			},
		);
		// Settled opt-outs are not re-checked: a person who re-subscribed to
		// a source list after an earlier carry must not fail the confirmation.
		const confirmed = reread.filter(
			(optOut) => !settled.has(optOut.subscriberId) && !newlySettled.has(optOut.subscriberId),
		);
		const unconfirmed = new Set(
			findUnpropagatedOptOuts(confirmed, sourceListIds),
		);
		for (const optOut of confirmed) {
			if (!unconfirmed.has(optOut.subscriberId)) newlySettled.add(optOut.subscriberId);
		}
		const settledSubscriberIds = [...newlySettled];
		const propagatedCount = carriedCount();
		const optedOutCount = reread.length;
		if (unconfirmed.size > 0) {
			return {
				listId,
				status: "failed",
				safeToDelete: false,
				optedOutCount,
				propagatedCount,
				pendingCount: unconfirmed.size,
				settledSubscriberIds,
				sourceListIds,
				detail: `${unconfirmed.size} opted-out subscriber(s) are still subscribed to source lists ${sourceListIds.join(", ")} after the unsubscribe; check that the API user may manage those lists`,
			};
		}
		return {
			listId,
			status: "propagated",
			safeToDelete: true,
			optedOutCount,
			propagatedCount,
			pendingCount: 0,
			settledSubscriberIds,
			sourceListIds,
		};
	} catch (error) {
		const propagatedCount = carriedCount();
		const pendingCount = pending.length - propagatedCount;
		return {
			listId,
			status: "failed",
			safeToDelete: false,
			optedOutCount: reread.length,
			propagatedCount,
			pendingCount,
			settledSubscriberIds: [...newlySettled],
			sourceListIds,
			detail: `${pendingCount} opt-out(s) could not be carried to source lists ${sourceListIds.join(", ")}: ${describeError(error)}`,
		};
	}
}

/**
 * Report what {@link propagateTemporaryListOptOuts} would carry from one
 * temporary list without writing anything. Both classify the list with the
 * same read, so a dry run reports exactly what a real run would carry.
 */
export async function previewTemporaryListOptOuts(
	client: ListmonkClient,
	input: {
		listId: number;
		sourceListIds: readonly number[];
		settledSubscriberIds?: Iterable<number>;
		pageSize?: number;
	} & SourceSettlementEvidence,
): Promise<TemporaryListOptOutPreview> {
	const { listId } = input;
	const sourceListIds = resolveCarrySourceListIds(listId, input.sourceListIds);
	const classification = await classifyTemporaryListOptOuts(client, {
		listId,
		sourceListIds,
		settled: new Set(input.settledSubscriberIds ?? []),
		pageSize: input.pageSize,
		sourceSettlements: input.sourceSettlements,
		legacySourceSettlements: input.legacySourceSettlements,
		onSourceUnsubscribed: input.onSourceUnsubscribed,
	});
	switch (classification.kind) {
		case "missing":
			return {
				listId,
				status: "no_opt_outs",
				listMissing: true,
				optedOutCount: 0,
				pendingCount: 0,
				wouldSettleSubscriberIds: [],
				sourceListIds,
			};
		case "failed":
			return {
				listId,
				status: "failed",
				optedOutCount: 0,
				pendingCount: 0,
				wouldSettleSubscriberIds: [],
				sourceListIds,
				detail: classification.detail,
			};
		case "no_opt_outs":
			return {
				listId,
				status: "no_opt_outs",
				optedOutCount: 0,
				pendingCount: 0,
				wouldSettleSubscriberIds: [],
				sourceListIds,
			};
		case "blocked":
			return {
				listId,
				status: "blocked",
				optedOutCount: classification.optedOutCount,
				pendingCount: classification.unsettledCount,
				wouldSettleSubscriberIds: [],
				sourceListIds,
				detail: classification.detail,
			};
		case "read":
			return {
				listId,
				status: classification.pending.length === 0 ? "up_to_date" : "pending",
				optedOutCount: classification.optOuts.length,
				pendingCount: classification.pending.length,
				wouldSettleSubscriberIds: classification.unsettled.map(
					(optOut) => optOut.subscriberId,
				),
				sourceListIds,
			};
	}
}

/**
 * {@link propagateTemporaryListOptOuts} for several temporary lists, one
 * after another, in the given order. Opt-outs one list settles are skipped
 * on the later lists, so a subscriber opted out of several of them is
 * carried once.
 */
export async function propagateTemporaryListsOptOuts(
	client: ListmonkClient,
	input: {
		listIds: readonly number[];
		sourceListIds: readonly number[];
		settledSubscriberIds?: Iterable<number>;
	} & SourceSettlementEvidence,
): Promise<TemporaryListOptOutPropagation[]> {
	const sourceSettlements = [...(input.sourceSettlements ?? [])];
	const onSourceUnsubscribed: OptOutSourceConfirmed = (subscriberId, sourceListId, through) => {
		sourceSettlements.push({
			subscriberId,
			sourceListId,
			through: through ?? null,
		});
		input.onSourceUnsubscribed?.(subscriberId, sourceListId, through);
	};
	const settledSubscriberIds = new Set(input.settledSubscriberIds ?? []);
	const results: TemporaryListOptOutPropagation[] = [];
	for (const listId of input.listIds) {
		const propagation = await propagateTemporaryListOptOuts(client, {
			listId,
			sourceListIds: input.sourceListIds,
			settledSubscriberIds,
			sourceSettlements,
			legacySourceSettlements: input.legacySourceSettlements,
			onSourceUnsubscribed,
		});
		// One id at a time: a long-lived list can settle more ids than a
		// spread call accepts.
		for (const subscriberId of propagation.settledSubscriberIds) {
			settledSubscriberIds.add(subscriberId);
		}
		results.push(propagation);
	}
	return results;
}

/** Operator-facing reason a temporary list was kept. */
export function describeRetainedTemporaryList(
	result: TemporaryListOptOutPropagation,
): string {
	return `temporary list ${result.listId} kept to preserve its opt-outs: ${result.detail ?? "they were not confirmed on the source lists"}`;
}
