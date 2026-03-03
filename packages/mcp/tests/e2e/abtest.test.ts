import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createMCPTestSuite } from "../mcp-helper.js";
import "../setup.js";

const ABTEST_STORE_PATH = `/tmp/listmonk-ops-mcp-abtest-${process.pid}-${Date.now()}.json`;
process.env.LISTMONK_OPS_ABTEST_STORE = ABTEST_STORE_PATH;
process.env.LISTMONK_OPS_ABTEST_SILENT = "1";

describe("A/B Test MCP Tools", () => {
	const { client, utils } = createMCPTestSuite();
	let createdTestId: string | null = null;

	afterAll(async () => {
		if (createdTestId) {
			await client.callTool("listmonk_abtest_delete", {
				test_id: createdTestId,
			});
		}
		await rm(ABTEST_STORE_PATH, { force: true });
	});

	test("should create, inspect, analyze, launch, stop, and delete an A/B test", async () => {
		const suffix = Date.now();
		const createResult = await client.callTool("listmonk_abtest_create", {
			name: `MCP-ABTest-${suffix}`,
			campaign_id: "1",
			lists: [1],
			variants: [
				{
					name: "Variant A",
					percentage: 50,
					campaign_config: {
						subject: `MCP AB Subject A ${suffix}`,
						body: `<p>MCP AB body A ${suffix}</p>`,
					},
				},
				{
					name: "Variant B",
					percentage: 50,
					campaign_config: {
						subject: `MCP AB Subject B ${suffix}`,
						body: `<p>MCP AB body B ${suffix}</p>`,
					},
				},
			],
			testing_mode: "holdout",
			test_group_percentage: 10,
		});

		const created = utils.assertSuccess<{ id: string; status: string }>(
			createResult,
			"Failed to create A/B test",
		);
		createdTestId = created.id;
		expect(created.id).toContain("test_");
		expect(created.status).toBe("draft");

		const listResult = await client.callTool("listmonk_abtest_list", {
			status: "draft",
		});
		const listed = utils.assertSuccess<Array<{ id: string }>>(
			listResult,
			"Failed to list A/B tests",
		);
		expect(listed.some((testEntry) => testEntry.id === created.id)).toBe(true);

		const getResult = await client.callTool("listmonk_abtest_get", {
			test_id: created.id,
		});
		const fetched = utils.assertSuccess<{ id: string; status: string }>(
			getResult,
			"Failed to fetch A/B test",
		);
		expect(fetched.id).toBe(created.id);
		expect(fetched.status).toBe("draft");

		const recommendationResult = await client.callTool(
			"listmonk_abtest_recommend_sample_size",
			{
				lists: [1],
				test_group_percentage: 10,
				variant_count: 2,
			},
		);
		const recommendation = utils.assertSuccess<{ isValid: boolean }>(
			recommendationResult,
			"Failed to get sample-size recommendation",
		);
		expect(typeof recommendation.isValid).toBe("boolean");

		const analysisResult = await client.callTool("listmonk_abtest_analyze", {
			test_id: created.id,
		});
		const analysis = utils.assertSuccess<{
			testId: string;
			results: unknown[];
		}>(analysisResult, "Failed to analyze A/B test");
		expect(analysis.testId).toBe(created.id);
		expect(Array.isArray(analysis.results)).toBe(true);

		const launchResult = await client.callTool("listmonk_abtest_launch", {
			test_id: created.id,
		});
		const launched = utils.assertSuccess<{ status: string }>(
			launchResult,
			"Failed to launch A/B test",
		);
		expect(launched.status).toBe("running");

		const stopResult = await client.callTool("listmonk_abtest_stop", {
			test_id: created.id,
		});
		const stopped = utils.assertSuccess<{ status: string }>(
			stopResult,
			"Failed to stop A/B test",
		);
		expect(stopped.status).toBe("completed");

		const deleteResult = await client.callTool("listmonk_abtest_delete", {
			test_id: created.id,
		});
		const deleted = utils.assertSuccess<{ deleted: boolean }>(
			deleteResult,
			"Failed to delete A/B test",
		);
		expect(deleted.deleted).toBe(true);
		createdTestId = null;
	});

	test("should validate required params for A/B test tools", async () => {
		const testCases = [
			{
				tool: "listmonk_abtest_get",
				args: {},
				expectedError: "Missing required parameter: test_id",
			},
			{
				tool: "listmonk_abtest_create",
				args: {},
				expectedError: "Missing required parameter: name",
			},
			{
				tool: "listmonk_abtest_launch",
				args: {},
				expectedError: "Missing required parameter: test_id",
			},
			{
				tool: "listmonk_abtest_recommend_sample_size",
				args: { lists: [1] },
				expectedError: "Missing required parameter: test_group_percentage",
			},
		];

		for (const testCase of testCases) {
			const result = await client.callTool(testCase.tool, testCase.args);
			utils.assertError(result, testCase.expectedError);
		}
	});
});
