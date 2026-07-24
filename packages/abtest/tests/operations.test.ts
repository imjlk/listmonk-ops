import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	abTestOperations,
	invokeAnalyzeAbTestOperation,
	invokeCreateAbTestOperation,
	invokeDeleteAbTestOperation,
	invokeDeployAbTestWinnerOperation,
	invokeGetAbTestOperation,
	invokeLaunchAbTestOperation,
	invokeListAbTestsOperation,
	invokeReconcileAbTestOperation,
	invokeRecommendAbTestSampleSizeOperation,
	invokeRunAbTestOperation,
	invokeStopAbTestOperation,
	invokeTickAbTestsOperation,
	invokeExportAbTestAssignmentOperation,
	listAbTestsOperation,
} from "../src/operations";
import { AbTestNotFoundError, saveStoredAbTests } from "../src/persistence";
import type { AbTest } from "../src/types";

let tempDir: string | undefined;

function createFixture(status: AbTest["status"]): AbTest {
	const now = new Date("2026-01-01T00:00:00.000Z");
	return {
		id: `test-${status}`,
		name: `Fixture ${status}`,
		campaignId: "campaign-1",
		variants: [
			{
				id: "variant-a",
				name: "A",
				percentage: 50,
				contentOverrides: { sendTime: now },
			},
			{
				id: "variant-b",
				name: "B",
				percentage: 50,
				contentOverrides: {},
			},
		],
		status,
		metrics: [],
		createdAt: now,
		updatedAt: now,
		baseConfig: { subject: "Subject", body: "Body", lists: [1] },
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 10,
		holdoutGroupSize: 90,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [],
		testListMappings: [],
	};
}

afterEach(async () => {
	if (tempDir) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

describe("A/B test operation registry", () => {
	test("publishes all lifecycle tools with object schemas and safety metadata", () => {
		expect(abTestOperations).toHaveLength(13);
		expect(abTestOperations.map((operation) => operation.mcp.name)).toEqual([
			"listmonk_abtest_list",
			"listmonk_abtest_get",
			"listmonk_abtest_create",
			"listmonk_abtest_analyze",
			"listmonk_abtest_launch",
			"listmonk_abtest_stop",
			"listmonk_abtest_delete",
			"listmonk_abtest_recommend_sample_size",
			"listmonk_abtest_deploy_winner",
			"listmonk_abtest_run",
			"listmonk_abtest_tick",
			"listmonk_abtest_reconcile",
			"listmonk_abtest_export_assignment",
		]);
		for (const operation of abTestOperations) {
			expect(operation.inputJsonSchema.type).toBe("object");
			expect(operation.outputJsonSchema.type).toBe("object");
			expect(operation.mcp.name).toStartWith("listmonk_abtest_");
		}
		expect(listAbTestsOperation.safety.readOnlyHint).toBe(true);
		expect(
			abTestOperations.find(
				(operation) => operation.mcp.name === "listmonk_abtest_stop",
			)?.safety,
		).toMatchObject({ destructiveHint: true, idempotentHint: false });
		expect(
			abTestOperations.find(
				(operation) => operation.mcp.name === "listmonk_abtest_launch",
			)?.safety,
		).toMatchObject({ destructiveHint: true, idempotentHint: false });
		expect(
			abTestOperations.find(
				(operation) => operation.mcp.name === "listmonk_abtest_create",
			)?.safety,
		).toMatchObject({ destructiveHint: true, idempotentHint: false });
		expect(
			abTestOperations.find(
				(operation) =>
					operation.mcp.name === "listmonk_abtest_deploy_winner",
			)?.safety.idempotentHint,
		).toBe(false);
	});

	test("filters and serializes persisted tests through the shared invoker", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-operation-"));
		const storePath = join(tempDir, "abtests.json");
		await saveStoredAbTests(
			[createFixture("draft"), createFixture("completed")],
			storePath,
		);

		const result = await invokeListAbTestsOperation(
			{ client: {} as ListmonkClient, storePath },
			{ status: "draft" },
		);

		expect(result.tests).toHaveLength(1);
		expect(result.tests[0]?.status).toBe("draft");
		expect(result.tests[0]?.createdAt).toBe("2026-01-01T00:00:00.000Z");
		expect(result.tests[0]?.variants[0]?.contentOverrides.sendTime).toBe(
			"2026-01-01T00:00:00.000Z",
		);
	});

	test("uses shared input diagnostics across every named invoker", async () => {
		const context = { client: {} as ListmonkClient };

		await expect(
			invokeListAbTestsOperation(context, { status: "not-a-status" }),
		).rejects.toThrow("Invalid parameter status");
		await expect(invokeGetAbTestOperation(context, {})).rejects.toThrow(
			"Missing required parameter: test_id",
		);
		await expect(invokeCreateAbTestOperation(context, {})).rejects.toThrow(
			"Missing required parameter: name",
		);
		await expect(invokeAnalyzeAbTestOperation(context, {})).rejects.toThrow(
			"Missing required parameter: test_id",
		);
		await expect(invokeLaunchAbTestOperation(context, {})).rejects.toThrow(
			"Missing required parameter: test_id",
		);
		await expect(invokeStopAbTestOperation(context, {})).rejects.toThrow(
			"Missing required parameter: test_id",
		);
		await expect(invokeDeleteAbTestOperation(context, {})).rejects.toThrow(
			"Missing required parameter: test_id",
		);
		await expect(
			invokeRecommendAbTestSampleSizeOperation(context, {}),
		).rejects.toThrow("Missing required parameter: lists");
		await expect(
			invokeDeployAbTestWinnerOperation(context, {}),
		).rejects.toThrow("Missing required parameter: test_id");
		await expect(invokeRunAbTestOperation(context, {})).rejects.toThrow(
			"Missing required parameter: test_id",
		);
		// tick and reconcile have all-optional inputs, so drive them through a
		// deliberate validation failure to keep each invoker anchored.
		await expect(
			invokeTickAbTestsOperation(context, { confirm: "not-boolean" }),
		).rejects.toThrow("Invalid parameter confirm");
			await expect(
				invokeReconcileAbTestOperation(context, { confirm: "not-boolean" }),
			).rejects.toThrow("Invalid parameter confirm");
			await expect(
				invokeExportAbTestAssignmentOperation(context, { test_id: 123 }),
			).rejects.toThrow();
	});

	test("preserves typed not-found errors for lifecycle transitions", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-transition-"));
		const storePath = join(tempDir, "abtests.json");
		await saveStoredAbTests([], storePath);
		const context = { client: {} as ListmonkClient, storePath };

		await expect(
			invokeLaunchAbTestOperation(context, { test_id: "missing" }),
		).rejects.toMatchObject({
			cause: expect.any(AbTestNotFoundError),
		});
		await expect(
			invokeStopAbTestOperation(context, { test_id: "missing" }),
		).rejects.toMatchObject({
			cause: expect.any(AbTestNotFoundError),
		});
	});
});
