import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAbTestExecutors } from "../src/factory";
import {
	invokeDeleteAbTestOperation,
	invokeGetAbTestOperation,
	invokeListAbTestsOperation,
	invokeTickAbTestsOperation,
} from "../src/operations";
import {
	isOptOutSyncDue,
	isOptOutSyncTracked,
	OPT_OUT_SYNC_INTERVAL_MS,
	OPT_OUT_SYNC_LONG_TAIL_INTERVAL_MS,
	OPT_OUT_SYNC_RECENT_PERIOD_MS,
	syncAbTestOptOuts,
} from "../src/optout-sync";
import {
	loadStoredAbTests,
	saveStoredAbTests,
	withStoredAbTestExecutors,
} from "../src/persistence";
import type { AbTest } from "../src/types";
import {
	createFakeListmonk,
	type FakeListmonk,
	makeTest,
	SOURCE_A,
	SOURCE_B,
	seedAbTestAudience,
} from "./support/listmonk-optout-fake";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * A holdout test that finished: variant campaigns 100/101 sent to lists
 * 200/201 and the winner campaign 300 sent to holdout list 202. Every list
 * is kept, so their unsubscribe links keep recording opt-outs there.
 */
function completedTest(overrides: Partial<AbTest> = {}): AbTest {
	const now = new Date();
	return makeTest({
		status: "completed",
		winnerCampaignId: 300,
		winnerVariantId: "variant-a",
		createdAt: now,
		updatedAt: now,
		...overrides,
	});
}

let tempDir: string | undefined;
let warnSpy: ReturnType<typeof spyOn> | undefined;

async function createStorePath(): Promise<string> {
	tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-optout-sync-"));
	return join(tempDir, "abtests.json");
}

afterEach(async () => {
	warnSpy?.mockRestore();
	warnSpy = undefined;
	if (tempDir !== undefined) {
		await rm(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

/** Every list an unsubscribe request targeted, so tests can bound them. */
function targetedListIds(fake: FakeListmonk): number[] {
	return [
		...new Set(fake.unsubscribes.flatMap((request) => request.target_list_ids)),
	].sort((left, right) => left - right);
}

describe("syncAbTestOptOuts on kept temporary lists", () => {
	test("carries a completed test's winner opt-outs and keeps every list", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		const test = completedTest();

		const { result, state } = await syncAbTestOptOuts(fake.client, test);

		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
		expect(fake.deletedLists).toEqual([]);
		expect(result).toMatchObject({
			testId: "test_optout",
			testStatus: "completed",
			deleted: false,
			sourceListIds: [SOURCE_A, SOURCE_B],
			ok: true,
		});
		expect(
			result.lists.map((list) => [list.listId, list.status, list.carriedCount]),
		).toEqual([
			[200, "no_opt_outs", 0],
			[201, "no_opt_outs", 0],
			[202, "propagated", 1],
		]);
		expect(state?.settledSubscriberIds).toEqual([13]);
		expect(state?.syncedAt).toBeDefined();
	});

	test("repeated syncs never unsubscribe a person who re-subscribed again", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		const test = completedTest();

		const first = await syncAbTestOptOuts(fake.client, test);
		test.optOutSync = first.state;
		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
		const writesAfterFirstSync = fake.unsubscribes.length;

		// A week later the person re-subscribes through the public form; the
		// holdout membership still says unsubscribed.
		fake.advanceClock(7 * DAY);
		fake.resubscribeViaForm(13, SOURCE_B);
		const second = await syncAbTestOptOuts(fake.client, test);
		test.optOutSync = second.state;
		const third = await syncAbTestOptOuts(fake.client, test);

		expect(fake.membership(13, SOURCE_B)).toBe("unconfirmed");
		expect(fake.unsubscribes).toHaveLength(writesAfterFirstSync);
		for (const outcome of [second, third]) {
			expect(outcome.result.ok).toBe(true);
			expect(
				outcome.result.lists.find((list) => list.listId === 202),
			).toMatchObject({ status: "up_to_date", optedOutCount: 1, carriedCount: 0 });
		}
		expect(third.state?.settledSubscriberIds).toEqual([13]);
	});

	test("a later sync carries opt-outs that arrive after an earlier one", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		const test = completedTest();
		const first = await syncAbTestOptOuts(fake.client, test);
		test.optOutSync = first.state;
		expect(first.result.lists.every((list) => list.status === "no_opt_outs")).toBe(
			true,
		);

		// Days after the send, a variant A recipient opts out.
		fake.advanceClock(3 * DAY);
		fake.unsubscribeViaCampaign(100, 11);
		const second = await syncAbTestOptOuts(fake.client, test);

		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(11, SOURCE_B)).toBe("unsubscribed");
		expect(second.state?.settledSubscriberIds).toEqual([11]);
	});

	test("fails closed: an unconfirmed carry stays unsettled and is retried", async () => {
		const fake = createFakeListmonk({ failUnsubscribe: true });
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(100, 11);
		const test = completedTest();

		const failed = await syncAbTestOptOuts(fake.client, test);
		test.optOutSync = failed.state;

		expect(failed.result.ok).toBe(false);
		expect(failed.result.lists.find((list) => list.listId === 200)).toMatchObject({
			status: "failed",
			pendingCount: 1,
		});
		expect(failed.result.lists.find((list) => list.listId === 200)?.detail).toContain(
			"HTTP 403: permission denied",
		);
		expect(failed.state?.settledSubscriberIds).toEqual([]);
		expect(failed.state?.syncedAt).toBeUndefined();
		expect(fake.membership(11, SOURCE_A)).toBe("confirmed");
		expect(fake.hasList(200)).toBe(true);

		fake.options.failUnsubscribe = false;
		const retried = await syncAbTestOptOuts(fake.client, test);
		expect(retried.result.ok).toBe(true);
		expect(retried.state?.settledSubscriberIds).toEqual([11]);
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
	});

	test("never adds a membership or touches a list outside the test's sources", async () => {
		const fake = createFakeListmonk();
		fake.addLists(SOURCE_A, SOURCE_B, 9, 200, 201, 202);
		fake.addCampaign(100, "finished", [200]);
		// A member of both sources and of unrelated list 9.
		fake.addSubscriber(11, {
			[SOURCE_A]: "confirmed",
			[SOURCE_B]: "confirmed",
			9: "confirmed",
			200: "unconfirmed",
		});
		// A member of source list 1 only.
		fake.addSubscriber(15, { [SOURCE_A]: "confirmed", 200: "unconfirmed" });
		// Same variant list, but did not opt out.
		fake.addSubscriber(16, { [SOURCE_A]: "confirmed", 200: "unconfirmed" });
		fake.unsubscribeViaCampaign(100, 11);
		fake.unsubscribeViaCampaign(100, 15);

		const { result } = await syncAbTestOptOuts(fake.client, completedTest());

		expect(result.ok).toBe(true);
		expect(targetedListIds(fake)).toEqual([SOURCE_A, SOURCE_B]);
		expect(fake.unsubscribes.flatMap((request) => request.ids).sort()).toEqual([
			11, 15,
		]);
		expect(fake.membership(11, 9)).toBe("confirmed");
		expect(fake.membership(15, SOURCE_B)).toBeUndefined();
		expect(fake.membership(16, SOURCE_A)).toBe("confirmed");
	});

	test("records a deleted temporary list as missing and stops reading it", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.removeList(201);
		const test = completedTest();

		const first = await syncAbTestOptOuts(fake.client, test);
		test.optOutSync = first.state;
		expect(first.result.lists.find((list) => list.listId === 201)?.status).toBe(
			"missing",
		);
		expect(first.state?.missingListIds).toEqual([201]);

		fake.listProbes.length = 0;
		const second = await syncAbTestOptOuts(fake.client, test);
		expect(fake.listProbes).toEqual([200, 202]);
		expect(second.result.lists.map((list) => list.listId)).toEqual([200, 202]);
	});

	test("a dry run reports pending opt-outs without writing", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);

		const { result, state } = await syncAbTestOptOuts(
			fake.client,
			completedTest(),
			{ dryRun: true },
		);

		expect(state).toBeUndefined();
		expect(fake.unsubscribes).toEqual([]);
		expect(fake.membership(13, SOURCE_B)).toBe("confirmed");
		expect(result.lists.find((list) => list.listId === 202)).toMatchObject({
			status: "pending",
			optedOutCount: 1,
			pendingCount: 1,
			carriedCount: 0,
		});
	});
});

describe("automatic opt-out sync cadence", () => {
	const base = Date.parse("2026-10-01T00:00:00.000Z");

	test("syncs an active test at most hourly", () => {
		const test = makeTest({ status: "running" });
		expect(isOptOutSyncDue(test, base)).toBe(true);

		test.optOutSync = {
			settledSubscriberIds: [],
			syncedAt: new Date(base).toISOString(),
		};
		expect(isOptOutSyncDue(test, base + 30 * 60 * 1000)).toBe(false);
		expect(isOptOutSyncDue(test, base + OPT_OUT_SYNC_INTERVAL_MS)).toBe(true);
	});

	test("keeps syncing an ended test hourly, then daily for as long as its lists exist", () => {
		const endedAt = new Date(base);
		const test = makeTest({ status: "completed", updatedAt: endedAt });
		const syncedAt = (time: number) => {
			test.optOutSync = {
				settledSubscriberIds: [],
				syncedAt: new Date(time).toISOString(),
			};
		};

		syncedAt(base + DAY);
		expect(isOptOutSyncDue(test, base + DAY + OPT_OUT_SYNC_INTERVAL_MS)).toBe(
			true,
		);

		const late = base + OPT_OUT_SYNC_RECENT_PERIOD_MS + 200 * DAY;
		syncedAt(late);
		expect(isOptOutSyncDue(test, late + OPT_OUT_SYNC_INTERVAL_MS)).toBe(false);
		expect(
			isOptOutSyncDue(test, late + OPT_OUT_SYNC_LONG_TAIL_INTERVAL_MS),
		).toBe(true);
	});

	test("skips drafts, unfinished creates, and tests without existing lists", () => {
		expect(isOptOutSyncTracked(makeTest({ status: "draft" }))).toBe(false);
		expect(
			isOptOutSyncTracked(
				makeTest({
					pendingCreate: {
						config: {
							name: "n",
							campaignId: "c",
							variants: [],
							metrics: [],
							baseConfig: { subject: "s", body: "b", lists: [1] },
						},
					},
				}),
			),
		).toBe(false);
		expect(
			isOptOutSyncTracked(
				makeTest({
					status: "cancelled",
					optOutSync: { settledSubscriberIds: [], missingListIds: [200, 201, 202] },
				}),
			),
		).toBe(false);
		expect(isOptOutSyncTracked(makeTest({ status: "cancelled" }))).toBe(true);
	});
});

describe("abtest tick carries opt-outs from kept lists", () => {
	test("carries a completed test's holdout opt-outs and records them", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		await saveStoredAbTests([completedTest()], storePath);
		const context = { client: fake.client, storePath };

		const tick = await invokeTickAbTestsOperation(context, {});

		expect(tick.results).toEqual([]);
		expect(tick.opt_out_sync).toMatchObject({
			dry_run: false,
			checked: 1,
			failed: 0,
		});
		expect(tick.opt_out_sync?.results[0]?.lists).toContainEqual({
			list_id: 202,
			status: "propagated",
			opted_out: 1,
			carried: 1,
			pending: 0,
		});
		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
		const [stored] = await loadStoredAbTests(storePath);
		expect(stored?.optOutSync?.settledSubscriberIds).toEqual([13]);

		// The next tick inside the hour does not read the lists again.
		fake.listProbes.length = 0;
		const next = await invokeTickAbTestsOperation(context, {});
		expect(next.opt_out_sync).toMatchObject({ checked: 0, failed: 0 });
		expect(fake.listProbes).toEqual([]);
	});

	test("a dry-run tick previews the sync without writing", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		await saveStoredAbTests([completedTest()], storePath);
		const before = await readFile(storePath, "utf8");

		const tick = await invokeTickAbTestsOperation(
			{ client: fake.client, storePath },
			{ dry_run: true },
		);

		expect(tick.opt_out_sync?.dry_run).toBe(true);
		expect(tick.opt_out_sync?.results[0]?.lists).toContainEqual({
			list_id: 202,
			status: "pending",
			opted_out: 1,
			carried: 0,
			pending: 1,
		});
		expect(fake.unsubscribes).toEqual([]);
		expect(await readFile(storePath, "utf8")).toBe(before);
	});

	test("a recovery pass stays bounded to its echoed transitions", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		await saveStoredAbTests([completedTest()], storePath);

		const recovery = await invokeTickAbTestsOperation(
			{ client: fake.client, storePath },
			{ recovery_set: [{ test_id: "test_optout", status: "analyzing" }] },
		);

		expect(recovery.opt_out_sync).toBeUndefined();
		expect(fake.unsubscribes).toEqual([]);
	});
});

describe("stop carries opt-outs from the lists it keeps", () => {
	test("finished variant campaigns keep their lists, and their opt-outs are carried", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-optout-stop-"));
		warnSpy = spyOn(console, "warn").mockImplementation(() => undefined);
		const fake = createFakeListmonk();
		seedAbTestAudience(fake, "finished");
		fake.unsubscribeViaCampaign(100, 11);
		const executors = createAbTestExecutors(
			fake.client,
			join(tempDir, "conversions.sqlite"),
		);
		executors.abTestService.hydrateTests([makeTest({ status: "running" })]);

		const stopped = await executors.stopAbTest("test_optout");

		expect(stopped?.status).toBe("cancelled");
		// Finished campaigns keep referencing their lists, so none is deleted.
		expect(fake.deletedLists).toEqual([]);
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(11, SOURCE_B)).toBe("unsubscribed");
		expect(stopped?.optOutSync?.settledSubscriberIds).toEqual([11]);
		expect(stopped?.optOutSync?.syncedAt).toBeDefined();
	});

	test("a stop that deletes lists records them so later syncs skip them", async () => {
		tempDir = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-optout-stop-"));
		const fake = createFakeListmonk();
		seedAbTestAudience(fake, "scheduled");
		const executors = createAbTestExecutors(
			fake.client,
			join(tempDir, "conversions.sqlite"),
		);
		executors.abTestService.hydrateTests([makeTest({ status: "scheduled" })]);

		const stopped = await executors.stopAbTest("test_optout");

		expect(fake.deletedLists.sort()).toEqual([200, 201, 202]);
		expect(stopped?.optOutSync?.missingListIds).toEqual([200, 201, 202]);
		expect(isOptOutSyncTracked(stopped as AbTest)).toBe(false);
	});
});

describe("deleting a terminal test carries its opt-outs and keeps tracking its lists", () => {
	test("delete carries first, hides the test, and later opt-outs are still carried", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		await saveStoredAbTests(
			[completedTest({ idempotencyKey: "replay-key" })],
			storePath,
		);
		const context = { client: fake.client, storePath };

		expect(
			await invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).toEqual({ deleted: true });

		// The winner opt-out was carried before the record went away.
		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
		expect(fake.deletedLists).toEqual([]);
		await expect(
			invokeGetAbTestOperation(context, { test_id: "test_optout" }),
		).rejects.toThrow("Test with ID test_optout not found");
		expect((await invokeListAbTestsOperation(context, {})).tests).toEqual([]);
		const [retained] = await loadStoredAbTests(storePath);
		expect(retained?.deletedAt).toBeDefined();
		expect(retained?.idempotencyKey).toBeUndefined();
		expect(retained?.optOutSync?.settledSubscriberIds).toEqual([13]);
		// Deleting again is the documented no-op.
		expect(
			await invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).toEqual({ deleted: false });

		// The variant emails keep their working unsubscribe links.
		fake.advanceClock(10 * DAY);
		fake.unsubscribeViaCampaign(100, 11);
		const sync = await withStoredAbTestExecutors(
			fake.client,
			{ mode: "write", storePath },
			(executors) => executors.syncAbTestOptOuts(),
		);

		expect(sync).toHaveLength(1);
		expect(sync[0]).toMatchObject({
			testId: "test_optout",
			deleted: true,
			ok: true,
		});
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
	});

	test("a failed carry keeps the test so the delete can be retried", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk({ failUnsubscribe: true });
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		await saveStoredAbTests([completedTest()], storePath);
		const context = { client: fake.client, storePath };

		await expect(
			invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).rejects.toThrow(
			/was not deleted because the opt-outs on its temporary lists could not be carried.*temporary list 202 \(failed\)/,
		);
		expect(
			(await invokeGetAbTestOperation(context, { test_id: "test_optout" })).test
				.status,
		).toBe("completed");

		fake.options.failUnsubscribe = false;
		expect(
			await invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).toEqual({ deleted: true });
		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
	});

	test("the retained record is dropped once its temporary lists are gone", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		await saveStoredAbTests([completedTest()], storePath);
		const context = { client: fake.client, storePath };
		await invokeDeleteAbTestOperation(context, { test_id: "test_optout" });
		expect(await loadStoredAbTests(storePath)).toHaveLength(1);

		for (const listId of [200, 201, 202]) {
			fake.removeList(listId);
		}
		const sync = await withStoredAbTestExecutors(
			fake.client,
			{ mode: "write", storePath },
			(executors) => executors.syncAbTestOptOuts({ testId: "test_optout" }),
		);

		expect(sync[0]?.lists.map((list) => [list.listId, list.status])).toEqual([
			[200, "missing"],
			[201, "missing"],
			[202, "missing"],
		]);
		expect(await loadStoredAbTests(storePath)).toEqual([]);
	});
});

describe("persisted opt-out sync records", () => {
	test("round-trips a sync record and a retained deleted test", async () => {
		const storePath = await createStorePath();
		const optOutSync = {
			settledSubscriberIds: [11, 13],
			missingListIds: [201],
			syncedAt: "2026-10-01T00:00:00.000Z",
		};
		await saveStoredAbTests(
			[
				completedTest({ optOutSync }),
				completedTest({
					id: "test_deleted",
					deletedAt: "2026-10-02T00:00:00.000Z",
				}),
			],
			storePath,
		);

		const [active, retained] = await loadStoredAbTests(storePath);
		expect(active?.optOutSync).toEqual(optOutSync);
		expect(retained?.deletedAt).toBe("2026-10-02T00:00:00.000Z");
		// Only the active test is visible to the A/B lookups.
		const listed = await invokeListAbTestsOperation(
			{ client: createFakeListmonk().client, storePath },
			{},
		);
		expect(listed.tests.map((test) => test.id)).toEqual(["test_optout"]);
	});

	test.each([
		["a negative settled subscriber", { optOutSync: { settledSubscriberIds: [-1] } }],
		["a missing settled list", { optOutSync: { syncedAt: "2026-10-01T00:00:00.000Z" } }],
		["a fractional missing list", { optOutSync: { settledSubscriberIds: [], missingListIds: [1.5] } }],
		["an unparseable sync time", { optOutSync: { settledSubscriberIds: [], syncedAt: "soon" } }],
		["an unparseable deletion time", { deletedAt: "not-a-time" }],
	])("rejects %s at the store boundary", async (_label, fields) => {
		const storePath = await createStorePath();
		await writeFile(
			storePath,
			`${JSON.stringify({ version: 2, tests: [{ ...JSON.parse(JSON.stringify(completedTest())), ...fields }] })}\n`,
			"utf8",
		);

		await expect(loadStoredAbTests(storePath)).rejects.toThrow(
			"test 0 failed schema validation",
		);
	});
});
