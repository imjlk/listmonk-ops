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
 * Note on `subscription_status`: the Listmonk v6.2.0 spike (see package
 * README) showed that programmatically added memberships land with
 * `subscription_status: "unconfirmed"` even on single-optin lists, so
 * filtering by `subscription_status=confirmed` would exclude every
 * bulk-added recipient. Eligibility here is therefore based on the
 * subscriber's top-level `status === "enabled"`, not the list-level
 * subscription status.
 */

export interface AudienceMember {
	/** Listmonk numeric subscriber id, used for bulk list membership mutations. */
	subscriberId: number;
	/** Stable UUID used for identity, dedupe, checksum, and deterministic assignment. */
	subscriberUuid: string;
}

export interface AudienceSnapshot {
	capturedAt: string;
	sourceListIds: number[];
	subscriberCount: number;
	subscriberChecksum: string;
	eligibilityPolicyVersion: 1;
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

/**
 * Default eligibility predicate. A subscriber is eligible when its top-level
 * status is "enabled". Blocklisted (`status: "blocklisted"`) and unsubscribed
 * (`status: "unsubscribed"`) subscribers are excluded.
 */
export function isEligibleSubscriber(subscriber: Subscriber): boolean {
	return subscriber.status === "enabled";
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
	const checksum = computeAudienceChecksum(members.map((m) => m.subscriberUuid));
	return {
		capturedAt,
		sourceListIds: [...sourceListIds].sort((a, b) => a - b),
		subscriberCount: members.length,
		subscriberChecksum: checksum,
		eligibilityPolicyVersion: 1,
	};
}

/**
 * Create an `AudienceResolver` backed by a Listmonk client.
 *
 * The resolver paginates each source list separately using the `list_id`
 * server filter, applies the `isEligibleSubscriber` predicate to each
 * returned record, validates id/uuid presence, deduplicates by UUID, and
 * caches the result so multiple consumers (preflight, sample-size,
 * assignment) share one resolution.
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
		const subscribers = response.results ?? [];
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

			const seen = new Map<string, number>();
			const collected: AudienceMember[] = [];

			for (const listId of dedupedListIds) {
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
						if (!isEligibleSubscriber(subscriber)) {
							continue;
						}
						assertUniqueUuid(seen, subscriber);
						const uuid = subscriber.uuid as string;
						if (!seen.has(uuid)) {
							seen.set(uuid, subscriber.id as number);
							collected.push({
								subscriberId: subscriber.id as number,
								subscriberUuid: uuid,
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
