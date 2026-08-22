import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	abTestOperations,
	createAbTestOperation,
	exportAbTestAssignmentOperation,
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
	reconcileAbTestOperation,
	runAbTestOperation,
	tickAbTestsOperation,
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

function createMinimalOperationInput() {
	return {
		name: "Schema parity",
		lists: [1],
		variants: [
			{ name: "A", percentage: 50, campaign_config: {} },
			{ name: "B", percentage: 50, campaign_config: {} },
		],
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
		).toMatchObject({ destructiveHint: true, idempotentHint: true });
		expect(
			abTestOperations.find(
				(operation) => operation.mcp.name === "listmonk_abtest_launch",
			)?.safety,
		).toMatchObject({ destructiveHint: true, idempotentHint: true });
		expect(
			abTestOperations.find(
				(operation) => operation.mcp.name === "listmonk_abtest_delete",
			)?.safety,
		).toMatchObject({ destructiveHint: true, idempotentHint: true });
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

	test("publishes optional create defaults, numeric bounds, and product-only inputs", () => {
		expect(createAbTestOperation.inputJsonSchema.required).toEqual([
			"name",
			"lists",
			"variants",
		]);
		expect(
			createAbTestOperation.inputJsonSchema.properties?.test_group_percentage,
		).toMatchObject({
			type: "number",
			exclusiveMinimum: 0,
			maximum: 100,
		});
		expect(
			createAbTestOperation.inputJsonSchema.properties?.confidence_threshold,
		).toMatchObject({
			type: "number",
			exclusiveMinimum: 0,
			exclusiveMaximum: 1,
		});
		expect(
			createAbTestOperation.inputJsonSchema.properties?.minimum_sample_size,
		).toMatchObject({ type: "integer", exclusiveMinimum: 0 });
		expect(
			createAbTestOperation.inputJsonSchema.properties?.duration_hours,
		).toMatchObject({ type: "number", exclusiveMinimum: 0 });

		expect(
			createAbTestOperation.inputSchema.safeParse(
				createMinimalOperationInput(),
			).success,
		).toBe(true);
		for (const invalid of [
			{ test_group_percentage: 0 },
			{ confidence_threshold: 0 },
			{ confidence_threshold: 1 },
			{ minimum_sample_size: 0 },
			{ duration_hours: 0 },
		]) {
			expect(
				createAbTestOperation.inputSchema.safeParse({
					...createMinimalOperationInput(),
					...invalid,
				}).success,
			).toBe(false);
		}

		expect(runAbTestOperation.inputJsonSchema.required).toEqual(["test_id"]);
		expect(runAbTestOperation.inputJsonSchema.properties).not.toHaveProperty(
			"confirm",
		);
		expect(tickAbTestsOperation.inputJsonSchema.required).toBeUndefined();
		expect(tickAbTestsOperation.inputJsonSchema.properties).not.toHaveProperty(
			"confirm",
		);
		expect(reconcileAbTestOperation.inputJsonSchema.required).toBeUndefined();
		expect(
			reconcileAbTestOperation.inputJsonSchema.properties,
		).not.toHaveProperty("confirm");
		expect(exportAbTestAssignmentOperation.inputJsonSchema.required).toEqual([
			"test_id",
		]);
		expect(
			exportAbTestAssignmentOperation.inputJsonSchema.properties,
		).not.toHaveProperty("confirm");
		expect(
			exportAbTestAssignmentOperation.outputJsonSchema.properties?.manifest,
		).toMatchObject({
			type: "object",
			required: [
				"algorithm",
				"seed",
				"audienceChecksum",
				"groups",
				"assignedCount",
			],
		});
		expect(
			exportAbTestAssignmentOperation.outputSchema.safeParse({
				manifest: {
					algorithm: "sha256-order-largest-remainder-v1",
					seed: "seed-1",
					audienceChecksum: "audience-checksum",
					groups: [
						{
							kind: "variant",
							expectedCount: 1,
							subscriberChecksum: "subscriber-checksum",
						},
					],
					assignedCount: 1,
				},
			}).success,
		).toBe(false);
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
			invokeTickAbTestsOperation(context, { dry_run: "not-boolean" }),
		).rejects.toThrow("Invalid parameter dry_run");
			await expect(
				invokeReconcileAbTestOperation(context, { repair: "not-boolean" }),
			).rejects.toThrow("Invalid parameter repair");
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

test("reuses the persisted launch window after an ambiguous partial launch", async () => {
	tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-ambiguous-"));
	const storePath = join(tempDir, "abtests.json");
	const fixture = createFixture("draft");
	fixture.campaignMappings = [{ variantId: "A", campaignId: 7 }];
	fixture.testListMappings = [{ variantId: "A", listId: 5 }];
	await saveStoredAbTests([fixture], storePath);

	let updateCalls = 0;
	const scheduledSendAts: Array<string | undefined> = [];
	const client = {
		campaign: {
			update: async ({ body }: { body: { send_at?: string } }) => {
				updateCalls += 1;
				scheduledSendAts.push(body.send_at);
				if (updateCalls === 1) {
					return { error: { message: "transient scheduling failure" } };
				}
				return { data: true };
			},
			updateStatus: async () => ({ data: true }),
		},
	} as unknown as ListmonkClient;
	const context = { client, storePath };

	await expect(
		invokeLaunchAbTestOperation(context, { test_id: fixture.id }),
	).rejects.toThrow(/Failed to update campaign 7/);

	// The launch intent survived the failed attempt...
	const persistedIntent = await invokeGetAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(persistedIntent.test.status).toBe("draft");
	const recordedWindow = persistedIntent.test.launchAt;
	expect(recordedWindow).toBeDefined();

	// ...so the retry schedules with the same send window, not a new one.
	const retried = await invokeLaunchAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(retried.test.status).toBe("scheduled");
	expect(retried.test.launchAt).toBe(recordedWindow);
	expect(scheduledSendAts).toEqual([recordedWindow, recordedWindow]);
});

test("repeats recorded launches and completed stops as no-ops", async () => {
	tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-lifecycle-"));
	const storePath = join(tempDir, "abtests.json");
	const fixture = createFixture("draft");
	await saveStoredAbTests([fixture], storePath);
	const context = { client: {} as ListmonkClient, storePath };

	const launched = await invokeLaunchAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(launched.test.status).toBe("scheduled");
	expect(launched.test.startedAt).toBeDefined();

	const relaunched = await invokeLaunchAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(relaunched.test.status).toBe("scheduled");
	expect(relaunched.test.started_at).toBe(launched.test.started_at);

	const stopped = await invokeStopAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(stopped.test.status).toBe("cancelled");
	const stoppedAgain = await invokeStopAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(stoppedAgain.test.status).toBe("cancelled");
	expect(stoppedAgain.test.updatedAt).toBe(stopped.test.updatedAt);
});

	test("reconciles tagged campaigns on create resume instead of duplicating", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-reconcile-"));
		const storePath = join(tempDir, "abtests.json");
		await saveStoredAbTests([], storePath);

		const createdCampaigns: Array<{ id: number; tags: string[] }> = [];
		const createdLists: Array<{ id: number; tags: string[] }> = [];
		let campaignCreates = 0;
		let listCreates = 0;
		let segmentationShouldFail = true;
		const client = {
			subscriber: {
				list: async () => ({
					data: {
						results: [
							{
								id: 1,
								uuid: "33333333-3333-4333-8333-333333333333",
								email: "member@example.com",
								status: "enabled",
							},
						],
					},
				}),
				manageLists: async () => ({ data: true }),
			},
			list: {
				list: async () => ({
					data: {
						// Both lists created by the first attempt are
						// discoverable by their abtest tags on retry.
						results: createdLists,
					},
				}),
				create: async ({
					body,
				}: {
					body?: { name?: string; tags?: string[] };
				}) => {
					listCreates += 1;
					const id = 860 + listCreates;
					createdLists.push({ id, tags: body?.tags ?? [] });
					if (segmentationShouldFail && listCreates === 3) {
						// Crash after the holdout and first variant lists were
						// tagged but before the checkpoint committed.
						segmentationShouldFail = false;
						throw new Error("transient segmentation failure");
					}
					return { data: { id, name: body?.name } };
				},
				delete: async () => ({ data: true }),
			},
			campaign: {
				list: async () => ({ data: { results: createdCampaigns } }),
				create: async ({
					body,
				}: {
					body?: { name?: string; tags?: string[] };
				}) => {
					campaignCreates += 1;
					const id = 950 + campaignCreates;
					createdCampaigns.push({ id, tags: body?.tags ?? [] });
					return { data: { id, name: body?.name } };
				},
				update: async () => ({ data: true }),
				delete: async () => ({ data: true }),
			},
			template: {
				getById: async () => ({
					data: { id: 1, name: "Base", type: "campaign", body: "<p>x</p>" },
				}),
			},
		} as unknown as ListmonkClient;

		const createInput = {
			name: "reconcile-test",
			lists: [1],
			variants: [
				{ name: "A", percentage: 50, campaign_config: { subject: "A", body: "a" } },
				{ name: "B", percentage: 50, campaign_config: { subject: "B", body: "b" } },
			],
		};

		// First attempt creates both campaigns, then fails at segmentation
		// after the campaign checkpoint committed.
		await expect(
			invokeCreateAbTestOperation({ client, storePath }, createInput),
		).rejects.toThrow();
		expect(campaignCreates).toBe(2);

		// The retry reconciles the tagged campaigns and adopts the tagged
		// lists (seeded identically by the committed seed checkpoint)
		// instead of re-creating either.
		const listCreatesBefore = listCreates;
		const resumed = await invokeCreateAbTestOperation(
			{ client, storePath },
			createInput,
		);
		expect(resumed.created).toBe(true);
		expect(campaignCreates).toBe(2);
		expect(listCreates).toBe(listCreatesBefore);
		expect(resumed.test.campaignMappings).toHaveLength(2);
		expect(resumed.test.testListMappings.length).toBeGreaterThan(0);
		expect(resumed.test.provisionedAt).toBeDefined();
	});

test("resumes an ambiguous create from its persisted intent", async () => {
	tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-intent-"));
	const storePath = join(tempDir, "abtests.json");
	await saveStoredAbTests([], storePath);

	let campaignCreates = 0;
	let provisioningShouldFail = true;
	const client = {
		subscriber: {
			list: async () => ({
				data: {
					results: [
						{
							id: 1,
							uuid: "22222222-2222-4222-8222-222222222222",
							email: "member@example.com",
							status: "enabled",
						},
					],
				},
			}),
			manageLists: async () => ({ data: true }),
		},
		list: {
			list: async () => ({ data: { results: [] } }),
			create: async ({ body }: { body?: { name?: string } }) => ({
				data: { id: 800 + Math.floor(Math.random() * 100), name: body?.name },
			}),
			delete: async () => ({ data: true }),
		},
		campaign: {
			list: async () => ({ data: { results: [] } }),
			create: async ({ body }: { body?: { name?: string } }) => {
				campaignCreates += 1;
				if (provisioningShouldFail && campaignCreates === 1) {
					return { error: { message: "transient campaign failure" } };
				}
				return {
					data: { id: 800 + Math.floor(Math.random() * 100), name: body?.name },
				};
			},
			update: async () => ({ data: true }),
			delete: async () => ({ data: true }),
		},
		template: {
			getById: async () => ({
				data: { id: 1, name: "Base", type: "campaign", body: "<p>x</p>" },
			}),
		},
	} as unknown as ListmonkClient;
	const context = { client, storePath };

	const createInput = {
		name: "intent-resume-test",
		lists: [1],
		variants: [
			{ name: "A", percentage: 50, campaign_config: { subject: "A", body: "a" } },
			{ name: "B", percentage: 50, campaign_config: { subject: "B", body: "b" } },
		],
	};

	await expect(
		invokeCreateAbTestOperation(context, createInput),
	).rejects.toThrow();

	// The intent survived the failed provisioning with its replay key.
	const persisted = await invokeGetAbTestOperation(context, {
		test_id: (
			await invokeListAbTestsOperation(context, {})
		).tests[0]!.id,
	});
	expect(persisted.test.status).toBe("draft");
	expect(persisted.test.provisionedAt).toBeUndefined();

	// The retry resumes the SAME test and completes provisioning.
	provisioningShouldFail = false;
	const resumed = await invokeCreateAbTestOperation(context, createInput);
	expect(resumed.created).toBe(true);
	expect(resumed.test.id).toBe(persisted.test.id);

	// A further identical retry is a completed replay.
	const replayed = await invokeCreateAbTestOperation(context, createInput);
	expect(replayed.created).toBe(false);
	expect(replayed.test.id).toBe(persisted.test.id);
	expect(replayed.test.provisionedAt).toBeDefined();
});

test("blocks launch and stop while a create intent is still provisioning", async () => {
	tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-guard-"));
	const storePath = join(tempDir, "abtests.json");
	const fixture = createFixture("draft");
	fixture.pendingCreate = {
		config: {
			name: fixture.name,
			campaignId: "campaign-auto",
			variants: [],
			metrics: [],
			baseConfig: { subject: "s", body: "b", lists: [] },
		} as unknown as import("../src/types").AbTestConfig,
	};
	await saveStoredAbTests([fixture], storePath);
	const context = { client: {} as ListmonkClient, storePath };

	await expect(
		invokeLaunchAbTestOperation(context, { test_id: fixture.id }),
	).rejects.toThrow(/still being provisioned/);
	await expect(
		invokeStopAbTestOperation(context, { test_id: fixture.id }),
	).rejects.toThrow(/still being provisioned/);
});

test("replays an identical create through its derived replay key", async () => {
	tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-create-"));
	const storePath = join(tempDir, "abtests.json");
	await saveStoredAbTests([], storePath);
	const client = {
		subscriber: {
			list: async () => ({
				data: {
					results: [
						{
							id: 1,
							uuid: "11111111-1111-4111-8111-111111111111",
							email: "member@example.com",
							status: "enabled",
						},
					],
				},
			}),
			manageLists: async () => ({ data: true }),
		},
		list: {
			list: async () => ({ data: { results: [] } }),
			create: async ({ body }: { body?: { name?: string } }) => ({
				data: { id: 900 + Math.floor(Math.random() * 100), name: body?.name },
			}),
			delete: async () => ({ data: true }),
		},
		campaign: {
			list: async () => ({ data: { results: [] } }),
			create: async ({ body }: { body?: { name?: string } }) => ({
				data: { id: 900 + Math.floor(Math.random() * 100), name: body?.name },
			}),
			update: async () => ({ data: true }),
			delete: async () => ({ data: true }),
		},
		template: {
			getById: async () => ({
				data: { id: 1, name: "Base", type: "campaign", body: "<p>x</p>" },
			}),
		},
	} as unknown as ListmonkClient;
	const context = { client, storePath };

	const createInput = {
		name: "replay-key-test",
		lists: [1],
		variants: [
			{ name: "A", percentage: 50, campaign_config: { subject: "A", body: "a" } },
			{ name: "B", percentage: 50, campaign_config: { subject: "B", body: "b" } },
		],
	};
	const first = await invokeCreateAbTestOperation(context, createInput);
	expect(first.created).toBe(true);
	const replayed = await invokeCreateAbTestOperation(context, createInput);
	expect(replayed.created).toBe(false);
	expect(replayed.test.id).toBe(first.test.id);

	const second = await invokeCreateAbTestOperation(context, {
		...createInput,
		name: "replay-key-test-2",
	});
	expect(second.created).toBe(true);
	expect(second.test.id).not.toBe(first.test.id);
});

test("reports a repeated delete as a documented no-op", async () => {
	tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-delete-"));
	const storePath = join(tempDir, "abtests.json");
	const fixture = createFixture("completed");
	await saveStoredAbTests([fixture], storePath);
	const context = { client: {} as ListmonkClient, storePath };

	const first = await invokeDeleteAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(first).toEqual({ deleted: true });
	const retried = await invokeDeleteAbTestOperation(context, {
		test_id: fixture.id,
	});
	expect(retried).toEqual({ deleted: false });
});

test("rejects an A/B test changed after approval before progressing it", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-run-"));
		const storePath = join(tempDir, "abtests.json");
		const fixture = createFixture("scheduled");
		fixture.launchAt = "2026-01-01T00:00:00.000Z";
		await saveStoredAbTests([fixture], storePath);
		const context = { client: {} as ListmonkClient, storePath };

		await expect(
			invokeRunAbTestOperation(context, {
				test_id: fixture.id,
				expected_status: "scheduled",
				expected_updated_at: "2026-01-02T00:00:00.000Z",
			}),
		).rejects.toThrow("changed after approval");

		const persisted = await invokeGetAbTestOperation(context, {
			test_id: fixture.id,
		});
		expect(persisted.test.status).toBe("scheduled");
		expect(persisted.test.updatedAt).toBe("2026-01-01T00:00:00.000Z");
	});

test("requires the canonical UTC revision token emitted by A/B inspection", () => {
		const runOperation = abTestOperations.find(
			(operation) => operation.id === "abtest.run",
		);
		const baseInput = {
			test_id: "test-canonical-revision",
			expected_status: "analyzing",
		};

		expect(
			runOperation?.inputSchema.safeParse({
				...baseInput,
				expected_updated_at: "2026-07-30T18:00:00.000Z",
			}).success,
		).toBe(true);
		expect(
			runOperation?.inputSchema.safeParse({
				...baseInput,
				expected_updated_at: "2026-07-31T03:00:00+09:00",
			}).success,
		).toBe(false);
	});
});
