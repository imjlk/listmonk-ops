import { beforeEach, describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { AbTestService } from "../src/abtest-service";
import {
	ListmonkAbTestIntegration,
	type ProvisionedAbTestResources,
} from "../src/listmonk-integration";
import { DEFAULT_STRATIFICATION_POLICY } from "../src/stratification";
import type { AbTest, AbTestConfig } from "../src/types";

function createTestConfig(): AbTestConfig {
	return {
		name: "Provisioning Test",
		campaignId: "campaign-1",
		variants: [
			{
				name: "A",
				percentage: 50,
				contentOverrides: {
					subject: "A subject",
					body: "A body",
				},
			},
			{
				name: "B",
				percentage: 50,
				contentOverrides: {
					subject: "B subject",
					body: "B body",
				},
			},
		],
		metrics: [
			{ name: "Open Rate", type: "open_rate" },
			{ name: "Click Rate", type: "click_rate" },
		],
		baseConfig: {
			subject: "Base subject",
			body: "Base body",
			lists: [1],
		},
		testingMode: "holdout",
		testGroupPercentage: 10,
	};
}

function createAbTestFixture(): AbTest {
	const now = new Date();

	return {
		id: "test_fixture",
		name: "Fixture",
		campaignId: "campaign-1",
		variants: [
			{
				id: "variant-a",
				name: "A",
				percentage: 50,
				contentOverrides: {},
			},
			{
				id: "variant-b",
				name: "B",
				percentage: 50,
				contentOverrides: {},
			},
		],
		metrics: [],
		status: "draft",
		createdAt: now,
		updatedAt: now,
		baseConfig: {
			subject: "Base subject",
			body: "Base body",
			lists: [1],
		},
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 0,
		holdoutGroupSize: 0,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [],
		testListMappings: [],
	};
}

describe("A/B test provisioning", () => {
	beforeEach(() => {
		process.env.LISTMONK_OPS_ABTEST_SILENT = "1";
	});

	test("createTestCampaigns rolls back previously created campaigns on partial failure", async () => {
		const deletedCampaigns: number[] = [];
		let createCount = 0;

		const client = {
			campaign: {
				create: async () => {
					createCount += 1;
					if (createCount === 1) {
						return { data: { id: 101 } };
					}
					return { error: "second campaign failed" };
				},
				delete: async ({ path }: { path: { id: number } }) => {
					deletedCampaigns.push(path.id);
					return { data: true };
				},
			},
		} as unknown as ListmonkClient;

		const integration = new ListmonkAbTestIntegration(client);

		await expect(
			integration.createTestCampaigns(createAbTestFixture(), {
				subject: "Base subject",
				body: "Base body",
				lists: [1],
			}),
		).rejects.toThrow(
			"Failed to create campaign for variant B: second campaign failed",
		);
		expect(deletedCampaigns).toEqual([101]);
	});

	test("createTest rejects and does not keep failed provisioning in memory", async () => {
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
			rollbackProvisioning: async (resources: ProvisionedAbTestResources) => {
				rollbackResources = resources;
			},
		} as unknown as ListmonkAbTestIntegration;

		const service = new AbTestService(integration);

		await expect(service.createTest(createTestConfig())).rejects.toThrow(
			"segmentation failed",
		);

		expect(rollbackResources).toBeDefined();
		expect(rollbackResources?.campaignIds).toEqual([201, 202]);
		expect(rollbackResources?.testListIds).toEqual([]);
		expect(rollbackResources?.holdoutListId).toBeUndefined();
		expect(rollbackResources?.testId).toContain("test_");
		// This unkeyed create has no replay path, so the failed provision
		// discards the draft instead of leaving an unreachable record.
		await expect(service.getAllTests()).resolves.toHaveLength(0);
	});
});

describe("deleteTestResources retry safety", () => {
	test("skips already-removed campaigns and lists and continues remaining cleanup", async () => {
		const deletedCampaigns: number[] = [];
		const deletedLists: number[] = [];
		const client = {
			campaign: {
				getById: async ({ path }: { path: { id: number } }) => {
					// Campaign 1 was already removed in the first attempt;
					// campaign 2 still needs cleanup.
					if (path.id === 1) {
						return {
							error: { message: "campaign not found" },
							response: { status: 404 },
						};
					}
					return { data: { id: path.id, status: "draft" } };
				},
				delete: async ({ path }: { path: { id: number } }) => {
					deletedCampaigns.push(path.id);
					return { data: true };
				},
			},
			list: {
				delete: async ({ path }: { path: { list_id: number } }) => {
					deletedLists.push(path.list_id);
					return { data: true };
				},
			},
		} as unknown as ListmonkClient;

		const integration = new ListmonkAbTestIntegration(client);
		await integration.deleteTestResources({
			campaignIds: [1, 2],
			listIds: [10, 11],
		});

		expect(deletedCampaigns).toEqual([2]);
		expect(deletedLists).toEqual([11, 10]);
	});
});

describe("segmentSubscribersForHoldout stratification", () => {
	type SubscriberRecord = {
		id: number;
		uuid: string;
		email: string;
		name: string;
		status: string;
		lists: { id: number; subscription_status: string; name: string }[];
	};

	function makeAudience(): SubscriberRecord[] {
		const domains: Record<string, number> = {
			"gmail.com": 60,
			"naver.com": 30,
			"example.com": 30,
		};
		const subscribers: SubscriberRecord[] = [];
		let id = 1;
		for (const [domain, count] of Object.entries(domains)) {
			for (let i = 0; i < count; i += 1) {
				subscribers.push({
					id,
					uuid: `strat-uuid-${String(id).padStart(4, "0")}`,
					email: `strat${id}@${domain}`,
					name: `Strat ${id}`,
					status: "enabled",
					lists: [
						{
							id: 1,
							subscription_status: "unconfirmed",
							name: "Source",
						},
					],
				});
				id += 1;
			}
		}
		return subscribers;
	}

	test("applies the quota matrix to the actual recipient slices", async () => {
		const audience = makeAudience();
		const createdLists: { id: number; tags: string[] }[] = [];
		const membershipByList = new Map<number, number[]>();
		let nextListId = 5001;

		const client = {
			subscriber: {
				list: async ({ query }: { query?: Record<string, unknown> }) => {
					const listId = Number(query?.list_id ?? 0);
					const page = Number(query?.page ?? 1);
					const perPage = Number(query?.per_page ?? 500);
					const scoped = audience.filter((subscriber) =>
						subscriber.lists.some((entry) => entry.id === listId),
					);
					const start = (page - 1) * perPage;
					const slice = scoped.slice(start, start + perPage);
					return {
						data: {
							results: slice,
							total: scoped.length,
							per_page: perPage,
							page,
						},
					};
				},
				manageLists: async ({
					body,
				}: {
					body: { action: string; ids: number[]; target_list_ids: number[] };
				}) => {
					for (const listId of body.target_list_ids) {
						const existing = membershipByList.get(listId) ?? [];
						membershipByList.set(listId, [...existing, ...body.ids]);
					}
					return { data: true };
				},
			},
			list: {
				create: async ({ body }: { body: { name: string; tags?: string[] } }) => {
					const id = nextListId;
					nextListId += 1;
					createdLists.push({ id, tags: body.tags ?? [] });
					return { data: { id, name: body.name } };
				},
			},
		} as unknown as ListmonkClient;

		const integration = new ListmonkAbTestIntegration(client);
		const result = await integration.segmentSubscribersForHoldout(
			[1],
			[
				{
					id: "variant-a",
					name: "A",
					percentage: 50,
					contentOverrides: {},
				},
				{
					id: "variant-b",
					name: "B",
					percentage: 50,
					contentOverrides: {},
				},
			],
			50,
			{
				testId: "strat-test",
				assignmentSeed: "strat-seed",
				stratificationPolicy: {
					...DEFAULT_STRATIFICATION_POLICY,
					enabled: true,
					minimumStratumSize: 2,
				},
			},
		);

		expect(result.stratification).toBeDefined();
		expect(result.testGroupSize + result.holdoutGroupSize).toBe(
			audience.length,
		);

		const emailById = new Map(audience.map((s) => [s.id, s.email]));
		const stratumOf = (id: number): string => {
			const email = emailById.get(id) ?? "";
			const domain = email.slice(email.lastIndexOf("@") + 1);
			if (domain === "gmail.com" || domain === "googlemail.com") return "gmail";
			if (domain === "naver.com") return "naver";
			return "other";
		};
		const groupKeyOfList = (listId: number): string => {
			const list = createdLists.find((entry) => entry.id === listId);
			const tags = list?.tags ?? [];
			if (tags.includes("abtest-role:holdout")) return "holdout";
			const variantTag = tags.find((tag) => tag.startsWith("abtest-variant:"));
			return variantTag ? `variant:${variantTag.slice("abtest-variant:".length)}` : "?";
		};

		const quotas = result.stratification?.quotas ?? {};
		for (const [listId, memberIds] of membershipByList) {
			const groupKey = groupKeyOfList(listId);
			const counts: Record<string, number> = {};
			for (const id of memberIds) {
				const stratum = stratumOf(id);
				counts[stratum] = (counts[stratum] ?? 0) + 1;
			}
			for (const [stratum, count] of Object.entries(counts)) {
				expect(count).toBe(quotas[stratum]?.[groupKey]);
			}
			const expectedTotal = Object.values(quotas).reduce(
				(sum, row) => sum + (row[groupKey] ?? 0),
				0,
			);
			expect(memberIds).toHaveLength(expectedTotal);
		}

		// Deterministic re-derivation under the same seed produces the same
		// membership, which is what crash-resume adoption relies on.
		const firstPassMemberships = [...membershipByList.entries()].map(
			([listId, memberIds]) => ({
				groupKey: groupKeyOfList(listId),
				memberIds: [...memberIds].sort((a, b) => a - b),
			}),
		);
		membershipByList.clear();
		createdLists.length = 0;
		nextListId = 6001;
		const rerun = await integration.segmentSubscribersForHoldout(
			[1],
			[
				{
					id: "variant-a",
					name: "A",
					percentage: 50,
					contentOverrides: {},
				},
				{
					id: "variant-b",
					name: "B",
					percentage: 50,
					contentOverrides: {},
				},
			],
			50,
			{
				testId: "strat-test",
				assignmentSeed: "strat-seed",
				stratificationPolicy: {
					...DEFAULT_STRATIFICATION_POLICY,
					enabled: true,
					minimumStratumSize: 2,
				},
			},
		);
		expect(rerun.stratification).toEqual(result.stratification);
		const rerunMemberships = [...membershipByList.entries()].map(
			([listId, memberIds]) => ({
				groupKey: groupKeyOfList(listId),
				memberIds: [...memberIds].sort((a, b) => a - b),
			}),
		);
		expect(rerunMemberships.sort((a, b) =>
			a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0,
		)).toEqual(
			firstPassMemberships.sort((a, b) =>
				a.groupKey < b.groupKey ? -1 : a.groupKey > b.groupKey ? 1 : 0,
			),
		);
	});
});
