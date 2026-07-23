import { describe, expect, it, mock } from "bun:test";
import type { ListmonkClient, Subscriber } from "@listmonk-ops/openapi";
import {
	buildAudienceSnapshot,
	computeAudienceChecksum,
	createListmonkAudienceResolver,
	AudienceResolutionError,
	isEligibleSubscriber,
	type AudienceMember,
} from "../src/audience";

interface MockListQuery {
	page: number;
	per_page: number;
	list_id?: number[];
}

interface MockListOptions {
	query?: MockListQuery;
}

function makeSubscriber(
	id: number,
	uuid: string,
	status: string,
	listIds: number[] = [],
): Subscriber {
	return {
		id,
		uuid,
		email: `sub-${id}@test`,
		name: `Sub ${id}`,
		status,
		lists: listIds.map((listId) => ({
			id: listId,
			subscription_status: "unconfirmed",
			name: `List ${listId}`,
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
 * Build a ListmonkClient fake whose subscriber.list paginates the supplied
 * per-list subscriber sets. `subscribersByList` maps listId -> array of
 * subscribers returned for that list (page 1).
 */
function makeClient(
	subscribersByList: Record<number, Subscriber[]>,
): ListmonkClient {
	const list = mock((options: MockListOptions) => {
		const query = options.query ?? {};
		const listId = query.list_id?.[0] ?? 0;
		const all = subscribersByList[listId] ?? [];
		const perPage = query.per_page ?? 500;
		const start = ((query.page ?? 1) - 1) * perPage;
		const slice = all.slice(start, start + perPage);
		return mockListResponse(slice, all.length);
	});
	return { subscriber: { list } } as unknown as ListmonkClient;
}

describe("isEligibleSubscriber", () => {
	it("accepts enabled subscribers", () => {
		expect(isEligibleSubscriber(makeSubscriber(1, "u1", "enabled"))).toBe(true);
	});
	it("rejects blocklisted and unsubscribed", () => {
		expect(isEligibleSubscriber(makeSubscriber(1, "u1", "blocklisted"))).toBe(
			false,
		);
		expect(isEligibleSubscriber(makeSubscriber(1, "u1", "unsubscribed"))).toBe(
			false,
		);
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
		expect(snap.subscriberChecksum).toBe(
			computeAudienceChecksum(["u1", "u2"]),
		);
		expect(snap.eligibilityPolicyVersion).toBe(1);
	});
});

describe("createListmonkAudienceResolver", () => {
	it("dedupes subscribers that appear in multiple source lists", async () => {
		// subscriber 1 is in both list 10 and list 11
		const shared = makeSubscriber(1, "uuid-1", "enabled", [10, 11]);
		const only10 = makeSubscriber(2, "uuid-2", "enabled", [10]);
		const only11 = makeSubscriber(3, "uuid-3", "enabled", [11]);
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
		const members = resolver.members();
		expect(members.map((m) => m.subscriberId).sort((a, b) => a - b)).toEqual([
			1, 2, 3,
		]);
	});

	it("excludes disabled and blocklisted subscribers", async () => {
		const client = makeClient({
			10: [
				makeSubscriber(1, "u1", "enabled"),
				makeSubscriber(2, "u2", "blocklisted"),
				makeSubscriber(3, "u3", "unsubscribed"),
				makeSubscriber(4, "u4", "enabled"),
			],
		});
		const resolver = createListmonkAudienceResolver(client);
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(2);
		expect(snapshot.subscriberChecksum).toBe(
			computeAudienceChecksum(["u1", "u4"]),
		);
	});

	it("does not include subscribers returned from a different list", async () => {
		// Even if the server returns a subscriber under list 11 that wasn't
		// requested, the resolver trusts the server-side list_id filter and
		// includes it as part of list 11's page. But a subscriber that is only
		// in list 99 (not requested) must never appear.
		const client = makeClient({
			10: [makeSubscriber(1, "u1", "enabled", [10])],
			99: [makeSubscriber(2, "u2", "enabled", [99])],
		});
		const resolver = createListmonkAudienceResolver(client);
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(1);
		expect(resolver.members().map((m) => m.subscriberUuid)).toEqual(["u1"]);
	});

	it("paginates beyond the first page", async () => {
		// Build 750 subscribers in list 10, page size 500 -> 2 pages.
		const all: Subscriber[] = Array.from({ length: 750 }, (_, i) =>
			makeSubscriber(i + 1, `uuid-${i + 1}`, "enabled", [10]),
		);
		const list = mock((options: MockListOptions) => {
			const query = options.query ?? {};
			const perPage = query.per_page ?? 500;
			const start = ((query.page ?? 1) - 1) * perPage;
			const slice = all.slice(start, start + perPage);
			return mockListResponse(slice, all.length);
		});
		const client = { subscriber: { list } } as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client, {
			pageSize: 500,
		});
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(750);
		// pagination made at least 2 list calls
		expect(list).toHaveBeenCalledTimes(2);
	});

	it("fails closed when a subscriber is missing a uuid", async () => {
		const broken: Subscriber = {
			id: 5,
			uuid: undefined,
			email: "x@y",
			status: "enabled",
		};
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when a subscriber has an empty-string uuid", async () => {
		const broken: Subscriber = {
			id: 5,
			uuid: "",
			email: "x@y",
			status: "enabled",
		};
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when a subscriber has a null id", async () => {
		const broken = { id: null, uuid: "u1", email: "x@y", status: "enabled" } as unknown as Subscriber;
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("tolerates a single intermittent empty page without truncating", async () => {
		// Page 1 returns 2 subscribers, page 2 returns empty (intermittent),
		// page 3 returns 2 more. Resolver should collect all 4.
		const sub1 = makeSubscriber(1, "u1", "enabled", [10]);
		const sub2 = makeSubscriber(2, "u2", "enabled", [10]);
		const sub3 = makeSubscriber(3, "u3", "enabled", [10]);
		const sub4 = makeSubscriber(4, "u4", "enabled", [10]);
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
		const client = { subscriber: { list } } as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client, { pageSize: 2 });
		const snapshot = await resolver.resolve([10]);
		expect(snapshot.subscriberCount).toBe(4);
		// Page 3 fills exactly to pageSize (2), so the resolver queries page 4
		// to check for more; page 4 and 5 both return empty, breaking on the
		// second consecutive empty page. Total calls: 5.
		expect(list).toHaveBeenCalledTimes(5);
	});

	it("fails closed when a subscriber is missing a numeric id", async () => {
		const broken: Subscriber = {
			id: undefined,
			uuid: "uuid-x",
			email: "x@y",
			status: "enabled",
		};
		const client = makeClient({ 10: [broken] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when the same uuid maps to two numeric ids", async () => {
		const a: Subscriber = {
			id: 1,
			uuid: "shared-uuid",
			status: "enabled",
			email: "a@y",
		};
		const b: Subscriber = {
			id: 2,
			uuid: "shared-uuid",
			status: "enabled",
			email: "b@y",
		};
		const client = makeClient({ 10: [a], 11: [b] });
		const resolver = createListmonkAudienceResolver(client);
		await expect(resolver.resolve([10, 11])).rejects.toThrow(
			AudienceResolutionError,
		);
	});

	it("fails closed when the same numeric id maps to two uuids", async () => {
		// Schema drift / inconsistent page read: id 1 appears under two uuids.
		const a: Subscriber = {
			id: 1,
			uuid: "uuid-one",
			status: "enabled",
			email: "a@y",
		};
		const b: Subscriber = {
			id: 1,
			uuid: "uuid-two",
			status: "enabled",
			email: "a@y",
		};
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
				[makeSubscriber(1, "u1", "enabled", [10])],
				1,
			),
		);
		const client = { subscriber: { list } } as unknown as ListmonkClient;
		const resolver = createListmonkAudienceResolver(client);
		await resolver.resolve([10, 10, 10]);
		// Only one server call despite the duplicate list ids.
		expect(list).toHaveBeenCalledTimes(1);
	});

	it("members() throws before resolve() has been called", () => {
		const client = makeClient({});
		const resolver = createListmonkAudienceResolver(client);
		expect(() => resolver.members()).toThrow(AudienceResolutionError);
	});

	it("produces a checksum independent of source-list order", async () => {
		const shared = makeSubscriber(1, "uuid-1", "enabled", [10, 11]);
		const client = makeClient({ 10: [shared], 11: [shared] });
		const resolverA = createListmonkAudienceResolver(client);
		const resolverB = createListmonkAudienceResolver(client);
		const snapA = await resolverA.resolve([10, 11]);
		const snapB = await resolverB.resolve([11, 10]);
		expect(snapA.subscriberChecksum).toBe(snapB.subscriberChecksum);
		expect(snapA.sourceListIds).toEqual([10, 11]);
	});
});
