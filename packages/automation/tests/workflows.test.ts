import { describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { runCampaignPreflight } from "../src/campaign";
import { generateDailyDigest } from "../src/digest";
import {
	classifyHygieneMutationResponse,
	membershipPermitsDelivery,
	runSubscriberHygiene,
} from "../src/hygiene";
import { runSegmentDriftSnapshot } from "../src/segment-drift";
import { syncTemplateRegistry } from "../src/template-registry";

// A subscriber whose profile updated_at is far past any inactivity cutoff.
function staleSubscriber(
	id: number,
	lists: Array<Record<string, unknown>>,
	overrides: Record<string, unknown> = {},
) {
	return {
		id,
		email: `s${id}@old.test`,
		status: "enabled",
		updated_at: "2020-01-01T00:00:00Z",
		lists,
		...overrides,
	};
}

// Listmonk's acknowledgement for list and blocklist mutations.
const acknowledged = { data: true };

function createWorkflowClient(
	overrides: Partial<ListmonkClient>,
): ListmonkClient {
	return {
		bounce: {
			list: async () => ({ data: { results: [] } }),
		},
		campaign: {
			getById: async () => ({
				data: {
					id: 1,
					name: "Campaign",
					updated_at: "2026-01-01T00:00:00Z",
					status: "draft",
					subject: "Subject",
					body: "<p>Hello</p>",
					lists: [{ id: 1 }],
				},
			}),
			list: async () => ({ data: { results: [] } }),
		},
		list: {
			getById: async () => ({
				data: { id: 1, name: "List", subscriber_count: 10 },
			}),
			list: async () => ({ data: { results: [] } }),
		},
		subscriber: {
			list: async () => ({ data: { results: [] } }),
		},
		template: {
			getById: async () => ({ data: { id: 1, name: "Template" } }),
			list: async () => ({ data: { results: [] } }),
		},
		...overrides,
	} as unknown as ListmonkClient;
}

describe("automation workflows", () => {
	test("campaign preflight fails loudly when campaign data is missing", async () => {
		const client = createWorkflowClient({
			campaign: {
				getById: async () => ({ data: undefined }),
			},
		});

		await expect(runCampaignPreflight(client, 123)).rejects.toThrow(
			"Failed to fetch campaign 123: received empty data",
		);
	});

	test("daily digest propagates list query failures", async () => {
		const client = createWorkflowClient({
			list: {
				list: async () => ({ error: "boom" }),
			},
		});

		await expect(generateDailyDigest(client)).rejects.toThrow(
			"Failed to list lists for daily digest: boom",
		);
	});

	test("segment drift propagates list query failures", async () => {
		const client = createWorkflowClient({
			list: {
				list: async () => ({ error: "segment failure" }),
			},
		});

		await expect(runSegmentDriftSnapshot(client)).rejects.toThrow(
			"Failed to list lists for segment drift: segment failure",
		);
	});

	test("processes exactly the echoed hygiene set and retries as no-ops", async () => {
		const blocklisted: number[] = [];
		const confirmed = [{ id: 1, subscription_status: "confirmed" }];
		const client = {
			subscriber: {
				list: async () => ({
					data: {
						results: [
							staleSubscriber(101, confirmed),
							staleSubscriber(102, confirmed),
							staleSubscriber(103, confirmed, {
								updated_at: new Date().toISOString(),
							}),
						],
					},
				}),
				manageBlocklistById: async ({ path }: { path: { id: number } }) => {
					blocklisted.push(path.id);
					return acknowledged;
				},
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;

		const { runSubscriberHygiene } = await import("../src/hygiene");
		const preview = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			dryRun: true,
		});
		expect(preview.subscriberIds).toEqual([101, 102]);

		const applied = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			subscriberIds: preview.subscriberIds,
			dryRun: false,
		});
		expect(applied.processedSubscribers).toBe(2);
		expect(blocklisted).toEqual([101, 102]);

		// The identical retry blocklists the same subscribers again — a
		// per-subscriber idempotent effect with no new outcome.
		const retried = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			subscriberIds: preview.subscriberIds,
			dryRun: false,
		});
		expect(retried.processedSubscribers).toBe(2);
		expect(blocklisted).toEqual([101, 102, 101, 102]);
	});

	test("guarded hygiene retries skip subscribers whose updated_at moved", async () => {
		const blocklisted: number[] = [];
		let subscriber101UpdatedAt = "2020-01-01T00:00:00Z";
		const confirmed = [{ id: 1, subscription_status: "confirmed" }];
		const client = {
			subscriber: {
				list: async () => ({
					data: {
						results: [
							staleSubscriber(101, confirmed, {
								updated_at: subscriber101UpdatedAt,
							}),
							staleSubscriber(102, confirmed),
						],
					},
				}),
				manageBlocklistById: async ({ path }: { path: { id: number } }) => {
					blocklisted.push(path.id);
					// Listmonk advances updated_at when it blocklists. The new
					// timestamp stays before the inactivity cutoff so 101
					// remains eligible — only its generation moved.
					if (path.id === 101) {
						subscriber101UpdatedAt = "2020-02-01T00:00:00Z";
					}
					return acknowledged;
				},
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;

		const { runSubscriberHygiene } = await import("../src/hygiene");
		const preview = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			dryRun: true,
		});
		// Parallel to subscriberIds, raw timestamps preserved.
		expect(preview.subscriberUpdatedAt).toEqual([
			"2020-01-01T00:00:00Z",
			"2020-01-01T00:00:00Z",
		]);

		const guards = new Map(
			preview.subscriberIds.map((id, index) => [
				id,
				preview.subscriberUpdatedAt[index]!,
			]),
		);
		const applied = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			subscriberIds: preview.subscriberIds,
			expectedUpdatedAt: guards,
			dryRun: false,
		});
		expect(applied.processedSubscribers).toBe(2);
		expect(blocklisted).toEqual([101, 102]);

		// The guarded retry re-reads the subscribers: 101's updated_at moved
		// (its own blocklist advanced it — an external change or eligibility
		// re-entry moves it the same way), so it is skipped; 102's unchanged
		// observation would run again only if it had never been touched.
		const retried = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			subscriberIds: preview.subscriberIds,
			expectedUpdatedAt: guards,
			dryRun: false,
		});
		expect(retried.processedSubscribers).toBe(1);
		expect(retried.skippedGuarded).toBe(1);
		expect(blocklisted).toEqual([101, 102, 102]);
	});

	test("a partially applied hygiene subscriber recovers its missing effect", async () => {
		const blocklisted: number[] = [];
		const listAdds: number[] = [];
		let subscriber101UpdatedAt = "2020-01-01T00:00:00Z";
		let subscriber101Lists: Array<Record<string, unknown>> = [
			{ id: 5, subscription_status: "confirmed" },
		];
		let failBlocklistOnce = true;
		const client = {
			subscriber: {
				list: async () => ({
					data: {
						results: [
							staleSubscriber(101, subscriber101Lists, {
								updated_at: subscriber101UpdatedAt,
							}),
						],
					},
				}),
				manageListById: async ({
					path,
				}: {
					path: { id: number };
					body: { target_list_ids: number[] };
				}) => {
					listAdds.push(path.id);
					// Listmonk 6.2 adds the membership as unconfirmed and leaves
					// the subscriber's updated_at untouched.
					subscriber101Lists = [
						...subscriber101Lists,
						{ id: 77, subscription_status: "unconfirmed" },
					];
					return acknowledged;
				},
				manageBlocklistById: async ({ path }: { path: { id: number } }) => {
					if (failBlocklistOnce) {
						failBlocklistOnce = false;
						// The client resolves HTTP failures as error envelopes.
						return {
							error: { message: "blocklist endpoint failed" },
							response: { status: 500 },
						};
					}
					blocklisted.push(path.id);
					subscriber101UpdatedAt = "2020-03-01T00:00:00Z";
					return acknowledged;
				},
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;

		const { runSubscriberHygiene } = await import("../src/hygiene");
		const preview = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			targetListId: 77,
			dryRun: true,
		});
		expect(preview.subscriberIds).toEqual([101]);

		// First attempt: the list-add lands, the blocklist fails.
		const first = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			targetListId: 77,
			subscriberIds: preview.subscriberIds,
			expectedUpdatedAt: new Map(
				preview.subscriberIds.map((id, index) => [
					id,
					preview.subscriberUpdatedAt[index]!,
				]),
			),
			dryRun: false,
		});
		expect(first.errors).toEqual([
			"Subscriber mutation failed for 1 subscriber: blocklist http_500",
		]);
		expect(first.processedSubscribers).toBe(0);
		expect(first.failedSubscribers).toBe(1);
		expect(listAdds).toEqual([101]);
		expect(blocklisted).toEqual([]);

		// Recovery: a fresh dry run observes the same updated_at (a list add
		// does not move it) plus the already-present membership; the retried
		// destructive run skips the redundant list-add structurally and
		// applies the missing blocklist.
		const reobserved = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			targetListId: 77,
			dryRun: true,
		});
		expect(reobserved.subscriberUpdatedAt).toEqual(
			preview.subscriberUpdatedAt,
		);
		const recovered = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			targetListId: 77,
			subscriberIds: reobserved.subscriberIds,
			expectedUpdatedAt: new Map(
				reobserved.subscriberIds.map((id, index) => [
					id,
					reobserved.subscriberUpdatedAt[index]!,
				]),
			),
			dryRun: false,
		});
		expect(listAdds).toEqual([101]);
		expect(blocklisted).toEqual([101]);
		expect(recovered.errors).toEqual([]);
		expect(recovered.processedSubscribers).toBe(1);
		expect(recovered.failedSubscribers).toBe(0);
	});

	test("redacts subscriber identifiers and remote mutation errors from hygiene results", async () => {
		const client = createWorkflowClient({
			subscriber: {
				list: async () => ({
					data: {
						results: [
							staleSubscriber(
								999,
								[{ id: 3, subscription_status: "confirmed" }],
								{ email: "private@example.com" },
							),
						],
					},
				}),
				manageListById: async () => {
					throw new Error(
						"remote token=private-subscriber-token https://internal.example",
					);
				},
			},
		});

		const result = await runSubscriberHygiene(client, {
			mode: "winback",
			targetListId: 10,
			subscriberIds: [999],
			dryRun: false,
		});
		expect(result.errors).toEqual([
			"Subscriber mutation failed for 1 subscriber: list_add request_failed",
		]);
		expect(result.failedSubscribers).toBe(1);
		expect(result.processedSubscribers).toBe(0);
		expect(result.sample).toEqual([
			{
				emailMasked: "p***@example.com",
				updated_at: "2020-01-01T00:00:00Z",
			},
		]);
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("private-subscriber-token");
		expect(serialized).not.toContain('"id":999');
	});

	test("applies Listmonk's per-membership delivery rule and fails closed", () => {
		expect(membershipPermitsDelivery("confirmed", "double")).toBe(true);
		expect(membershipPermitsDelivery("confirmed", undefined)).toBe(true);
		expect(membershipPermitsDelivery("unconfirmed", "single")).toBe(true);
		expect(membershipPermitsDelivery("unconfirmed", "double")).toBe(false);
		expect(membershipPermitsDelivery("unconfirmed", undefined)).toBe(false);
		expect(membershipPermitsDelivery("unsubscribed", "single")).toBe(false);
		expect(membershipPermitsDelivery(undefined, "single")).toBe(false);
		expect(membershipPermitsDelivery("blocklisted", "single")).toBe(false);
	});

	test("selects only hygiene candidates whose memberships permit delivery", async () => {
		const listAdds: Array<{ id: number; body: unknown }> = [];
		const listQueries: unknown[] = [];
		const client = createWorkflowClient({
			list: {
				list: async (options: unknown) => {
					listQueries.push(options);
					return {
						data: {
							results: [
								{ id: 10, optin: "single" },
								{ id: 20, optin: "double" },
								{ id: 30, optin: "single" },
								{ id: 50, optin: "double" },
							],
						},
					};
				},
			},
			subscriber: {
				list: async () => ({
					data: {
						results: [
							// Unsubscribed from every list: the reviewed repro.
							staleSubscriber(201, [
								{ id: 10, subscription_status: "unsubscribed" },
							]),
							// Unconfirmed on a double opt-in list.
							staleSubscriber(202, [
								{ id: 20, subscription_status: "unconfirmed" },
							]),
							// Unconfirmed on a single opt-in list: deliverable.
							staleSubscriber(203, [
								{ id: 30, subscription_status: "unconfirmed" },
							]),
							// Confirmed on a double opt-in list: deliverable.
							staleSubscriber(204, [
								{ id: 20, subscription_status: "confirmed" },
							]),
							// No membership at all.
							staleSubscriber(205, []),
							// A list the token cannot read: opt-in undeterminable.
							staleSubscriber(206, [
								{ id: 40, subscription_status: "unconfirmed" },
							]),
							// The embedded list row is not the opt-in authority.
							staleSubscriber(207, [
								{ id: 50, subscription_status: "unconfirmed", optin: "single" },
							]),
							// An unknown subscription status.
							staleSubscriber(208, [
								{ id: 30, subscription_status: "pending" },
							]),
						],
					},
				}),
				manageListById: async (options: {
					path: { id: number };
					body: unknown;
				}) => {
					listAdds.push({ id: options.path.id, body: options.body });
					return acknowledged;
				},
			},
		});

		const preview = await runSubscriberHygiene(client, {
			mode: "winback",
			dryRun: true,
		});
		expect(preview.subscriberIds).toEqual([203, 204]);
		expect(preview.candidateSubscribers).toBe(2);
		// One read of the full list rows, which carry the opt-in mode.
		expect(listQueries).toEqual([{ query: { per_page: "all" } }]);
		// The unreadable list fails closed, but visibly.
		expect(preview.errors).toEqual([
			"Warning: 1 subscriber skipped because an unconfirmed membership's list opt-in mode could not be read",
		]);

		// A library consumer echoing an ineligible id still cannot add the
		// unsubscribed subscriber to the winback list.
		const applied = await runSubscriberHygiene(client, {
			mode: "winback",
			targetListId: 99,
			subscriberIds: [201, 203],
			dryRun: false,
		});
		expect(applied.subscriberIds).toEqual([203]);
		expect(applied.processedSubscribers).toBe(1);
		expect(applied.failedSubscribers).toBe(0);
		expect(listAdds).toEqual([
			{
				id: 203,
				body: { action: "add", ids: [203], target_list_ids: [99] },
			},
		]);
	});

	test("scopes hygiene eligibility to deliverable source-list memberships", async () => {
		// No unconfirmed membership decides eligibility, so the list
		// endpoint is never read (this client has none).
		const client = {
			subscriber: {
				list: async () => ({
					data: {
						results: [
							staleSubscriber(301, [
								{ id: 10, subscription_status: "unsubscribed" },
								{ id: 20, subscription_status: "confirmed" },
							]),
						],
					},
				}),
			},
		} as unknown as ListmonkClient;

		const unsubscribedSource = await runSubscriberHygiene(client, {
			sourceListIds: [10],
		});
		expect(unsubscribedSource.subscriberIds).toEqual([]);
		const confirmedSource = await runSubscriberHygiene(client, {
			sourceListIds: [20],
		});
		expect(confirmedSource.subscriberIds).toEqual([301]);
		const anyList = await runSubscriberHygiene(client, {});
		expect(anyList.subscriberIds).toEqual([301]);
	});

	test("fails closed when list opt-in modes cannot be read", async () => {
		let mutations = 0;
		const client = createWorkflowClient({
			list: {
				list: async () => ({
					error: "lists unavailable",
					data: { results: [] },
				}),
			},
			subscriber: {
				list: async () => ({
					data: {
						results: [
							staleSubscriber(401, [
								{ id: 30, subscription_status: "unconfirmed" },
							]),
						],
					},
				}),
				manageListById: async () => {
					mutations += 1;
					return acknowledged;
				},
			},
		});

		await expect(
			runSubscriberHygiene(client, { mode: "winback", dryRun: true }),
		).rejects.toThrow("Failed to list lists for the hygiene opt-in check");
		await expect(
			runSubscriberHygiene(client, {
				mode: "winback",
				targetListId: 99,
				subscriberIds: [401],
				dryRun: false,
			}),
		).rejects.toThrow("Failed to list lists for the hygiene opt-in check");
		expect(mutations).toBe(0);
	});

	test("classifies hygiene mutation responses without remote text", () => {
		expect(classifyHygieneMutationResponse({ data: true })).toBeUndefined();
		expect(classifyHygieneMutationResponse({ data: false })).toBe(
			"negative_acknowledgement",
		);
		expect(classifyHygieneMutationResponse({})).toBe(
			"negative_acknowledgement",
		);
		expect(classifyHygieneMutationResponse(undefined)).toBe(
			"negative_acknowledgement",
		);
		expect(
			classifyHygieneMutationResponse({
				error: { message: "Permission denied" },
				response: { status: 403 },
			}),
		).toBe("http_403");
		expect(
			classifyHygieneMutationResponse({
				error: new TypeError("fetch failed"),
				response: undefined,
			}),
		).toBe("request_failed");
		// A body parse failure on a 2xx response is not an HTTP error status.
		expect(
			classifyHygieneMutationResponse({
				error: new SyntaxError("Unexpected token"),
				response: { status: 200 },
			}),
		).toBe("request_failed");
	});

	test("counts error envelopes and unacknowledged mutations as hygiene failures", async () => {
		const blocklisted: number[] = [];
		const confirmed = [{ id: 1, subscription_status: "confirmed" }];
		const listAddResponses = new Map<number, unknown>([
			[501, acknowledged],
			[
				502,
				{
					error: { message: "remote-secret permission denied" },
					response: { status: 403 },
				},
			],
			[503, acknowledged],
			[504, { data: false }],
			[
				505,
				{
					error: { message: "remote-secret permission denied" },
					response: { status: 403 },
				},
			],
			[
				506,
				{
					error: new TypeError("fetch failed remote-secret"),
					response: undefined,
				},
			],
		]);
		const client = createWorkflowClient({
			subscriber: {
				list: async () => ({
					data: {
						results: [...listAddResponses.keys()].map((id) =>
							staleSubscriber(id, confirmed),
						),
					},
				}),
				manageListById: async ({ path }: { path: { id: number } }) =>
					listAddResponses.get(path.id),
				manageBlocklistById: async ({ path }: { path: { id: number } }) => {
					if (path.id === 503) {
						return {
							error: { message: "remote-secret database error" },
							response: { status: 500 },
						};
					}
					blocklisted.push(path.id);
					return acknowledged;
				},
			},
		});

		const result = await runSubscriberHygiene(client, {
			mode: "sunset",
			blocklist: true,
			targetListId: 77,
			subscriberIds: [...listAddResponses.keys()],
			dryRun: false,
		});
		expect(result.processedSubscribers).toBe(1);
		expect(result.failedSubscribers).toBe(5);
		// A failed list add stops that subscriber before its blocklist.
		expect(blocklisted).toEqual([501]);
		expect(result.errors).toEqual([
			"Subscriber mutation failed for 2 subscribers: list_add http_403",
			"Subscriber mutation failed for 1 subscriber: blocklist http_500",
			"Subscriber mutation failed for 1 subscriber: list_add negative_acknowledgement",
			"Subscriber mutation failed for 1 subscriber: list_add request_failed",
		]);
		expect(JSON.stringify(result)).not.toContain("remote-secret");
	});

	test("template registry sync propagates template query failures", async () => {
		const client = createWorkflowClient({
			template: {
				list: async () => ({ error: "template failure" }),
			},
		});

		await expect(syncTemplateRegistry(client)).rejects.toThrow(
			"Failed to list templates for template registry sync: template failure",
		);
	});
});
