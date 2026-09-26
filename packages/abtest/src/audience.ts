import { createHash } from "node:crypto";
import type { ListmonkClient, Subscriber } from "@listmonk-ops/openapi";

/**
 * Audience resolver for A/B test provisioning.
 *
 * The previous implementation fetched every subscriber with
 * `per_page: "all"` and filtered client-side, summed per-list
 * `subscriber_count` (double-counting subscribers in multiple lists), and let
 * subscribers with an empty `lists` array slip past the target-list filter.
 *
 * This module resolves the eligible audience for a set of source lists by
 * paginating each list server-side, deduplicating by UUID, validating that
 * every retained subscriber has both a numeric id and a UUID (fail-closed
 * otherwise), and computing a deterministic SHA-256 checksum over the sorted
 * UUIDs so preflight, sample-size recommendation, and the actual assignment
 * all see the same audience.
 *
 * Eligibility (policy version 2) mirrors Listmonk's own regular-campaign
 * delivery rule (`next-campaign-subscribers`). It has to: variant and holdout
 * members are copied onto temporary single opt-in lists, where Listmonk can
 * no longer see the consent recorded on the source list. A subscriber is
 * eligible only when
 *   - its top-level `status` is `enabled` (stricter than Listmonk, which only
 *     skips `blocklisted`), and
 *   - its membership in the source list being paged permits delivery: never
 *     `unsubscribed`; only `confirmed` on a double opt-in list; `unconfirmed`
 *     or `confirmed` on a single opt-in list.
 * A subscriber in several source lists is eligible when any of those source
 * memberships permits delivery.
 *
 * Note on `subscription_status`: the Listmonk v6.2.0 spike (see package
 * README) showed that programmatically added memberships land with
 * `subscription_status: "unconfirmed"` even on single-optin lists, so
 * filtering server-side by `subscription_status=confirmed` would exclude
 * every bulk-added recipient. The resolver therefore pages every member and
 * evaluates each membership from the `lists[]` array Listmonk embeds in every
 * `/subscribers` result, keeping single opt-in `unconfirmed` members.
 *
 * Fail-closed behavior: each source list's opt-in mode is read once from
 * `GET /lists/{id}` before paging. That read also proves list-read
 * permission: Listmonk silently drops `list_id` filters the token cannot
 * read (a token with `subscribers:get_all` then receives every subscriber),
 * so an unreadable list or an unknown opt-in mode aborts the resolution. An
 * enabled subscriber whose payload does not carry exactly one recognizable
 * membership for the paged list also aborts it with an
 * `AudienceResolutionError` instead of being silently dropped: resolution
 * runs before any Listmonk mutation, so the error is side-effect free and
 * retryable, while quietly shrinking the audience would hide a response that
 * no longer matches the query or a drifted payload shape.
 */

export interface AudienceMember {
	/** Listmonk numeric subscriber id, used for bulk list membership mutations. */
	subscriberId: number;
	/** Stable UUID used for identity, dedupe, checksum, and deterministic assignment. */
	subscriberUuid: string;
	/** Subscriber email, used for recipient-domain stratification. Optional
	 * because legacy resolvers and test fixtures may not populate it. */
	email?: string;
}

/**
 * Eligibility policy versions a persisted audience snapshot may carry.
 *   1 — legacy: top-level `status === "enabled"` only; per-list
 *       unsubscribes and double opt-in confirmation were ignored. Snapshots
 *       persisted by earlier releases keep this value and still load.
 *   2 — enabled subscriber with a source-list membership that permits
 *       delivery (see the module comment).
 */
export const AUDIENCE_ELIGIBILITY_POLICY_VERSIONS = [1, 2] as const;

export type AudienceEligibilityPolicyVersion =
	(typeof AUDIENCE_ELIGIBILITY_POLICY_VERSIONS)[number];

/** Policy applied by `createListmonkAudienceResolver`. */
export const CURRENT_AUDIENCE_ELIGIBILITY_POLICY_VERSION = 2;

export function isAudienceEligibilityPolicyVersion(
	value: unknown,
): value is AudienceEligibilityPolicyVersion {
	return AUDIENCE_ELIGIBILITY_POLICY_VERSIONS.some(
		(version) => version === value,
	);
}

export interface AudienceSnapshot {
	capturedAt: string;
	sourceListIds: number[];
	subscriberCount: number;
	subscriberChecksum: string;
	eligibilityPolicyVersion: AudienceEligibilityPolicyVersion;
}

export interface AudienceResolverOptions {
	/**
	 * Page size for the paginated `/subscribers` calls. Defaults to 500, which
	 * matches Listmonk's typical comfortable page size for filtered queries.
	 */
	pageSize?: number;
}

export class AudienceResolutionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AudienceResolutionError";
	}
}

export interface AudienceResolver {
	resolve(sourceListIds: number[]): Promise<AudienceSnapshot>;
	/** Returns the resolved audience members. Resolve must be called first. */
	members(): readonly AudienceMember[];
}

/** Opt-in mode of a Listmonk list. */
export type ListOptInMode = "single" | "double";

/** Status of one subscriber-to-list membership (`subscriber_lists.status`). */
export type ListSubscriptionStatus = "unconfirmed" | "confirmed" | "unsubscribed";

/** The source list a subscriber was returned for, with its opt-in mode. */
export interface AudienceSourceList {
	listId: number;
	optIn: ListOptInMode;
}

/**
 * Outcome of evaluating one subscriber against one source list.
 * `undetermined` means the payload does not carry a recognizable membership
 * for that list, so consent cannot be verified.
 */
export type SubscriberEligibility = "eligible" | "ineligible" | "undetermined";

/**
 * Whether a membership permits delivery under Listmonk's regular-campaign
 * rule: never after an unsubscribe, only `confirmed` on double opt-in lists,
 * and `unconfirmed` or `confirmed` on single opt-in lists.
 */
export function membershipPermitsDelivery(
	subscriptionStatus: ListSubscriptionStatus,
	optIn: ListOptInMode,
): boolean {
	if (subscriptionStatus === "confirmed") {
		return true;
	}
	if (subscriptionStatus === "unconfirmed") {
		return optIn === "single";
	}
	return false;
}

function isListSubscriptionStatus(
	value: unknown,
): value is ListSubscriptionStatus {
	return (
		value === "unconfirmed" || value === "confirmed" || value === "unsubscribed"
	);
}

/**
 * Read the subscriber's membership status for `listId` from the `lists[]`
 * array Listmonk embeds in every `/subscribers` result. Returns undefined
 * unless there is exactly one entry for the list with a known status.
 */
export function findListSubscriptionStatus(
	subscriber: Subscriber,
	listId: number,
): ListSubscriptionStatus | undefined {
	const lists: unknown = subscriber.lists;
	if (!Array.isArray(lists)) {
		return undefined;
	}
	const entries = lists.filter(
		(entry: unknown) =>
			typeof entry === "object" &&
			entry !== null &&
			(entry as { id?: unknown }).id === listId,
	) as { subscription_status?: unknown }[];
	const [entry] = entries;
	if (entries.length !== 1 || entry === undefined) {
		return undefined;
	}
	return isListSubscriptionStatus(entry.subscription_status)
		? entry.subscription_status
		: undefined;
}

/**
 * Default eligibility predicate (policy version 2) for a subscriber returned
 * while paging `source`. Non-enabled subscribers (disabled, blocklisted) are
 * ineligible without inspecting their memberships; an enabled subscriber is
 * eligible only when its membership in the source list permits delivery.
 */
export function evaluateSubscriberEligibility(
	subscriber: Subscriber,
	source: AudienceSourceList,
): SubscriberEligibility {
	if (subscriber.status !== "enabled") {
		return "ineligible";
	}
	const subscriptionStatus = findListSubscriptionStatus(
		subscriber,
		source.listId,
	);
	if (subscriptionStatus === undefined) {
		return "undetermined";
	}
	return membershipPermitsDelivery(subscriptionStatus, source.optIn)
		? "eligible"
		: "ineligible";
}

function describeResponseError(error: unknown): string {
	if (typeof error === "object" && error !== null && "message" in error) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") {
			return message;
		}
	}
	return typeof error === "string" ? error : JSON.stringify(error);
}

export function computeAudienceChecksum(uuids: readonly string[]): string {
	const sorted = [...uuids].sort();
	const stream = sorted.join("\n");
	return createHash("sha256").update(stream, "utf8").digest("hex");
}

/**
 * Build an `AudienceSnapshot` from already-resolved members. Exposed so the
 * deterministic provisioning layer (and its tests) can construct snapshots
 * without a live Listmonk client.
 */
export function buildAudienceSnapshot(
	sourceListIds: number[],
	members: readonly AudienceMember[],
	capturedAt: string = new Date().toISOString(),
): AudienceSnapshot {
	const checksum = computeAudienceChecksum(
		members.map((m) => m.subscriberUuid),
	);
	return {
		capturedAt,
		sourceListIds: [...sourceListIds].sort((a, b) => a - b),
		subscriberCount: members.length,
		subscriberChecksum: checksum,
		eligibilityPolicyVersion: CURRENT_AUDIENCE_ELIGIBILITY_POLICY_VERSION,
	};
}

/**
 * Create an `AudienceResolver` backed by a Listmonk client.
 *
 * The resolver reads each source list's opt-in mode once, paginates each
 * source list separately using the `list_id` server filter, applies
 * `evaluateSubscriberEligibility` to each returned record, validates id/uuid
 * presence, deduplicates by UUID, and caches the result so multiple
 * consumers (preflight, sample-size, assignment) share one resolution.
 */
export function createListmonkAudienceResolver(
	client: ListmonkClient,
	options: AudienceResolverOptions = {},
): AudienceResolver {
	const pageSize = options.pageSize ?? 500;
	let cached: { snapshot: AudienceSnapshot; members: AudienceMember[] } | null =
		null;

	function assertUniqueUuid(
		seen: Map<string, number>,
		idToUuid: Map<number, string>,
		subscriber: Subscriber,
	): void {
		const uuid = subscriber.uuid;
		const id = subscriber.id;
		// Guard against undefined, null, and empty-string identities. An empty
		// uuid would otherwise collide on the "" key and silently dedupe
		// distinct subscribers.
		if (
			uuid === undefined ||
			uuid === null ||
			uuid === "" ||
			id === undefined ||
			id === null
		) {
			throw new AudienceResolutionError(
				`subscriber is missing id or uuid; id=${JSON.stringify(
					id,
				)} uuid=${JSON.stringify(uuid)}`,
			);
		}
		const previousId = seen.get(uuid);
		if (previousId !== undefined && previousId !== id) {
			throw new AudienceResolutionError(
				`subscriber uuid ${uuid} maps to two numeric ids: ${previousId} and ${id}`,
			);
		}
		// Reverse guard: the same numeric id must always map to the same uuid.
		// Schema drift or an inconsistent page read could otherwise surface one
		// subscriber under two uuid keys, and segmentation would add the same
		// numeric id to multiple variant/holdout lists.
		const previousUuid = idToUuid.get(id);
		if (previousUuid !== undefined && previousUuid !== uuid) {
			throw new AudienceResolutionError(
				`subscriber id ${id} maps to two uuids: ${previousUuid} and ${uuid}`,
			);
		}
	}

	/**
	 * Read the source list's opt-in mode from the list record. The mode is
	 * never inferred from subscriber payloads, and any failure aborts the
	 * resolution (see the module comment).
	 */
	async function resolveSourceList(
		listId: number,
	): Promise<AudienceSourceList> {
		const response = await client.list.getById({ path: { list_id: listId } });
		if ("error" in response && response.error !== undefined) {
			throw new AudienceResolutionError(
				`source list ${listId} could not be read to verify its opt-in mode: ${describeResponseError(
					response.error,
				)}`,
			);
		}
		const list = "data" in response ? response.data : undefined;
		const optIn = list?.optin;
		if (list?.id !== listId || (optIn !== "single" && optIn !== "double")) {
			throw new AudienceResolutionError(
				`source list ${listId} did not report a known opt-in mode (optin=${JSON.stringify(
					optIn,
				)}); cannot verify subscriber consent`,
			);
		}
		return { listId, optIn };
	}

	async function resolvePage(
		listId: number,
		page: number,
	): Promise<{ subscribers: Subscriber[] }> {
		const response = await client.subscriber.list({
			query: {
				list_id: [listId],
				page,
				per_page: pageSize,
			},
		});
		if ("error" in response && response.error !== undefined) {
			throw new AudienceResolutionError(
				`list ${listId} page ${page} query failed: ${String(response.error)}`,
			);
		}
		const subscribers = response.data?.results ?? [];
		return { subscribers };
	}

	return {
		async resolve(sourceListIds: number[]): Promise<AudienceSnapshot> {
			const dedupedListIds = [...new Set(sourceListIds)]
				.filter((id): id is number => Number.isInteger(id) && id > 0)
				.sort((a, b) => a - b);

			if (dedupedListIds.length === 0) {
				throw new AudienceResolutionError(
					"sourceListIds must contain at least one positive integer",
				);
			}

			// Read every opt-in mode before paging so an unreadable list
			// aborts the resolution before any subscriber page is fetched.
			const sourceLists: AudienceSourceList[] = [];
			for (const listId of dedupedListIds) {
				sourceLists.push(await resolveSourceList(listId));
			}

			const seen = new Map<string, number>();
			const idToUuid = new Map<number, string>();
			const collected: AudienceMember[] = [];

			for (const source of sourceLists) {
				const listId = source.listId;
				let page = 1;
				let emptyPages = 0;
				// Guard against a server that never terminates: stop after a
				// reasonable upper bound derived from the reported total.
				const maxPages = 10_000;
				while (page <= maxPages) {
					const { subscribers } = await resolvePage(listId, page);
					if (subscribers.length === 0) {
						// Some Listmonk deployments return an intermittent empty
						// page before the final page; tolerate a single empty
						// page, then stop after two consecutive empties. Crucially,
						// advance the page and continue so an empty page does not
						// hit the `subscribers.length < pageSize` break below and
						// silently truncate the audience.
						emptyPages += 1;
						if (emptyPages >= 2) {
							break;
						}
						page += 1;
						continue;
					}
					emptyPages = 0;
					for (const subscriber of subscribers) {
						const eligibility = evaluateSubscriberEligibility(
							subscriber,
							source,
						);
						if (eligibility === "undetermined") {
							throw new AudienceResolutionError(
								`subscriber id=${JSON.stringify(
									subscriber.id,
								)} was returned for source list ${listId} without exactly one recognizable membership for that list; cannot verify consent`,
							);
						}
						// Unsubscribed, unconfirmed double opt-in, disabled, and
						// blocklisted members are skipped here; a subscriber in
						// several source lists can still qualify through another
						// list's page.
						if (eligibility === "ineligible") {
							continue;
						}
						assertUniqueUuid(seen, idToUuid, subscriber);
						const uuid = subscriber.uuid as string;
						const numericId = subscriber.id as number;
						if (!seen.has(uuid)) {
							seen.set(uuid, numericId);
							idToUuid.set(numericId, uuid);
							collected.push({
								subscriberId: numericId,
								subscriberUuid: uuid,
								email: subscriber.email,
							});
						}
					}
					if (subscribers.length < pageSize) {
						break;
					}
					page += 1;
				}
			}

			const snapshot = buildAudienceSnapshot(dedupedListIds, collected);
			cached = { snapshot, members: collected };
			return snapshot;
		},
		members(): readonly AudienceMember[] {
			if (!cached) {
				throw new AudienceResolutionError(
					"resolve() must be called before members()",
				);
			}
			return cached.members;
		},
	};
}
