import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest } from "../../src/types";

export type MembershipStatus = "unconfirmed" | "confirmed" | "unsubscribed";

export interface FakeListmonkOptions {
	/** An API user without permission on the list: Listmonk drops the filter. */
	ignoreListFilter?: boolean;
	/** Listmonk serves at most this many rows per page. */
	pageCap?: number;
	failOptOutRead?: boolean;
	failUnsubscribe?: boolean;
	/** Subscribers whose unsubscribe request fails (to model partial propagation). */
	failUnsubscribeSubscriberIds?: number[];
	/** Target lists the unsubscribe action silently skips (no manage permission). */
	unmanageableListIds?: number[];
	/**
	 * Serve memberships without `subscription_created_at` and
	 * `subscription_updated_at`, as a server that does not report them would.
	 */
	omitMembershipTimestamps?: boolean;
}

interface Membership {
	status: MembershipStatus;
	createdAt: number;
	updatedAt: number;
}

/** PostgreSQL `timestamptz` JSON, as Listmonk serves `subscription_*_at`. */
function toPostgresTimestamp(epochMilliseconds: number): string {
	return new Date(epochMilliseconds).toISOString().replace("Z", "000+00:00");
}

/**
 * In-memory Listmonk 6.2 slice: `subscriber_lists` rows with their
 * `created_at`/`updated_at`, the queries that write them (the campaign
 * unsubscribe link, the `manageLists` unsubscribe action, the public
 * subscription form's re-subscribe), and the list-deletion cascade that
 * erases memberships. Time only moves when a test advances the clock.
 */
export function createFakeListmonk(options: FakeListmonkOptions = {}) {
	let clock = Date.parse("2026-09-01T00:00:00.000Z");
	const lists = new Set<number>();
	const subscriberIds = new Set<number>();
	const memberships = new Map<number, Map<number, Membership>>();
	const campaigns = new Map<number, { status: string; lists: number[] }>();
	const reads: Array<Record<string, unknown>> = [];
	const listProbes: number[] = [];
	const unsubscribes: Array<{ ids: number[]; target_list_ids: number[] }> =
		[];
	const deletedLists: number[] = [];

	// Listmonk 6.2 answers a missing campaign with 400, not 404.
	const campaignNotFound = () => ({
		error: { message: "Campaign not found" },
		response: { status: 400 },
	});

	/** `DELETE /lists/{id}`: memberships cascade; campaign_lists go null. */
	const deleteList = (listId: number): boolean => {
		if (!lists.delete(listId)) {
			return false;
		}
		for (const subscriberLists of memberships.values()) {
			subscriberLists.delete(listId);
		}
		for (const campaign of campaigns.values()) {
			campaign.lists = campaign.lists.filter((id) => id !== listId);
		}
		deletedLists.push(listId);
		return true;
	};

	const client = {
		subscriber: {
			list: async ({ query }: { query: Record<string, unknown> }) => {
				reads.push({ ...query });
				if (options.failOptOutRead) {
					return {
						error: { message: "database unavailable" },
						response: { status: 500 },
					};
				}
				const listId = (query.list_id as number[] | undefined)?.[0];
				const status = query.subscription_status as string | undefined;
				const requested = Number(query.per_page);
				const perPage =
					options.pageCap === undefined
						? requested
						: Math.min(requested, options.pageCap);
				const page = Number(query.page);
				const matched = [...subscriberIds]
					.filter(
						(id) =>
							options.ignoreListFilter === true ||
							(listId !== undefined &&
								memberships.get(id)?.get(listId)?.status === status),
					)
					.sort((left, right) => right - left);
				const results = matched
					.slice((page - 1) * perPage, page * perPage)
					.map((id) => ({
						id,
						uuid: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
						email: `member${id}@example.com`,
						status: "enabled",
						lists: [...(memberships.get(id) ?? new Map()).entries()].map(
							([membershipListId, membership]: [number, Membership]) => ({
								id: membershipListId,
								subscription_status: membership.status,
								...(options.omitMembershipTimestamps
									? {}
									: {
											subscription_created_at: toPostgresTimestamp(
												membership.createdAt,
											),
											subscription_updated_at: toPostgresTimestamp(
												membership.updatedAt,
											),
										}),
								name: `List ${membershipListId}`,
							}),
						),
					}));
				return {
					data: { results, total: matched.length, page, per_page: perPage },
				};
			},
			manageLists: async ({
				body,
			}: {
				body: { action: string; ids: number[]; target_list_ids: number[] };
			}) => {
				unsubscribes.push({
					ids: [...body.ids],
					target_list_ids: [...body.target_list_ids],
				});
				if (
					options.failUnsubscribe ||
					body.ids.some((id) =>
						options.failUnsubscribeSubscriberIds?.includes(id),
					)
				) {
					return {
						error: { message: "permission denied" },
						response: { status: 403 },
					};
				}
				if (body.action !== "unsubscribe") {
					throw new Error(`unexpected manageLists action ${body.action}`);
				}
				// Listmonk's unsubscribe-subscribers-from-lists query updates
				// existing memberships only, stamping updated_at.
				for (const id of body.ids) {
					for (const targetListId of body.target_list_ids) {
						if (options.unmanageableListIds?.includes(targetListId)) {
							continue;
						}
						const membership = memberships.get(id)?.get(targetListId);
						if (membership !== undefined) {
							membership.status = "unsubscribed";
							membership.updatedAt = clock;
						}
					}
				}
				return { data: true };
			},
		},
		list: {
			getById: async ({ path }: { path: { list_id: number } }) => {
				listProbes.push(path.list_id);
				const hasMembership = [...memberships.values()].some((subscriberLists) =>
					subscriberLists.has(path.list_id),
				);
				if (!lists.has(path.list_id) && !hasMembership) {
					return {
						error: { message: "List not found" },
						response: { status: 400 },
					};
				}
				return { data: { id: path.list_id, name: `List ${path.list_id}` } };
			},
			delete: async ({ path }: { path: { list_id: number } }) => {
				// Listmonk 6.2 acknowledges deleting a missing list.
				deleteList(path.list_id);
				return { data: true };
			},
		},
		campaign: {
			getById: async ({ path }: { path: { id: number } }) => {
				const campaign = campaigns.get(path.id);
				return campaign === undefined
					? campaignNotFound()
					: { data: { id: path.id, status: campaign.status } };
			},
			updateStatus: async ({
				path,
				body,
			}: {
				path: { id: number };
				body: { status: string };
			}) => {
				const campaign = campaigns.get(path.id);
				if (campaign === undefined) {
					return campaignNotFound();
				}
				campaign.status = body.status;
				return { data: true };
			},
			delete: async ({ path }: { path: { id: number } }) =>
				campaigns.delete(path.id) ? { data: true } : campaignNotFound(),
			update: async () => ({ data: true }),
		},
	} as unknown as ListmonkClient;
	client.subscriber.listRaw = async (options) =>
		client.subscriber.list(options);

	return {
		client,
		options,
		reads,
		listProbes,
		unsubscribes,
		deletedLists,
		/** Let time pass; later writes are stamped with the new time. */
		advanceClock(milliseconds: number) {
			clock += milliseconds;
		},
		addLists(...ids: number[]) {
			for (const id of ids) {
				lists.add(id);
			}
		},
		addSubscriber(id: number, listStatuses: Record<number, MembershipStatus>) {
			subscriberIds.add(id);
			memberships.set(
				id,
				new Map(
					Object.entries(listStatuses).map(([listId, status]) => [
						Number(listId),
						{ status, createdAt: clock, updatedAt: clock },
					]),
				),
			);
		},
		addCampaign(id: number, status: string, campaignLists: number[]) {
			campaigns.set(id, { status, lists: [...campaignLists] });
		},
		/** Listmonk deleted the campaign outside this package. */
		removeCampaign(id: number) {
			campaigns.delete(id);
		},
		/** An operator deleted the list in Listmonk. */
		removeList(id: number) {
			deleteList(id);
		},
		/**
		 * The public unsubscribe link (`unsubscribe-by-campaign`): only the
		 * campaign's own lists are marked unsubscribed, and only memberships
		 * that are not already unsubscribed get a new `updated_at`.
		 */
		unsubscribeViaCampaign(campaignId: number, subscriberId: number) {
			const campaign = campaigns.get(campaignId);
			const subscriberLists = memberships.get(subscriberId);
			for (const listId of campaign?.lists ?? []) {
				const membership = subscriberLists?.get(listId);
				if (membership !== undefined && membership.status !== "unsubscribed") {
					membership.status = "unsubscribed";
					membership.updatedAt = clock;
				}
			}
		},
		/**
		 * The public subscription form for an existing subscriber
		 * (`update-subscriber-with-lists` with re-subscribe allowed): an
		 * unsubscribed membership becomes `unconfirmed` without a new
		 * `updated_at`; a missing one is created now.
		 */
		resubscribeViaForm(subscriberId: number, listId: number) {
			subscriberIds.add(subscriberId);
			const subscriberLists =
				memberships.get(subscriberId) ?? new Map<number, Membership>();
			memberships.set(subscriberId, subscriberLists);
			const membership = subscriberLists.get(listId);
			if (membership === undefined) {
				subscriberLists.set(listId, {
					status: "unconfirmed",
					createdAt: clock,
					updatedAt: clock,
				});
			} else if (membership.status !== "confirmed") {
				membership.status = "unconfirmed";
			}
		},
		membership(subscriberId: number, listId: number) {
			return memberships.get(subscriberId)?.get(listId)?.status;
		},
		hasList(id: number) {
			return lists.has(id);
		},
	};
}

export type FakeListmonk = ReturnType<typeof createFakeListmonk>;

export const SOURCE_A = 1;
export const SOURCE_B = 2;

export function makeTest(overrides: Partial<AbTest> = {}): AbTest {
	const now = new Date("2026-09-01T00:00:00.000Z");
	return {
		id: "test_optout",
		name: "Opt-out propagation",
		campaignId: "campaign-1",
		variants: [
			{ id: "variant-a", name: "A", percentage: 50, contentOverrides: {} },
			{ id: "variant-b", name: "B", percentage: 50, contentOverrides: {} },
		],
		metrics: [],
		status: "running",
		createdAt: now,
		updatedAt: now,
		baseConfig: {
			subject: "Subject",
			body: "Body",
			lists: [SOURCE_A, SOURCE_B],
		},
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 4,
		holdoutGroupSize: 36,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [
			{ variantId: "variant-a", campaignId: 100 },
			{ variantId: "variant-b", campaignId: 101 },
		],
		testListMappings: [
			{ variantId: "variant-a", listId: 200 },
			{ variantId: "variant-b", listId: 201 },
		],
		holdoutListId: 202,
		...overrides,
	};
}

/**
 * Source lists 1 and 2; variant lists 200 and 201 behind campaigns 100 and
 * 101; holdout list 202 behind winner campaign 300.
 */
export function seedAbTestAudience(
	fake: FakeListmonk,
	campaignStatus = "finished",
) {
	fake.addLists(SOURCE_A, SOURCE_B, 200, 201, 202);
	fake.addCampaign(100, campaignStatus, [200]);
	fake.addCampaign(101, campaignStatus, [201]);
	fake.addCampaign(300, campaignStatus, [202]);
	// Opts out of variant A: a member of both source lists.
	fake.addSubscriber(11, {
		[SOURCE_A]: "confirmed",
		[SOURCE_B]: "confirmed",
		200: "unconfirmed",
	});
	// Stays subscribed.
	fake.addSubscriber(12, { [SOURCE_A]: "unconfirmed", 201: "unconfirmed" });
	// Opts out of variant B: a member of source list 1 only.
	fake.addSubscriber(14, { [SOURCE_A]: "confirmed", 201: "unconfirmed" });
	// Opts out of the winner email sent to the holdout.
	fake.addSubscriber(13, { [SOURCE_B]: "confirmed", 202: "unconfirmed" });
}
