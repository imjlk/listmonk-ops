import { describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { runCampaignPreflight } from "../src/campaign";
import { generateDailyDigest } from "../src/digest";
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
