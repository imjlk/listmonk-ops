import { describe, expect, it } from "bun:test";
import { bumpRevision, type AbTestStoreAdapter } from "../src/store-adapter";
import { InMemoryAbTestStore } from "../src/store-adapters";
import type { AbTest } from "../src/types";

function makeTest(id: string, overrides: Partial<AbTest> = {}): AbTest {
	return {
		id,
		name: `Test ${id}`,
		campaignId: `campaign-${id}`,
		variants: [
			{ id: "A", name: "A", percentage: 50, contentOverrides: {} },
			{ id: "B", name: "B", percentage: 50, contentOverrides: {} },
		],
		status: "draft",
		metrics: [],
		createdAt: new Date(),
		updatedAt: new Date(),
		baseConfig: { subject: "s", body: "b", lists: [1], template_id: 1 },
		testingMode: "holdout",
		testGroupPercentage: 10,
		testGroupSize: 0,
		holdoutGroupSize: 0,
		confidenceThreshold: 0.95,
		autoDeployWinner: false,
		campaignMappings: [],
		testListMappings: [],
		...overrides,
	} as AbTest;
}

describe("bumpRevision", () => {
	it("increments revision from undefined", () => {
		const test = makeTest("t1");
		expect(test.revision).toBeUndefined();
		bumpRevision(test);
		expect(test.revision).toBe(1);
	});

	it("increments existing revision", () => {
		const test = makeTest("t1", { revision: 5 });
		bumpRevision(test);
		expect(test.revision).toBe(6);
	});

	it("updates updatedAt", () => {
		const test = makeTest("t1");
		const oldUpdated = test.updatedAt;
		bumpRevision(test);
		expect(test.updatedAt.getTime()).toBeGreaterThanOrEqual(
			oldUpdated.getTime(),
		);
	});
});

describe("InMemoryAbTestStore", () => {
	it("gets a test by id", async () => {
		const store = new InMemoryAbTestStore([makeTest("t1")]);
		const test = await store.get("t1");
		expect(test?.id).toBe("t1");
	});

	it("returns null for missing test", async () => {
		const store = new InMemoryAbTestStore([makeTest("t1")]);
		expect(await store.get("missing")).toBeNull();
	});

	it("lists all tests", async () => {
		const store = new InMemoryAbTestStore([
			makeTest("t1"),
			makeTest("t2"),
		]);
		const tests = await store.list();
		expect(tests).toHaveLength(2);
	});

	it("filters by status", async () => {
		const store = new InMemoryAbTestStore([
			makeTest("t1", { status: "running" }),
			makeTest("t2", { status: "completed" }),
		]);
		const running = await store.list({ status: "running" });
		expect(running).toHaveLength(1);
		expect(running[0]?.id).toBe("t1");
	});

	it("creates a test via transaction", async () => {
		const store = new InMemoryAbTestStore([]);
		const result = await store.transaction("t1", async (current) => {
			expect(current).toBeNull();
			return { next: makeTest("t1"), result: "created" };
		});
		expect(result).toBe("created");
		expect(await store.get("t1")).not.toBeNull();
	});

	it("updates a test via transaction with revision bump", async () => {
		const store = new InMemoryAbTestStore([makeTest("t1")]);
		await store.transaction("t1", async (current) => {
			const updated = { ...current!, name: "Updated" };
			return { next: updated, result: "updated" };
		});
		const test = await store.get("t1");
		expect(test?.name).toBe("Updated");
		expect(test?.revision).toBe(1);
	});

	it("deletes a test via transaction", async () => {
		const store = new InMemoryAbTestStore([makeTest("t1")]);
		await store.transaction("t1", async () => ({
			next: null,
			result: "deleted",
		}));
		expect(await store.get("t1")).toBeNull();
	});

	it("transactionAll snapshots and replaces all tests", async () => {
		const store = new InMemoryAbTestStore([
			makeTest("t1"),
			makeTest("t2"),
		]);
		const result = await store.transactionAll(async (tests) => ({
			next: [...tests, makeTest("t3")],
			result: tests.length,
		}));
		expect(result).toBe(2);
		expect(await store.list()).toHaveLength(3);
	});

	it("transactionAll skips write when next === current", async () => {
		const store = new InMemoryAbTestStore([makeTest("t1")]);
		const result = await store.transactionAll(async (tests) => ({
			next: tests,
			result: "noop",
		}));
		expect(result).toBe("noop");
		expect(await store.list()).toHaveLength(1);
	});

	it("concurrent transactions on the same test serialize", async () => {
		const store = new InMemoryAbTestStore([makeTest("t1")]);
		const results = await Promise.all([
			store.transaction("t1", async (current) => ({
				next: { ...current!, name: "A" },
				result: "A",
			})),
			store.transaction("t1", async (current) => ({
				next: { ...current!, name: "B" },
				result: "B",
			})),
		]);
		// Both should succeed (in-memory is single-threaded).
		expect(results).toEqual(["A", "B"]);
		// The last writer wins.
		const test = await store.get("t1");
		expect(["A", "B"]).toContain(test?.name);
	});
});
