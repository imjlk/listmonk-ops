import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { handleAbTestTools } from "../../src/handlers/abtest.js";
import { loadStoredTests } from "../../src/utils/abtest-store.js";

let tempDir: string | undefined;
let previousStorePath: string | undefined;
let previousSilentEnv: string | undefined;

afterEach(async () => {
	if (previousStorePath === undefined) {
		delete process.env.LISTMONK_OPS_ABTEST_STORE;
	} else {
		process.env.LISTMONK_OPS_ABTEST_STORE = previousStorePath;
	}
	previousStorePath = undefined;
	if (previousSilentEnv === undefined) {
		delete process.env.LISTMONK_OPS_ABTEST_SILENT;
	} else {
		process.env.LISTMONK_OPS_ABTEST_SILENT = previousSilentEnv;
	}
	previousSilentEnv = undefined;

	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("mcp abtest persistence", () => {
	test("failed A/B test creation does not persist store state", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-mcp-unit-"));
		const storePath = join(tempDir, "abtests.json");
		previousStorePath = process.env.LISTMONK_OPS_ABTEST_STORE;
		previousSilentEnv = process.env.LISTMONK_OPS_ABTEST_SILENT;
		process.env.LISTMONK_OPS_ABTEST_STORE = storePath;
		process.env.LISTMONK_OPS_ABTEST_SILENT = "1";

		const client = {
			list: {
				getById: async () => ({
					data: { id: 1, subscriber_count: 1000 },
				}),
			},
			campaign: {
				create: async () => ({ error: "campaign creation failed" }),
			},
		} as unknown as ListmonkClient;

		const result = await handleAbTestTools(
			{
				method: "tools/call",
				params: {
					name: "listmonk_abtest_create",
					arguments: {
						name: "Unit Test Failure",
						lists: [1],
						variants: [
							{
								name: "A",
								percentage: 50,
								campaign_config: {
									subject: "Subject A",
									body: "Body A",
								},
							},
							{
								name: "B",
								percentage: 50,
								campaign_config: {
									subject: "Subject B",
									body: "Body B",
								},
							},
						],
					},
				},
			},
			client,
		);

		expect(result.isError).toBe(true);
		expect(result.content?.[0]?.text).toContain("campaign creation failed");
		expect(existsSync(storePath)).toBe(false);
		await expect(loadStoredTests()).resolves.toEqual([]);
	});
});
