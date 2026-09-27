import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createListmonkClient,
	type ListmonkClient,
} from "@listmonk-ops/openapi";
import { AbTestService } from "../src/abtest-service";
import { createAbTestExecutors } from "../src/factory";
import {
	cancelAbTest,
	executeCancelPlan,
	planCancelAbTest,
} from "../src/lifecycle";
import {
	ListmonkAbTestIntegration,
	type ProvisionedAbTestResources,
} from "../src/listmonk-integration";
import type { AbTest, AbTestConfig } from "../src/types";
import {
	findUnpropagatedOptOuts,
	propagateTemporaryListOptOuts,
	propagateTemporaryListsOptOuts,
	readTemporaryListOptOuts,
	resolveOptOutSourceListIds,
	unsubscribeSubscribersFromLists,
} from "../src/unsubscribe-propagation";

type MembershipStatus = "unconfirmed" | "confirmed" | "unsubscribed";

interface FakeListmonkOptions {
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
}

/**
 * In-memory Listmonk 6.2 slice: `subscriber_lists` rows, the campaign
 * unsubscribe query, and the list-deletion cascade that erases memberships.
 */
function createFakeListmonk(options: FakeListmonkOptions = {}) {
	const lists = new Set<number>();
	const subscriberIds = new Set<number>();
	const memberships = new Map<number, Map<number, MembershipStatus>>();
	const campaigns = new Map<number, { status: string; lists: number[] }>();
	const reads: Array<Record<string, unknown>> = [];
	const unsubscribes: Array<{ ids: number[]; target_list_ids: number[] }> =
		[];
	const deletedLists: number[] = [];

	// Listmonk 6.2 answers a missing campaign with 400, not 404.
	const campaignNotFound = () => ({
		error: { message: "Campaign not found" },
		response: { status: 400 },
	});

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
								memberships.get(id)?.get(listId) === status),
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
							([membershipListId, subscriptionStatus]) => ({
								id: membershipListId,
								subscription_status: subscriptionStatus,
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
				// existing memberships only.
				for (const id of body.ids) {
					for (const targetListId of body.target_list_ids) {
						if (options.unmanageableListIds?.includes(targetListId)) {
							continue;
						}
						const subscriberLists = memberships.get(id);
						if (subscriberLists?.has(targetListId)) {
							subscriberLists.set(targetListId, "unsubscribed");
						}
					}
				}
				return { data: true };
			},
		},
		list: {
			getById: async ({ path }: { path: { list_id: number } }) => {
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
				if (!lists.delete(path.list_id)) {
					// Listmonk 6.2 acknowledges deleting a missing list.
					return { data: true };
				}
				// subscriber_lists cascades; campaign_lists.list_id is set null.
				for (const subscriberLists of memberships.values()) {
					subscriberLists.delete(path.list_id);
				}
				for (const campaign of campaigns.values()) {
					campaign.lists = campaign.lists.filter((id) => id !== path.list_id);
				}
				deletedLists.push(path.list_id);
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
		unsubscribes,
		deletedLists,
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
						status,
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
		/**
		 * The public unsubscribe link (`unsubscribe-by-campaign`): only the
		 * campaign's own lists are marked unsubscribed.
		 */
		unsubscribeViaCampaign(campaignId: number, subscriberId: number) {
			const campaign = campaigns.get(campaignId);
			const subscriberLists = memberships.get(subscriberId);
			for (const listId of campaign?.lists ?? []) {
				if (subscriberLists?.has(listId)) {
					subscriberLists.set(listId, "unsubscribed");
				}
			}
		},
		membership(subscriberId: number, listId: number) {
			return memberships.get(subscriberId)?.get(listId);
		},
		hasList(id: number) {
			return lists.has(id);
		},
	};
}

type FakeListmonk = ReturnType<typeof createFakeListmonk>;

const SOURCE_A = 1;
const SOURCE_B = 2;

function makeTest(overrides: Partial<AbTest> = {}): AbTest {
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
function seedAbTestAudience(fake: FakeListmonk, campaignStatus = "finished") {
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

function silenceWarnings() {
	return spyOn(console, "warn").mockImplementation(() => undefined);
}

let warnSpy: ReturnType<typeof silenceWarnings> | undefined;
let tempDir: string | undefined;

afterEach(async () => {
	warnSpy?.mockRestore();
	warnSpy = undefined;
	if (tempDir !== undefined) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("resolveOptOutSourceListIds", () => {
	test("unions the audience snapshot and base config lists", () => {
		expect(
			resolveOptOutSourceListIds({
				baseConfig: { subject: "s", body: "b", lists: [3, 1, 1, 0, -2] },
				audienceSnapshot: {
					capturedAt: "2026-09-01T00:00:00.000Z",
					sourceListIds: [1, 5],
					subscriberCount: 1,
					subscriberChecksum: "x",
					eligibilityPolicyVersion: 1,
				},
			}),
		).toEqual([1, 3, 5]);
	});

	test("returns no lists for a record without source lists", () => {
		expect(
			resolveOptOutSourceListIds({
				baseConfig: { subject: "s", body: "b", lists: [] },
			}),
		).toEqual([]);
	});
});

describe("readTemporaryListOptOuts", () => {
	test("pages through the unsubscribed members of the list", async () => {
		const fake = createFakeListmonk();
		for (let id = 1; id <= 5; id += 1) {
			fake.addSubscriber(id, { 200: "unsubscribed", [SOURCE_A]: "confirmed" });
		}
		fake.addSubscriber(6, { 200: "unconfirmed" });

		const optOuts = await readTemporaryListOptOuts(fake.client, 200, {
			pageSize: 2,
		});

		expect(optOuts.map((optOut) => optOut.subscriberId).sort()).toEqual([
			1, 2, 3, 4, 5,
		]);
		expect(optOuts[0]?.membershipStatuses.get(SOURCE_A)).toBe("confirmed");
		expect(fake.reads).toEqual([1, 2, 3].map((page) => ({
			list_id: [200],
			subscription_status: "unsubscribed",
			page,
			per_page: 2,
		})));
	});

	test("fails closed when Listmonk drops the list filter", async () => {
		// An API user without permission on the list sees other subscribers;
		// treating them as opt-outs would unsubscribe the whole audience.
		const fake = createFakeListmonk({ ignoreListFilter: true });
		fake.addSubscriber(1, { [SOURCE_A]: "confirmed" });

		await expect(readTemporaryListOptOuts(fake.client, 200)).rejects.toThrow(
			"the list_id and subscription_status filter was not applied",
		);
	});

	test("fails closed when fewer rows arrive than Listmonk reported", async () => {
		const fake = createFakeListmonk({ pageCap: 2 });
		for (let id = 1; id <= 5; id += 1) {
			fake.addSubscriber(id, { 200: "unsubscribed" });
		}

		await expect(readTemporaryListOptOuts(fake.client, 200)).rejects.toThrow(
			"Read 2 of 5 opt-outs on temporary list 200",
		);
	});

	test("reports a failed read with the HTTP status", async () => {
		const fake = createFakeListmonk({ failOptOutRead: true });

		await expect(readTemporaryListOptOuts(fake.client, 200)).rejects.toThrow(
			"Failed to read opt-outs on temporary list 200 (page 1): HTTP 500: database unavailable",
		);
	});
});

describe("findUnpropagatedOptOuts and unsubscribeSubscribersFromLists", () => {
	test("select subscribers still subscribed to a source list", () => {
		const optOuts = [
			{ subscriberId: 1, membershipStatuses: new Map([[1, "confirmed"]]) },
			{ subscriberId: 2, membershipStatuses: new Map([[1, "unsubscribed"]]) },
			{ subscriberId: 3, membershipStatuses: new Map([[9, "confirmed"]]) },
		];
		expect(findUnpropagatedOptOuts(optOuts, [1, 2])).toEqual([1]);
	});

	test("send the unsubscribe action in chunks and require acknowledgement", async () => {
		const fake = createFakeListmonk();
		await unsubscribeSubscribersFromLists(fake.client, [1, 2, 3], [1, 2], 2);
		expect(fake.unsubscribes).toEqual([
			{ ids: [1, 2], target_list_ids: [1, 2] },
			{ ids: [3], target_list_ids: [1, 2] },
		]);

		const failing = createFakeListmonk({ failUnsubscribe: true });
		await expect(
			unsubscribeSubscribersFromLists(failing.client, [1], [1]),
		).rejects.toThrow("HTTP 403: permission denied");
	});
});

describe("propagateTemporaryListOptOuts", () => {
	test("allows deleting a list nobody unsubscribed from", async () => {
		const fake = createFakeListmonk();
		fake.addLists(200);
		fake.addSubscriber(1, { 200: "unconfirmed", [SOURCE_A]: "confirmed" });

		const result = await propagateTemporaryListOptOuts(fake.client, {
			listId: 200,
			sourceListIds: [SOURCE_A],
		});

		expect(result).toMatchObject({
			status: "no_opt_outs",
			safeToDelete: true,
			optedOutCount: 0,
			propagatedCount: 0,
		});
		expect(fake.unsubscribes).toEqual([]);
	});

	test.each([400, 404])(
		"treats Listmonk %i List not found as already cleaned",
		async (status) => {
			const reads: Array<Record<string, unknown>> = [];
			const client = {
				subscriber: {
					list: async ({ query }: { query: Record<string, unknown> }) => {
						reads.push(query);
						return { data: { results: [], total: 0 } };
					},
				},
				list: {
					getById: async () => ({
						error: { message: "List not found" },
						response: { status },
					}),
				},
			} as unknown as ListmonkClient;

			const result = await propagateTemporaryListOptOuts(client, {
				listId: 200,
				sourceListIds: [SOURCE_A],
			});

			expect(result).toMatchObject({
				status: "no_opt_outs",
				safeToDelete: true,
				optedOutCount: 0,
			});
			expect(reads).toEqual([]);
		},
	);

	test("keeps the list and avoids scanning when the list is unreadable", async () => {
		let subscriberReads = 0;
		const client = {
			subscriber: {
				list: async () => {
					subscriberReads += 1;
					return { data: { results: [], total: 0 } };
				},
			},
			list: {
				getById: async () => ({
					error: { message: "permission denied" },
					response: { status: 403 },
				}),
			},
		} as unknown as ListmonkClient;

		const result = await propagateTemporaryListOptOuts(client, {
			listId: 200,
			sourceListIds: [SOURCE_A],
		});

		expect(result).toMatchObject({ status: "failed", safeToDelete: false });
		expect(result.detail).toContain("HTTP 403: permission denied");
		expect(subscriberReads).toBe(0);
	});

	test("fails closed when the client cannot return raw subscriber pages", async () => {
		const client = {
			list: { getById: async () => ({ data: { id: 200 } }) },
			subscriber: {
				list: async () => ({ data: { results: [], total: 0 } }),
			},
		} as unknown as ListmonkClient;

		const result = await propagateTemporaryListOptOuts(client, {
			listId: 200,
			sourceListIds: [SOURCE_A],
		});

		expect(result).toMatchObject({ status: "failed", safeToDelete: false });
		expect(result.detail).toContain("does not support raw subscriber page reads");
	});

	test("keeps the list when another list-read error resembles not-found", async () => {
		for (const response of [
			{
				error: { message: "List not found" },
				response: { status: 500 },
			},
			{
				error: { message: "permission denied" },
				response: { status: 400 },
			},
		]) {
			const client = {
				subscriber: {
					list: async () => ({ data: { results: [], total: 0 } }),
				},
				list: { getById: async () => response },
			} as unknown as ListmonkClient;
			const result = await propagateTemporaryListOptOuts(client, {
				listId: 200,
				sourceListIds: [SOURCE_A],
			});

			expect(result).toMatchObject({ status: "failed", safeToDelete: false });
		}
	});

	test("rejects incomplete subscriber pages through the real Listmonk client", async () => {
		for (const malformedPage of [{}, { data: {} }, { data: { results: [] } }]) {
			const requestedPaths: string[] = [];
			const server = Bun.serve({
				port: 0,
				fetch(request) {
					const url = new URL(request.url);
					requestedPaths.push(url.pathname);
					if (url.pathname === "/api/lists/200") {
						return Response.json({
							data: { id: 200, name: "Temporary list" },
						});
					}
					if (url.pathname === "/api/subscribers") {
						return Response.json(malformedPage);
					}
					return new Response("Not Found", { status: 404 });
				},
			});

			try {
				const client = createListmonkClient({
					baseUrl: `http://127.0.0.1:${server.port}/api`,
					retries: 0,
				});
				const result = await propagateTemporaryListOptOuts(client, {
					listId: 200,
					sourceListIds: [SOURCE_A],
				});

				expect(result).toMatchObject({
					status: "failed",
					safeToDelete: false,
				});
				expect(result.detail).toContain(
					"incomplete subscriber page payload",
				);
				expect(requestedPaths).toEqual([
					"/api/lists/200",
					"/api/subscribers",
				]);
			} finally {
				server.stop(true);
			}
		}
	});

	test("accepts a valid empty page through the real Listmonk client", async () => {
		const server = Bun.serve({
			port: 0,
			fetch(request) {
				const url = new URL(request.url);
				if (url.pathname === "/api/lists/200") {
					return Response.json({ data: { id: 200, name: "Temporary list" } });
				}
				if (url.pathname === "/api/subscribers") {
					return Response.json({ data: { results: [], total: 0 } });
				}
				return new Response("Not Found", { status: 404 });
			},
		});

		try {
			const client = createListmonkClient({
				baseUrl: `http://127.0.0.1:${server.port}/api`,
				retries: 0,
			});
			const result = await propagateTemporaryListOptOuts(client, {
				listId: 200,
				sourceListIds: [SOURCE_A],
			});

			expect(result).toMatchObject({
				status: "no_opt_outs",
				safeToDelete: true,
				optedOutCount: 0,
			});
		} finally {
			server.stop(true);
		}
	});

	test("carries opt-outs to the source lists the subscriber belongs to", async () => {
		const fake = createFakeListmonk();
		fake.addSubscriber(1, {
			200: "unsubscribed",
			[SOURCE_A]: "confirmed",
			[SOURCE_B]: "unconfirmed",
		});
		// Not a member of source list 2: must not be added to it.
		fake.addSubscriber(2, { 200: "unsubscribed", [SOURCE_A]: "confirmed" });
		// Already unsubscribed from the source list.
		fake.addSubscriber(3, { 200: "unsubscribed", [SOURCE_A]: "unsubscribed" });
		// Unrelated list membership stays untouched.
		fake.addSubscriber(4, { 200: "unconfirmed", [SOURCE_A]: "confirmed" });

		const result = await propagateTemporaryListOptOuts(fake.client, {
			listId: 200,
			sourceListIds: [SOURCE_B, SOURCE_A, SOURCE_A],
		});

		expect(result).toEqual({
			listId: 200,
			status: "propagated",
			safeToDelete: true,
			optedOutCount: 3,
			propagatedCount: 2,
			sourceListIds: [SOURCE_A, SOURCE_B],
		});
		expect(fake.unsubscribes).toEqual([
			{ ids: [2, 1], target_list_ids: [SOURCE_A, SOURCE_B] },
		]);
		expect(fake.membership(1, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(1, SOURCE_B)).toBe("unsubscribed");
		expect(fake.membership(2, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(2, SOURCE_B)).toBeUndefined();
		expect(fake.membership(4, SOURCE_A)).toBe("confirmed");
	});

	test("is idempotent: a repeat run confirms without writing again", async () => {
		const fake = createFakeListmonk();
		fake.addSubscriber(1, { 200: "unsubscribed", [SOURCE_A]: "confirmed" });
		const input = { listId: 200, sourceListIds: [SOURCE_A] };

		await propagateTemporaryListOptOuts(fake.client, input);
		const repeat = await propagateTemporaryListOptOuts(fake.client, input);

		expect(repeat).toMatchObject({
			status: "propagated",
			safeToDelete: true,
			optedOutCount: 1,
			propagatedCount: 0,
		});
		expect(fake.unsubscribes).toHaveLength(1);
	});

	test("blocks deletion when the test records no source lists", async () => {
		const fake = createFakeListmonk();
		fake.addSubscriber(1, { 200: "unsubscribed", [SOURCE_A]: "confirmed" });

		const result = await propagateTemporaryListOptOuts(fake.client, {
			listId: 200,
			sourceListIds: [],
		});

		expect(result).toMatchObject({
			status: "blocked",
			safeToDelete: false,
			optedOutCount: 1,
		});
		expect(result.detail).toContain("records no source lists");
		expect(fake.unsubscribes).toEqual([]);
		expect(fake.membership(1, SOURCE_A)).toBe("confirmed");
	});

	test("keeps the list when the unsubscribe request fails", async () => {
		const fake = createFakeListmonk({ failUnsubscribe: true });
		fake.addSubscriber(1, { 200: "unsubscribed", [SOURCE_A]: "confirmed" });

		const result = await propagateTemporaryListOptOuts(fake.client, {
			listId: 200,
			sourceListIds: [SOURCE_A],
		});

		expect(result).toMatchObject({ status: "failed", safeToDelete: false });
		expect(result.detail).toContain("HTTP 403: permission denied");
	});

	test("keeps the list when Listmonk silently skips a source list", async () => {
		// Listmonk drops target lists the API user cannot manage and still
		// answers true, so only the confirmation read catches it.
		const fake = createFakeListmonk({ unmanageableListIds: [SOURCE_B] });
		fake.addSubscriber(1, {
			200: "unsubscribed",
			[SOURCE_A]: "confirmed",
			[SOURCE_B]: "confirmed",
		});

		const result = await propagateTemporaryListOptOuts(fake.client, {
			listId: 200,
			sourceListIds: [SOURCE_A, SOURCE_B],
		});

		expect(result).toMatchObject({
			status: "failed",
			safeToDelete: false,
			propagatedCount: 0,
		});
		expect(result.detail).toContain("still subscribed to source lists 1, 2");
	});

	test("keeps the list when the opt-outs cannot be read", async () => {
		const fake = createFakeListmonk({ failOptOutRead: true });
		fake.addLists(200);

		const result = await propagateTemporaryListOptOuts(fake.client, {
			listId: 200,
			sourceListIds: [SOURCE_A],
		});

		expect(result).toMatchObject({ status: "failed", safeToDelete: false });
		expect(result.detail).toContain("could not be read");
	});

	test("rejects successful subscriber pages with missing or invalid payloads", async () => {
		for (const response of [
			{},
			{ data: {} },
			{ data: { results: [] } },
			{ data: { results: [], total: "0" } },
		]) {
			const listPage = async () => response;
			const client = {
				subscriber: { list: listPage, listRaw: listPage },
			} as unknown as ListmonkClient;
			await expect(readTemporaryListOptOuts(client, 200)).rejects.toThrow(
				/incomplete subscriber page payload/,
			);
		}
	});

	test("processes several lists in order", async () => {
		const fake = createFakeListmonk();
		fake.addSubscriber(1, { 201: "unsubscribed", [SOURCE_A]: "confirmed" });

		const results = await propagateTemporaryListsOptOuts(fake.client, {
			listIds: [201, 200],
			sourceListIds: [SOURCE_A],
		});

		expect(results.map((result) => [result.listId, result.status])).toEqual([
			[201, "propagated"],
			[200, "no_opt_outs"],
		]);
	});
});

describe("delete carries opt-outs before removing temporary lists", () => {
	test("regression: variant and holdout opt-outs reach the source lists", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(100, 11);
		fake.unsubscribeViaCampaign(101, 14);
		fake.unsubscribeViaCampaign(300, 13);
		// Listmonk's unsubscribe link only touches the temporary list.
		expect(fake.membership(11, SOURCE_A)).toBe("confirmed");

		const service = new AbTestService(new ListmonkAbTestIntegration(fake.client));
		service.hydrateTests([makeTest({ winnerCampaignId: 300 })]);

		await expect(service.deleteTest("test_optout")).resolves.toBe(true);

		expect(fake.deletedLists.sort()).toEqual([200, 201, 202]);
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(11, SOURCE_B)).toBe("unsubscribed");
		expect(fake.membership(14, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(14, SOURCE_B)).toBeUndefined();
		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
		expect(fake.membership(12, SOURCE_A)).toBe("unconfirmed");
	});

	test("a failed propagation keeps the list and the local record for a retry", async () => {
		const fake = createFakeListmonk({ failUnsubscribe: true });
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(100, 11);
		const service = new AbTestService(new ListmonkAbTestIntegration(fake.client));
		service.hydrateTests([makeTest()]);

		await expect(service.deleteTest("test_optout")).rejects.toThrow(
			"temporary list 200 kept to preserve its opt-outs",
		);
		expect(fake.hasList(200)).toBe(true);
		expect(fake.membership(11, 200)).toBe("unsubscribed");
		// Lists without opt-outs were still cleaned up.
		expect(fake.deletedLists.sort()).toEqual([201, 202]);
		expect(await service.getTest("test_optout")).not.toBeNull();

		fake.options.failUnsubscribe = false;
		await expect(service.deleteTest("test_optout")).resolves.toBe(true);
		expect(fake.hasList(200)).toBe(false);
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
	});
});

describe("stop carries opt-outs before removing temporary lists", () => {
	test("cancelAbTest propagates before deleting and reports the counts", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake, "scheduled");
		// Variant A already sent, collected an opt-out, and was deleted in
		// Listmonk; variant B is still scheduled.
		fake.unsubscribeViaCampaign(100, 11);
		fake.removeCampaign(100);

		const result = await cancelAbTest(fake.client, makeTest());

		expect(result.fullyCleaned).toBe(true);
		expect(fake.deletedLists.sort()).toEqual([200, 201, 202]);
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
		expect(
			result.optOutPropagation.map((propagation) => [
				propagation.listId,
				propagation.status,
				propagation.propagatedCount,
			]),
		).toEqual([
			[200, "propagated", 1],
			[201, "no_opt_outs", 0],
			[202, "no_opt_outs", 0],
		]);
	});

	test("a plan without source lists keeps lists that hold opt-outs", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake, "scheduled");
		fake.unsubscribeViaCampaign(100, 11);
		const plan = planCancelAbTest(
			makeTest(),
			new Map([
				[100, "scheduled"],
				[101, "scheduled"],
			]),
		);
		delete plan.optOutSourceListIds;

		const result = await executeCancelPlan(fake.client, plan);

		expect(result.listResults).toContainEqual(
			expect.objectContaining({ listId: 200, outcome: "failed" }),
		);
		expect(result.hadFailures).toBe(true);
		expect(fake.hasList(200)).toBe(true);
		expect(fake.hasList(201)).toBe(false);
	});

	test("stopAbTest stays non-authoritative until the opt-outs are carried", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-optout-"));
		const fake = createFakeListmonk({ failUnsubscribe: true });
		seedAbTestAudience(fake, "scheduled");
		fake.unsubscribeViaCampaign(100, 11);
		const executors = createAbTestExecutors(
			fake.client,
			join(tempDir, "conversions.sqlite"),
		);
		executors.abTestService.hydrateTests([makeTest({ status: "scheduled" })]);

		await expect(executors.stopAbTest("test_optout")).rejects.toThrow(
			/stop is non-authoritative: .*temporary list 200 kept to preserve its opt-outs/,
		);
		expect(fake.hasList(200)).toBe(true);
		expect((await executors.abTestService.getTest("test_optout"))?.status).toBe(
			"scheduled",
		);

		fake.options.failUnsubscribe = false;
		const stopped = await executors.stopAbTest("test_optout");
		expect(stopped?.status).toBe("cancelled");
		expect(fake.hasList(200)).toBe(false);
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
	});
});

describe("rollback carries opt-outs before removing temporary lists", () => {
	const resources: ProvisionedAbTestResources = {
		testId: "test_optout",
		campaignIds: [100, 101],
		testListIds: [200, 201],
		holdoutListId: 202,
		sourceListIds: [SOURCE_A, SOURCE_B],
	};

	test("deletes lists once their opt-outs are carried", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake, "scheduled");
		fake.unsubscribeViaCampaign(101, 14);

		const rolledBack = await new ListmonkAbTestIntegration(
			fake.client,
		).rollbackProvisioning(resources);

		expect(rolledBack.deletedListIds.sort()).toEqual([200, 201, 202]);
		expect(fake.membership(14, SOURCE_A)).toBe("unsubscribed");
	});

	test("keeps the complete rollback list set when opt-outs cannot be carried", async () => {
		warnSpy = silenceWarnings();
		const fake = createFakeListmonk({ failUnsubscribe: true });
		seedAbTestAudience(fake, "scheduled");
		fake.unsubscribeViaCampaign(101, 14);

		const rolledBack = await new ListmonkAbTestIntegration(
			fake.client,
		).rollbackProvisioning(resources);

		expect(rolledBack.deletedListIds).toEqual([]);
		expect(fake.deletedLists).toEqual([]);
		for (const listId of [200, 201, 202]) {
			expect(fake.hasList(listId)).toBe(true);
		}
		expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
			"temporary list 201 kept to preserve its opt-outs",
		);
	});

	test("keeps the complete list checkpoint when one list's opt-out propagation fails", async () => {
		warnSpy = silenceWarnings();
		const fake = createFakeListmonk({ failUnsubscribeSubscriberIds: [14] });
		seedAbTestAudience(fake, "scheduled");
		fake.unsubscribeViaCampaign(101, 14);

		const rolledBack = await new ListmonkAbTestIntegration(
			fake.client,
		).rollbackProvisioning(resources);

		expect(rolledBack.deletedListIds).toEqual([]);
		expect(fake.deletedLists).toEqual([]);
		for (const listId of [200, 201, 202]) {
			expect(fake.hasList(listId)).toBe(true);
		}
		expect(
			warnSpy.mock.calls.some(([message]) =>
				String(message).includes(
					"temporary list 201 kept to preserve its opt-outs",
				),
			),
		).toBe(true);
	});

	test("provisioning hands the test's source lists to the rollback", async () => {
		let rollbackResources: ProvisionedAbTestResources | undefined;
		const integration = {
			getTotalSubscribers: async () => 1000,
			createTestCampaigns: async () => [
				{ variantId: "variant-a", campaignId: 201 },
				{ variantId: "variant-b", campaignId: 202 },
			],
			segmentSubscribersForHoldout: async () => {
				throw new Error("segmentation failed");
			},
			rollbackProvisioning: async (provisioned: ProvisionedAbTestResources) => {
				rollbackResources = provisioned;
				return { deletedCampaignIds: [], deletedListIds: [] };
			},
		} as unknown as ListmonkAbTestIntegration;
		const previousSilent = process.env.LISTMONK_OPS_ABTEST_SILENT;
		process.env.LISTMONK_OPS_ABTEST_SILENT = "1";
		const config: AbTestConfig = {
			name: "Rollback sources",
			campaignId: "campaign-1",
			variants: [
				{ name: "A", percentage: 50, contentOverrides: {} },
				{ name: "B", percentage: 50, contentOverrides: {} },
			],
			metrics: [],
			baseConfig: { subject: "s", body: "b", lists: [SOURCE_B, SOURCE_A] },
			ignoreStatisticalWarnings: true,
		};

		try {
			await expect(
				new AbTestService(integration).createTest(config),
			).rejects.toThrow("segmentation failed");
		} finally {
			if (previousSilent === undefined) {
				delete process.env.LISTMONK_OPS_ABTEST_SILENT;
			} else {
				process.env.LISTMONK_OPS_ABTEST_SILENT = previousSilent;
			}
		}
		expect(rollbackResources?.sourceListIds).toEqual([SOURCE_A, SOURCE_B]);
	});
});

describe("legacy completion cleanup carries opt-outs", () => {
	test("cleanupHoldoutTest carries opt-outs from test and holdout lists", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(100, 11);
		fake.unsubscribeViaCampaign(300, 13);

		const report = await new ListmonkAbTestIntegration(
			fake.client,
		).cleanupHoldoutTest("test_optout", [200, 201], 202, [100, 101], false, {
			sourceListIds: [SOURCE_A, SOURCE_B],
		});

		expect(report.every((propagation) => propagation.safeToDelete)).toBe(true);
		expect(fake.deletedLists.sort()).toEqual([200, 201, 202]);
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
	});

	test("cleanup keeps a list with opt-outs when no source lists are given", async () => {
		warnSpy = silenceWarnings();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(100, 11);

		const report = await new ListmonkAbTestIntegration(fake.client).cleanup(
			"test_optout",
			[200, 201],
			[100, 101],
		);

		expect(report.map((propagation) => propagation.status)).toEqual([
			"blocked",
			"no_opt_outs",
		]);
		expect(fake.hasList(200)).toBe(true);
		expect(fake.hasList(201)).toBe(false);
		expect(fake.membership(11, 200)).toBe("unsubscribed");
	});
});
