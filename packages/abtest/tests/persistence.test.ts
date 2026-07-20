import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	AbTestNotFoundError,
	AbTestWriteTransactionError,
	loadStoredAbTests,
	saveStoredAbTests,
	withStoredAbTestExecutors,
} from "../src/persistence";
import type { AbTest } from "../src/types";

const temporaryDirectories: string[] = [];
const client = {} as ListmonkClient;

function createTest(id: string): AbTest {
	return {
		id,
		name: `Test ${id}`,
		campaignId: `campaign-${id}`,
		variants: [
			{
				id: `variant-a-${id}`,
				name: "A",
				percentage: 50,
				contentOverrides: {},
			},
			{
				id: `variant-b-${id}`,
				name: "B",
				percentage: 50,
				contentOverrides: {},
			},
		],
		status: "draft",
		metrics: [],
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		baseConfig: {
			subject: "Subject",
			body: "Body",
			lists: [1],
		},
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 100,
		holdoutGroupSize: 900,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [],
		testListMappings: [],
	};
}

async function createStorePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-"));
	temporaryDirectories.push(directory);
	return join(directory, "abtests.json");
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("A/B test persistence", () => {
	test("preserves concurrent updates to different tests", async () => {
		const storePath = await createStorePath();
		await saveStoredAbTests([createTest("one"), createTest("two")], storePath);

		await Promise.all([
			withStoredAbTestExecutors(
				client,
				{ mode: "write", storePath },
				async (executors) => {
					await Bun.sleep(5);
					await executors.abTestService.updateTestStatus("one", "running");
				},
			),
			withStoredAbTestExecutors(
				client,
				{ mode: "write", storePath },
				async (executors) => {
					await executors.abTestService.updateTestStatus("two", "completed");
				},
			),
		]);

		const statuses = Object.fromEntries(
			(await loadStoredAbTests(storePath)).map((test) => [test.id, test.status]),
		);
		expect(statuses).toEqual({ one: "running", two: "completed" });
	});

	test("hydrates persisted timestamps for direct store readers", async () => {
		const storePath = await createStorePath();
		const fixture = createTest("dated");
		const firstVariant = fixture.variants[0];
		if (!firstVariant) {
			throw new Error("Expected a fixture variant");
		}
		firstVariant.contentOverrides.sendTime = new Date(
			"2026-01-02T03:04:05.000Z",
		);
		await saveStoredAbTests([fixture], storePath);

		const loaded = await loadStoredAbTests(storePath);
		const loadedTest = loaded[0];
		const loadedVariant = loadedTest?.variants[0];

		expect(loadedTest?.createdAt).toBeInstanceOf(Date);
		expect(loadedTest?.updatedAt).toBeInstanceOf(Date);
		expect(loadedVariant?.contentOverrides.sendTime).toBeInstanceOf(Date);
		expect(loadedVariant?.contentOverrides.sendTime?.toISOString()).toBe(
			"2026-01-02T03:04:05.000Z",
		);
	});

	test("does not commit a failed mutation", async () => {
		const storePath = await createStorePath();
		await saveStoredAbTests([createTest("one")], storePath);
		const before = await readFile(storePath, "utf8");

		let transactionError: unknown;
		try {
			await withStoredAbTestExecutors(
				client,
				{ mode: "write", storePath },
				async (executors) => {
					await executors.abTestService.updateTestStatus("one", "running");
					throw new Error("remote operation failed");
				},
			);
		} catch (error) {
			transactionError = error;
		}

		expect(transactionError).toBeInstanceOf(AbTestWriteTransactionError);
		expect((transactionError as Error).message).toContain(
			"Listmonk may contain partial changes",
		);
		expect((transactionError as Error).message).toContain(
			"remote operation failed",
		);
		expect(await readFile(storePath, "utf8")).toBe(before);
	});

	test("rejects an unsupported store version without overwriting it", async () => {
		const storePath = await createStorePath();
		const unsupported = '{"version":2,"tests":[]}\n';
		await writeFile(storePath, unsupported, "utf8");

		await expect(loadStoredAbTests(storePath)).rejects.toThrow(
			"Invalid A/B test store: expected schema version 1",
		);
		expect(await readFile(storePath, "utf8")).toBe(unsupported);
	});

	test("rejects malformed collection entries", async () => {
		const storePath = await createStorePath();
		const malformedTest = {
			...createTest("one"),
			metrics: [{}],
		};
		await writeFile(
			storePath,
			`${JSON.stringify({ version: 1, tests: [malformedTest] })}\n`,
			"utf8",
		);

		await expect(loadStoredAbTests(storePath)).rejects.toThrow(
			"test 0 failed schema validation",
		);
	});

	test("preserves a plain not-found error without creating state", async () => {
		const storePath = await createStorePath();

		await expect(
			withStoredAbTestExecutors(
				client,
				{ mode: "write", storePath },
				() => {
					throw new AbTestNotFoundError("missing");
				},
			),
		).rejects.toBeInstanceOf(AbTestNotFoundError);
		expect(existsSync(storePath)).toBe(false);
	});

	test("rejects inconsistent persisted variant sets", async () => {
		const storePath = await createStorePath();
		const validTest = createTest("one");
		const firstVariant = validTest.variants[0];
		const secondVariant = validTest.variants[1];
		if (!firstVariant || !secondVariant) {
			throw new Error("Expected two fixture variants");
		}
		const invalidVariantSets = [
			[firstVariant, { ...secondVariant, percentage: 40 }],
			[firstVariant, { ...secondVariant, id: firstVariant.id }],
		];

		for (const variants of invalidVariantSets) {
			await writeFile(
				storePath,
				`${JSON.stringify({
					version: 1,
					tests: [{ ...validTest, variants }],
				})}\n`,
				"utf8",
			);
			await expect(loadStoredAbTests(storePath)).rejects.toThrow(
				"test 0 failed schema validation",
			);
		}
	});
});
