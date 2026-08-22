import { describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { runCampaignPreflight } from "../src/campaign";
import { generateDailyDigest } from "../src/digest";
import { runSubscriberHygiene } from "../src/hygiene";
import { runSegmentDriftSnapshot } from "../src/segment-drift";
import { syncTemplateRegistry } from "../src/template-registry";

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
		const client = {
			subscriber: {
				list: async () => ({
					data: {
						results: [
							{
								id: 101,
								email: "a@old.test",
								status: "enabled",
								updated_at: "2020-01-01T00:00:00Z",
							},
							{
								id: 102,
								email: "b@old.test",
								status: "enabled",
								updated_at: "2020-01-01T00:00:00Z",
							},
							{
								id: 103,
								email: "c@recent.test",
								status: "enabled",
								updated_at: new Date().toISOString(),
							},
						],
					},
				}),
				manageBlocklistById: async ({ path }: { path: { id: number } }) => {
					blocklisted.push(path.id);
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

	test("redacts subscriber identifiers and remote mutation errors from hygiene results", async () => {
		const client = createWorkflowClient({
			subscriber: {
				list: async () => ({
					data: {
						results: [
							{
								id: 999,
								email: "private@example.com",
								status: "enabled",
								updated_at: "2020-01-01T00:00:00Z",
								lists: [],
							},
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
			dryRun: false,
		});
		expect(result.errors).toEqual(["Subscriber mutation failed"]);
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
