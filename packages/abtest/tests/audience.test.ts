import { describe, expect, it, mock } from "bun:test";
import type { ListmonkClient, Subscriber } from "@listmonk-ops/openapi";
import {
	buildAudienceSnapshot,
	computeAudienceChecksum,
	createListmonkAudienceResolver,
	AudienceResolutionError,
	CURRENT_AUDIENCE_ELIGIBILITY_POLICY_VERSION,
	evaluateSubscriberEligibility,
	findListSubscriptionStatus,
	isAudienceEligibilityPolicyVersion,
	membershipPermitsDelivery,
	type AudienceMember,
	type ListOptInMode,
	type ListSubscriptionStatus,
} from "../src/audience";

interface MockListQuery {
	page: number;
	per_page: number;
	list_id?: number[];
}

interface MockListOptions {
	query?: MockListQuery;
}

interface MockGetListOptions {
	path: { list_id: number };
}

/**
 * Build a subscriber shaped like a Listmonk v6.2 `GET /subscribers` result:
 * the top-level `status` is `enabled`, `disabled`, or `blocklisted`, and each
 * list membership is an entry in `lists[]` carrying its own
 * `subscription_status`. Listmonk also embeds the list record's own fields in
 * each entry — including the list's `status` ("active"), which must never be
 * confused with the membership status.
 */
function makeSubscriber(
	id: number,
	uuid: string,
	status: "enabled" | "disabled" | "blocklisted",
	memberships: Record<number, ListSubscriptionStatus> = {},
): Subscriber {
	return {
		id,
		uuid,
		email: `sub-${id}@test`,
		name: `Sub ${id}`,
		status,
		lists: Object.entries(memberships).map(([listId, subscriptionStatus]) => ({
			id: Number(listId),
			subscription_status: subscriptionStatus,
			name: `List ${listId}`,
			type: "private",
			status: "active",
		})),
	};
}

function mockListResponse(results: Subscriber[], total: number) {
	return {
		data: {
			results,
			total,
			per_page: results.length,
			page: 1,
		},
	};
}

/**
 * `list.getById` fake. Every list is single opt-in unless `optInByList`
 * says otherwise; a value of `undefined` in the map omits the field.
 */
function makeListReader(optInByList: Record<number, unknown> = {}) {
	return mock(async (options: MockGetListOptions) => {
		const listId = options.path.list_id;
		const optin = listId in optInByList ? optInByList[listId] : "single";
		return {
			data: {
				id: listId,
				name: `List ${listId}`,
				type: "private",
				status: "active",
				...(optin === undefined ? {} : { optin }),
			},
		};
	});
}

/**
 * Build a ListmonkClient fake whose subscriber.list paginates the supplied
 * per-list subscriber sets. `subscribersByList` maps listId -> array of
 * subscribers returned for that list (page 1).
 */
function makeClient(
	subscribersByList: Record<number, Subscriber[]>,
	optInByList: Record<number, unknown> = {},
): ListmonkClient {
	return makeInstrumentedClient(subscribersByList, optInByList).client;
}

function makeInstrumentedClient(
	subscribersByList: Record<number, Subscriber[]>,
	optInByList: Record<number, unknown> = {},
) {
	const subscriberList = mock((options: MockListOptions) => {
		const query: Partial<MockListQuery> = options.query ?? {};
		const listId = query.list_id?.[0] ?? 0;
		const all = subscribersByList[listId] ?? [];
		const perPage = query.per_page ?? 500;
		const start = ((query.page ?? 1) - 1) * perPage;
		const slice = all.slice(start, start + perPage);
		return mockListResponse(slice, all.length);
	});
	const getById = makeListReader(optInByList);
	const client = {
		subscriber: { list: subscriberList },
		list: { getById },
	} as unknown as ListmonkClient;
	return { client, subscriberList, getById };
}

async function resolveUuids(
	client: ListmonkClient,
	listIds: number[],
): Promise<string[]> {
	const resolver = createListmonkAudienceResolver(client);
	await resolver.resolve(listIds);
	return resolver
		.members()
		.map((member) => member.subscriberUuid)
		.sort();
}

describe("membershipPermitsDelivery", () => {
	const cases: [ListSubscriptionStatus, ListOptInMode, boolean][] = [
		["unconfirmed", "single", true],
		["confirmed", "single", true],
		["unsubscribed", "single", false],
		["unconfirmed", "double", false],
		["confirmed", "double", true],
		["unsubscribed", "double", false],
	];
	for (const [status, optIn, expected] of cases) {
		it(`${status} on a ${optIn} opt-in list -> ${expected}`, () => {
			expect(membershipPermitsDelivery(status, optIn)).toBe(expected);
		});
	}
});

describe("findListSubscriptionStatus", () => {
	it("reads the membership of the requested list, not the list status", () => {
		const subscriber = makeSubscriber(1, "u1", "enabled", {
			10: "unsubscribed",
			11: "confirmed",
		});
		expect(findListSubscriptionStatus(subscriber, 10)).toBe("unsubscribed");
		expect(findListSubscriptionStatus(subscriber, 11)).toBe("confirmed");
	});

	it("returns undefined for a missing, duplicated, or unknown membership", () => {
		expect(
			findListSubscriptionStatus(makeSubscriber(1, "u1", "enabled"), 10),
		).toBeUndefined();
		expect(
			findListSubscriptionStatus(
				{ id: 1, uuid: "u1", status: "enabled" },
				10,
			),
		).toBeUndefined();
		const duplicated = makeSubscriber(1, "u1", "enabled", { 10: "confirmed" });
		duplicated.lists = [...(duplicated.lists ?? []), ...(duplicated.lists ?? [])];
		expect(findListSubscriptionStatus(duplicated, 10)).toBeUndefined();
		const unknown = makeSubscriber(1, "u1", "enabled", { 10: "confirmed" });
		unknown.lists = [{ id: 10, subscription_status: "pending" }];
		expect(findListSubscriptionStatus(unknown, 10)).toBeUndefined();
		const missingStatus = makeSubscriber(1, "u1", "enabled");
		missingStatus.lists = [{ id: 10 }];
		expect(findListSubscriptionStatus(missingStatus, 10)).toBeUndefined();
	});
});

describe("evaluateSubscriberEligibility", () => {
	const single = { listId: 10, optIn: "single" } as const;
	const double = { listId: 10, optIn: "double" } as const;

	it("accepts enabled single opt-in members that are unconfirmed or confirmed", () => {
		for (const status of ["unconfirmed", "confirmed"] as const) {
			expect(
				evaluateSubscriberEligibility(
					makeSubscriber(1, "u1", "enabled", { 10: status }),
					single,
				),
			).toBe("eligible");
		}
	});

	it("rejects members who unsubscribed from the source list", () => {
		for (const source of [single, double]) {
			expect(
				evaluateSubscriberEligibility(
					makeSubscriber(1, "u1", "enabled", { 10: "unsubscribed" }),
					source,
				),
			).toBe("ineligible");
		}
	});

	it("requires a confirmed membership on double opt-in lists", () => {
		expect(
			evaluateSubscriberEligibility(
				makeSubscriber(1, "u1", "enabled", { 10: "unconfirmed" }),
				double,
			),
		).toBe("ineligible");
		expect(
			evaluateSubscriberEligibility(
				makeSubscriber(1, "u1", "enabled", { 10: "confirmed" }),
				double,
			),
		).toBe("eligible");
	});

	it("rejects disabled and blocklisted subscribers even with a confirmed membership", () => {
		for (const status of ["disabled", "blocklisted"] as const) {
			expect(
				evaluateSubscriberEligibility(
					makeSubscriber(1, "u1", status, { 10: "confirmed" }),
					single,
				),
			).toBe("ineligible");
		}
	});

	it("reports an enabled subscriber without a membership as undetermined", () => {
		expect(
			evaluateSubscriberEligibility(
				makeSubscriber(1, "u1", "enabled", { 11: "confirmed" }),
				single,
			),
		).toBe("undetermined");
	});
});

describe("computeAudienceChecksum", () => {
	it("is independent of input ordering", () => {
		const a = computeAudienceChecksum(["u1", "u2", "u3"]);
		const b = computeAudienceChecksum(["u3", "u1", "u2"]);
		expect(a).toBe(b);
	});
	it("differs for different sets", () => {
		expect(computeAudienceChecksum(["u1", "u2"])).not.toBe(
			computeAudienceChecksum(["u1", "u3"]),
		);
	});
});

describe("buildAudienceSnapshot", () => {
	it("sorts sourceListIds and computes a stable checksum", () => {
		const members: AudienceMember[] = [
			{ subscriberId: 2, subscriberUuid: "u2" },
			{ subscriberId: 1, subscriberUuid: "u1" },
		];
		const snap = buildAudienceSnapshot([3, 1, 2], members);
		expect(snap.sourceListIds).toEqual([1, 2, 3]);
		expect(snap.subscriberCount).toBe(2);
		expect(snap.subscriberChecksum).toBe(computeAudienceChecksum(["u1", "u2"]));
		expect(snap.eligibilityPolicyVersion).toBe(2);
		expect(CURRENT_AUDIENCE_ELIGIBILITY_POLICY_VERSION).toBe(2);
	});

	it("recognizes the legacy and current eligibility policy versions only", () => {
		expect(isAudienceEligibilityPolicyVersion(1)).toBe(true);
		expect(isAudienceEligibilityPolicyVersion(2)).toBe(true);
		expect(isAudienceEligibilityPolicyVersion(3)).toBe(false);
		expect(isAudienceEligibilityPolicyVersion("2")).toBe(false);
		expect(isAudienceEligibilityPolicyVersion(undefined)).toBe(false);
	});
});

describe("createListmonkAudienceResolver", () => {
	it("dedupes subscribers that appear in multiple source lists", async () => {
		// subscriber 1 is in both list 10 and list 11
		const shared = makeSubscriber(1, "uuid-1", "enabled", {
			10: "unconfirmed",
			11: "unconfirmed",
		});
		const only10 = makeSubscriber(2, "uuid-2", "enabled", { 10: "unconfirmed" });
		const only11 = makeSubscriber(3, "uuid-3", "enabled", { 11: "unconfirmed" });
		const client = makeClient({
			10: [shared, only10],
			11: [shared, only11],
		});
		const resolver = createListmonkAudienceResolver(client);
		const snapshot = await resolver.resolve([10, 11]);
		expect(snapshot.subscriberCount).toBe(3);
		expect(snapshot.subscriberChecksum).toBe(
			computeAudienceChecksum(["uuid-1", "uuid-2", "uuid-3"]),
		);
		expect(snapshot.eligibilityPolicyVersion).toBe(2);
		const members = resolver.members();
		expect(members.map((m) => m.subscriberId).sort((a, b) => a - b)).toEqual([
			1, 2, 3,
		]);
	});

	it("excludes members who unsubscribed from the source list", async () => {
		// Clicking "unsubscribe" leaves the subscriber globally enabled and
		// flips only the list membership to "unsubscribed".
		const client = makeClient({
			10: [
				makeSubscriber(1, "u1", "enabled", { 10: "confirmed" }),
				makeSubscriber(2, "u2", "enabled", { 10: "unsubscribed" }),
			],
		});
		const resolver = createListmonkAudienceResolver(client);
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(1);
		expect(snapshot.subscriberChecksum).toBe(computeAudienceChecksum(["u1"]));
		expect(resolver.members().map((m) => m.subscriberId)).toEqual([1]);
	});

	it("keeps unconfirmed and confirmed members of single opt-in lists", async () => {
		// Programmatic adds land as "unconfirmed" even on single opt-in
		// lists, so unconfirmed single opt-in members stay deliverable.
		const client = makeClient(
			{
				10: [
					makeSubscriber(1, "u1", "enabled", { 10: "unconfirmed" }),
					makeSubscriber(2, "u2", "enabled", { 10: "confirmed" }),
				],
			},
			{ 10: "single" },
		);
		expect(await resolveUuids(client, [10])).toEqual(["u1", "u2"]);
	});

	it("keeps only confirmed members of double opt-in lists", async () => {
		const client = makeClient(
			{
				20: [
					makeSubscriber(1, "u1", "enabled", { 20: "unconfirmed" }),
					makeSubscriber(2, "u2", "enabled", { 20: "confirmed" }),
					makeSubscriber(3, "u3", "enabled", { 20: "unsubscribed" }),
				],
			},
			{ 20: "double" },
		);
		expect(await resolveUuids(client, [20])).toEqual(["u2"]);
	});

	it("excludes disabled and blocklisted subscribers", async () => {
		// Listmonk flips every membership of a blocklisted subscriber to
		// "unsubscribed"; a disabled subscriber keeps its memberships.
		const client = makeClient({
			10: [
				makeSubscriber(1, "u1", "enabled", { 10: "unconfirmed" }),
				makeSubscriber(2, "u2", "blocklisted", { 10: "unsubscribed" }),
				makeSubscriber(3, "u3", "disabled", { 10: "confirmed" }),
				makeSubscriber(4, "u4", "enabled", { 10: "confirmed" }),
			],
		});
		const resolver = createListmonkAudienceResolver(client);
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(2);
		expect(snapshot.subscriberChecksum).toBe(
			computeAudienceChecksum(["u1", "u4"]),
		);
	});

	it("does not evaluate memberships of subscribers that are not enabled", async () => {
		const blocklisted: Subscriber = {
			id: 2,
			uuid: "u2",
			email: "b@y",
			status: "blocklisted",
		};
		const client = makeClient({
			10: [makeSubscriber(1, "u1", "enabled", { 10: "confirmed" }), blocklisted],
		});
		expect(await resolveUuids(client, [10])).toEqual(["u1"]);
	});

	it("admits a multi-list subscriber through any source list that permits delivery", async () => {
		// Subscriber 1 unsubscribed from single opt-in list 10 but confirmed
		// double opt-in list 11; subscriber 2 is unconfirmed on double opt-in
		// list 11 but still subscribed to single opt-in list 10; subscriber 3
		// qualifies through neither list.
		const viaDouble = makeSubscriber(1, "u1", "enabled", {
			10: "unsubscribed",
			11: "confirmed",
		});
		const viaSingle = makeSubscriber(2, "u2", "enabled", {
			10: "unconfirmed",
			11: "unconfirmed",
		});
		const neither = makeSubscriber(3, "u3", "enabled", {
			10: "unsubscribed",
			11: "unconfirmed",
		});
		const client = makeClient(
			{
				10: [viaDouble, viaSingle, neither],
				11: [viaDouble, viaSingle, neither],
			},
			{ 10: "single", 11: "double" },
		);
		expect(await resolveUuids(client, [10, 11])).toEqual(["u1", "u2"]);
		// The same subscriber is not admitted through a list it left when
		// that list is the only source.
		expect(await resolveUuids(client, [10])).toEqual(["u2"]);
		expect(await resolveUuids(client, [11])).toEqual(["u1"]);
	});

	it("fails closed when an enabled subscriber has no membership for the paged list", async () => {
		// A subscriber returned for list 10 whose memberships do not include
		// list 10 means the server did not apply the list filter (for example
		// a permission-filtered query); it must not become a recipient.
		const client = makeClient({
			10: [
				makeSubscriber(1, "u1", "enabled", { 10: "confirmed" }),
				makeSubscriber(2, "u2", "enabled", { 99: "confirmed" }),
			],
		});
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
		await expect(resolver.resolve([10])).rejects.toThrow(
			/source list 10 without exactly one recognizable membership/,
		);
	});

	it("fails closed when an enabled subscriber carries no memberships at all", async () => {
		const withoutLists: Subscriber = {
			id: 1,
			uuid: "u1",
			email: "a@y",
			status: "enabled",
		};
		const client = makeClient({ 10: [withoutLists] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed on an ambiguous or unknown membership status", async () => {
		const duplicated = makeSubscriber(1, "u1", "enabled", { 10: "confirmed" });
		duplicated.lists = [
			{ id: 10, subscription_status: "unsubscribed" },
			{ id: 10, subscription_status: "confirmed" },
		];
		const unknown = makeSubscriber(2, "u2", "enabled");
		unknown.lists = [{ id: 10, subscription_status: "pending" }];
		for (const subscriber of [duplicated, unknown]) {
			const resolver = createListmonkAudienceResolver(
				makeClient({ 10: [subscriber] }),
			);
			await expect(resolver.resolve([10])).rejects.toThrow(
				AudienceResolutionError,
			);
		}
	});

	it("reads each source list's opt-in mode once before paging", async () => {
		const { client, getById, subscriberList } = makeInstrumentedClient({
			10: [makeSubscriber(1, "u1", "enabled", { 10: "confirmed" })],
			11: [makeSubscriber(2, "u2", "enabled", { 11: "confirmed" })],
		});
		const resolver = createListmonkAudienceResolver(client);
		await resolver.resolve([11, 10, 11]);
		expect(getById).toHaveBeenCalledTimes(2);
		expect(
			getById.mock.calls.map(([options]) => options.path.list_id),
		).toEqual([10, 11]);
		expect(subscriberList).toHaveBeenCalledTimes(2);
	});

	it("fails closed without paging when a source list cannot be read", async () => {
		const subscriberList = mock(() =>
			mockListResponse(
				[makeSubscriber(1, "u1", "enabled", { 10: "confirmed" })],
				1,
			),
		);
		const getById = mock(async () => ({
			error: { message: "List not found" },
		}));
		const client = {
			subscriber: { list: subscriberList },
			list: { getById },
		} as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			/source list 10 could not be read to verify its opt-in mode: List not found/,
		);
		expect(subscriberList).not.toHaveBeenCalled();
	});

	it("fails closed when a source list reports an unknown opt-in mode", async () => {
		for (const optin of [undefined, "", "triple"]) {
			const { client, subscriberList } = makeInstrumentedClient(
				{ 10: [makeSubscriber(1, "u1", "enabled", { 10: "confirmed" })] },
				{ 10: optin },
			);
			const resolver = createListmonkAudienceResolver(client);
			await expect(resolver.resolve([10])).rejects.toThrow(
				/source list 10 did not report a known opt-in mode/,
			);
			expect(subscriberList).not.toHaveBeenCalled();
		}
	});

	it("keeps an unserializable list-read error as an AudienceResolutionError", async () => {
		const circular: Record<string, unknown> = { code: 500 };
		circular.self = circular;
		const client = {
			subscriber: { list: mock(() => mockListResponse([], 0)) },
			list: { getById: mock(async () => ({ error: circular })) },
		} as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			/source list 10 could not be read to verify its opt-in mode: \[object Object\]/,
		);
	});

	it("reports the server message when a subscriber page query fails", async () => {
		const client = {
			subscriber: {
				list: mock(async () => ({ error: { message: "Invalid list ID." } })),
			},
			list: { getById: makeListReader() },
		} as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			/list 10 page 1 query failed: Invalid list ID\./,
		);
	});

	it("fails closed when the list read returns a different list", async () => {
		const getById = mock(async () => ({
			data: { id: 11, optin: "single" },
		}));
		const client = {
			subscriber: {
				list: mock(() => mockListResponse([], 0)),
			},
			list: { getById },
		} as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("does not include subscribers returned from a different list", async () => {
		// A subscriber that is only in list 99 (not requested) must never
		// appear.
		const client = makeClient({
			10: [makeSubscriber(1, "u1", "enabled", { 10: "unconfirmed" })],
			99: [makeSubscriber(2, "u2", "enabled", { 99: "unconfirmed" })],
		});
		const resolver = createListmonkAudienceResolver(client);
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(1);
		expect(resolver.members().map((m) => m.subscriberUuid)).toEqual(["u1"]);
	});

	it("paginates beyond the first page", async () => {
		// Build 750 subscribers in list 10, page size 500 -> 2 pages.
		const all: Subscriber[] = Array.from({ length: 750 }, (_, i) =>
			makeSubscriber(i + 1, `uuid-${i + 1}`, "enabled", { 10: "unconfirmed" }),
		);
		const list = mock((options: MockListOptions) => {
			const query: Partial<MockListQuery> = options.query ?? {};
			const perPage = query.per_page ?? 500;
			const start = ((query.page ?? 1) - 1) * perPage;
			const slice = all.slice(start, start + perPage);
			return mockListResponse(slice, all.length);
		});
		const client = {
			subscriber: { list },
			list: { getById: makeListReader() },
		} as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client, {
			pageSize: 500,
		});
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(750);
		// pagination made at least 2 list calls
		expect(list).toHaveBeenCalledTimes(2);
	});

	it("fails closed when a subscriber is missing a uuid", async () => {
		const broken = makeSubscriber(5, "", "enabled", { 10: "confirmed" });
		broken.uuid = undefined;
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when a subscriber has an empty-string uuid", async () => {
		const broken = makeSubscriber(5, "", "enabled", { 10: "confirmed" });
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when a subscriber has a null id", async () => {
		const broken = {
			...makeSubscriber(5, "u1", "enabled", { 10: "confirmed" }),
			id: null,
		} as unknown as Subscriber;
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("tolerates a single intermittent empty page without truncating", async () => {
		// Page 1 returns 2 subscribers, page 2 returns empty (intermittent),
		// page 3 returns 2 more. Resolver should collect all 4.
		const sub1 = makeSubscriber(1, "u1", "enabled", { 10: "unconfirmed" });
		const sub2 = makeSubscriber(2, "u2", "enabled", { 10: "unconfirmed" });
		const sub3 = makeSubscriber(3, "u3", "enabled", { 10: "unconfirmed" });
		const sub4 = makeSubscriber(4, "u4", "enabled", { 10: "unconfirmed" });
		const pages = [
			[sub1, sub2],
			[],
			[sub3, sub4],
		];
		const list = mock((options: MockListOptions) => {
			const page = options.query?.page ?? 1;
			const slice = pages[page - 1] ?? [];
			return mockListResponse(slice, 4);
		});
		const client = {
			subscriber: { list },
			list: { getById: makeListReader() },
		} as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client, { pageSize: 2 });
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(4);
		// Page 3 fills exactly to pageSize (2), so the resolver queries page 4
		// to check for more; page 4 and 5 both return empty, breaking on the
		// second consecutive empty page. Total calls: 5.
		expect(list).toHaveBeenCalledTimes(5);
	});

	it("fails closed when a subscriber is missing a numeric id", async () => {
		const broken = makeSubscriber(5, "uuid-x", "enabled", { 10: "confirmed" });
		broken.id = undefined;
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when the same uuid maps to two numeric ids", async () => {
		const a = makeSubscriber(1, "shared-uuid", "enabled", { 10: "confirmed" });
		const b = makeSubscriber(2, "shared-uuid", "enabled", { 11: "confirmed" });
		const client = makeClient({ 10: [a], 11: [b] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10, 11])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when the same numeric id maps to two uuids", async () => {
		// Schema drift / inconsistent page read: id 1 appears under two uuids.
		const a = makeSubscriber(1, "uuid-one", "enabled", { 10: "confirmed" });
		const b = makeSubscriber(1, "uuid-two", "enabled", { 11: "confirmed" });
		const client = makeClient({ 10: [a], 11: [b] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10, 11])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("rejects empty or invalid sourceListIds", async () => {
		const client = makeClient({});
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([])).rejects.toThrow(
			AudienceResolutionError,
		);
		await expect(resolver.resolve([0, -1])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("dedupes the requested list ids before querying", async () => {
		const list = mock((options: MockListOptions) =>
			mockListResponse(
				[makeSubscriber(1, "u1", "enabled", { 10: "unconfirmed" })],
				1,
			),
		);
		const getById = makeListReader();
		const client = {
			subscriber: { list },
			list: { getById },
		} as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client);
		await resolver.resolve([10, 10, 10]);
		// Only one server call despite the duplicate list ids.
		expect(list).toHaveBeenCalledTimes(1);
		expect(getById).toHaveBeenCalledTimes(1);
	});

	it("members() throws before resolve() has been called", () => {
		const client = makeClient({});
		const resolver = createListmonkAudienceResolver(client);
		expect(() => resolver.members()).toThrow(AudienceResolutionError);
	});

	it("produces a checksum independent of source-list order", async () => {
		const shared = makeSubscriber(1, "uuid-1", "enabled", {
			10: "unconfirmed",
			11: "unconfirmed",
		});
		const client = makeClient({ 10: [shared], 11: [shared] });
		const resolverA = createListmonkAudienceResolver(client);
		const resolverB = createListmonkAudienceResolver(client);
		const snapA = await resolverA.resolve([10, 11]);
		const snapB = await resolverB.resolve([11, 10]);
		expect(snapA.subscriberChecksum).toBe(snapB.subscriberChecksum);
		expect(snapA.sourceListIds).toEqual([10, 11]);
	});
});
