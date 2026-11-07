import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAbTestExecutors } from "../src/factory";
import {
	invokeDeleteAbTestOperation,
	invokeGetAbTestOperation,
	invokeListAbTestsOperation,
	invokeStopAbTestOperation,
	invokeSyncAbTestOptOutsOperation,
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
	AbTestNotFoundError,
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

	test.each([
		["later by one microsecond", "2026-09-01T00:00:00.000002Z", true],
		["same instant with an offset", "2026-09-01T09:00:00.000002+09:00", true],
		["earlier within the millisecond", "2026-09-01T00:00:00.000000Z", false],
		["equal", "2026-09-01T00:00:00.000001Z", false],
		["unparseable", "unknown", false],
	] as const)(
		"source creation %s is compared without discarding remote microseconds",
		async (_label, createdAt, protectedSource) => {
			const fake = createFakeListmonk();
			seedAbTestAudience(fake);
			fake.unsubscribeViaCampaign(100, 11);
			const read = fake.client.subscriber.listRaw.bind(fake.client.subscriber);
			fake.client.subscriber.listRaw = async (input) => {
				const response = await read(input);
				if (response.data) {
					for (const subscriber of response.data.results) {
						for (const membership of subscriber.lists ?? []) {
							if (membership.id === SOURCE_A) {
								membership.subscription_created_at = createdAt;
							}
							if (membership.id === 200) {
								membership.subscription_updated_at = "2026-09-01T00:00:00.000001Z";
							}
						}
					}
				}
				return response;
			};
			const test = completedTest();
			expect((await syncAbTestOptOuts(fake.client, test, { dryRun: true })).state).toBeUndefined();
			expect(fake.unsubscribes).toEqual([]);
			const outcome = await syncAbTestOptOuts(fake.client, test);
			expect(outcome.result.ok).toBe(true);
			expect(fake.membership(11, SOURCE_A)).toBe(protectedSource ? "confirmed" : "unsubscribed");
			expect(fake.membership(11, SOURCE_B)).toBe("unsubscribed");
			expect(fake.unsubscribes.at(-1)?.target_list_ids).toEqual(protectedSource ? [SOURCE_B] : [SOURCE_A, SOURCE_B]);
		},
	);

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

	test("drops the settled ids once every temporary list is gone", async () => {
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(300, 13);
		const test = completedTest();
		const first = await syncAbTestOptOuts(fake.client, test);
		test.optOutSync = first.state;
		expect(test.optOutSync?.settledSubscriberIds).toEqual([13]);

		for (const listId of [200, 201, 202]) {
			fake.removeList(listId);
		}
		const second = await syncAbTestOptOuts(fake.client, test);

		// No opt-out can reach the test any more, so nothing needs guarding;
		// the missing lists stay recorded so they are not read again.
		expect(second.state?.settledSubscriberIds).toEqual([]);
		expect(second.state?.missingListIds).toEqual([200, 201, 202]);
		test.optOutSync = second.state;
		expect(isOptOutSyncTracked(test)).toBe(false);
	});

	test("a dry run counts a subscriber opted out of several lists once, like a real run", async () => {
		const fake = createFakeListmonk();
		fake.addLists(SOURCE_A, 200, 201, 202);
		fake.addSubscriber(17, {
			[SOURCE_A]: "confirmed",
			200: "unsubscribed",
			202: "unsubscribed",
		});
		const test = completedTest();

		const preview = await syncAbTestOptOuts(fake.client, test, {
			dryRun: true,
		});
		const real = await syncAbTestOptOuts(fake.client, test);

		const pendingByList = (outcome: typeof preview) =>
			outcome.result.lists.map((list) => [list.listId, list.pendingCount]);
		expect(pendingByList(preview)).toEqual([
			[200, 1],
			[201, 0],
			[202, 0],
		]);
		expect(
			real.result.lists.map((list) => [list.listId, list.carriedCount]),
		).toEqual([
			[200, 1],
			[201, 0],
			[202, 0],
		]);
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

describe("shared-source opt-out chronology", () => {
 const base = Date.parse("2026-09-01T00:00:00Z");
 function fixture(options = {}) {
  const fake = createFakeListmonk(options);
  fake.addLists(SOURCE_A, SOURCE_B, 200, 201);
  fake.addCampaign(100, "finished", [200]);
		fake.addCampaign(101, "finished", [201]);
  fake.addSubscriber(777, { [SOURCE_A]: "confirmed", [SOURCE_B]: "confirmed", 200: "confirmed", 201: "confirmed" });
  const a = completedTest({ id: "a", baseConfig: { subject: "A", body: "A", lists: [SOURCE_A] },
   campaignMappings: [{ variantId: "variant-a", campaignId: 100 }], testListMappings: [{ variantId: "variant-a", listId: 200 }], holdoutListId: undefined, winnerCampaignId: undefined });
  const b = completedTest({ ...a, id: "b", baseConfig: { ...a.baseConfig }, campaignMappings: [{ variantId: "variant-a", campaignId: 101 }], testListMappings: [{ variantId: "variant-a", listId: 201 }] });
  return { fake, a, b };
 }
 const now = (offset: number) => new Date(base + offset);
 test("an older other-test opt-out cannot revoke reconsent, including after persistence reload and dry run", async () => {
  const { fake, a, b } = fixture();
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(101, 777);
  fake.advanceClock(1000);
		a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(3000) })).state;
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
  const storePath = await createStorePath();
		await saveStoredAbTests([a, b], storePath);
  const before = await readFile(storePath, "utf8");
		const writes = fake.unsubscribes.length;
  const preview = await invokeSyncAbTestOptOutsOperation({ client: fake.client, storePath }, { test_id: "b", dry_run: true });
  expect(preview.failed).toBe(0);
		expect(preview.results[0]?.lists[0]?.pending).toBe(0);
  expect(await readFile(storePath, "utf8")).toBe(before);
  const result = await invokeSyncAbTestOptOutsOperation({ client: fake.client, storePath }, { test_id: "b" });
  expect(result.failed).toBe(0);
		expect(fake.unsubscribes.length).toBe(writes);
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
  for (const output of [result, await invokeGetAbTestOperation({ client: fake.client, storePath }, { test_id: "a" }), await invokeListAbTestsOperation({ client: fake.client, storePath }, {})]) {
   expect(JSON.stringify(output)).not.toContain("sourceSettlements");
   expect(JSON.stringify(output)).not.toContain("settledSubscriberIds");
   expect(JSON.stringify(output)).not.toContain("777");
  }
 });
 test("a genuinely newer opt-out still propagates; no-op syncs do not extend old checkpoints", async () => {
  const { fake, a, b } = fixture();
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(1000) })).state;
  const original = structuredClone(a.optOutSync?.sourceSettlements);
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(101, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(4000) })).state;
  expect(a.optOutSync?.sourceSettlements).toEqual(original);
  const outcome = await syncAbTestOptOuts(fake.client, b, { now: now(5000), relatedTests: [a] });
  expect(outcome.result.ok).toBe(true);
		expect(fake.membership(777, SOURCE_A)).toBe("unsubscribed");
  expect(outcome.result.lists[0]?.carriedCount).toBe(1);
 });
 test("a partial source-list confirmation also protects later consent on that source within the same test", async () => {
  const { fake, a } = fixture({ unmanageableListIds: [SOURCE_B] });
  a.baseConfig.lists = [SOURCE_A, SOURCE_B];
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
  const failed = await syncAbTestOptOuts(fake.client, a);
  expect(failed.result.ok).toBe(false);
		a.optOutSync = failed.state;
  expect(a.optOutSync?.settledSubscriberIds).toEqual([]);
  expect(a.optOutSync?.sourceSettlements?.map((point) => point.sourceListId)).toEqual([SOURCE_A]);
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
		fake.options.unmanageableListIds = [];
  expect((await syncAbTestOptOuts(fake.client, a)).result.ok).toBe(true);
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
  expect(fake.membership(777, SOURCE_B)).toBe("unsubscribed");
  expect(fake.unsubscribes.at(-1)?.target_list_ids).toEqual([SOURCE_B]);
 });
	async function lonePartialSourceProgress() {
		const storePath = await createStorePath();
		const { fake, a } = fixture({ unmanageableListIds: [SOURCE_B] });
		a.baseConfig.lists = [SOURCE_A, SOURCE_B];
		a.status = "running";
		fake.addCampaign(100, "running", [200]);
		fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
		await saveStoredAbTests([a], storePath);
		const context = { client: fake.client, storePath };
		expect((await invokeSyncAbTestOptOutsOperation(context, { test_id: "a" })).failed).toBe(1);
		const [saved] = await loadStoredAbTests(storePath);
		expect(saved?.optOutSync?.settledSubscriberIds).toEqual([]);
		expect(saved?.optOutSync?.sourceSettlements?.map((point) => point.sourceListId)).toEqual([SOURCE_A]);
		fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
		return { fake, context, storePath };
	}

	test.each(["stop", "delete"] as const)("%s preserves a lone test's persisted partial source consent", async (action) => {
		const { fake, context, storePath } = await lonePartialSourceProgress();
		fake.options.unmanageableListIds = [];
		const writes = fake.unsubscribes.length;
		const output = action === "stop"
			? await invokeStopAbTestOperation(context, { test_id: "a" })
			: await invokeDeleteAbTestOperation(context, { test_id: "a" });
		expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
		expect(fake.membership(777, SOURCE_B)).toBe("unsubscribed");
		expect(fake.unsubscribes.slice(writes)).toEqual([{ ids: [777], target_list_ids: [SOURCE_B] }]);
		expect(JSON.stringify(output)).not.toContain("sourceSettlements");
		expect(JSON.stringify(output)).not.toContain("optOutSourceSettlements");
		expect(JSON.stringify(output)).not.toContain("777");
		if (action === "stop") expect((await loadStoredAbTests(storePath))[0]?.status).toBe("cancelled");
		else expect(await loadStoredAbTests(storePath)).toEqual([]);
	});

	test.each([
		["stop", "permissions"], ["delete", "permissions"],
		["stop", "chronology"], ["delete", "chronology"],
	] as const)("%s blocks lone-test cleanup when partial source %s remain unconfirmed", async (action, failure) => {
		const { fake, context, storePath } = await lonePartialSourceProgress();
		if (failure === "chronology") {
			fake.options.unmanageableListIds = [];
			fake.options.omitMembershipTimestamps = true;
		}
		const writes = fake.unsubscribes.length;
		const cleanup = () => action === "stop"
			? invokeStopAbTestOperation(context, { test_id: "a" })
			: invokeDeleteAbTestOperation(context, { test_id: "a" });
		await expect(cleanup()).rejects.toThrow(/opt-outs must be reconciled/);
		expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
		expect(fake.membership(777, SOURCE_B)).toBe("confirmed");
		expect((await fake.client.campaign.getById({ path: { id: 100 } })).data?.status).toBe("running");
		expect(fake.hasList(200)).toBe(true);
		const [saved] = await loadStoredAbTests(storePath);
		expect(saved?.status).toBe("running");
		expect(saved?.optOutSync?.sourceSettlements?.map((point) => point.sourceListId)).toEqual([SOURCE_A]);
		if (failure === "chronology") expect(fake.unsubscribes.length).toBe(writes);
		else expect(fake.unsubscribes.slice(writes)).toEqual([{ ids: [777], target_list_ids: [SOURCE_B] }]);
	});

 test.each([false, true])("retains PostgreSQL microseconds when comparing a newer opt-out: %s", async (newer) => {
  const { fake, a, b } = fixture();
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
		fake.unsubscribeViaCampaign(101, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a)).state;
  a.optOutSync!.sourceSettlements![0]!.through = "2026-09-01T00:00:01.000001Z";
  fake.resubscribeViaForm(777, SOURCE_A);
  const read = fake.client.subscriber.listRaw.bind(fake.client.subscriber);
  fake.client.subscriber.listRaw = async (input) => {
   const response = await read(input);
   if (response.data) for (const subscriber of response.data.results) {
    for (const membership of subscriber.lists ?? []) {
     if (membership.id === 201) membership.subscription_updated_at = newer ? "2026-09-01T00:00:01.000002Z" : "2026-09-01T00:00:01.000000Z";
    }
   }
   return response;
  };
  const writes = fake.unsubscribes.length;
  expect((await syncAbTestOptOuts(fake.client, b, { relatedTests: [a] })).result.ok).toBe(true);
  expect(fake.membership(777, SOURCE_A)).toBe(newer ? "unsubscribed" : "unconfirmed");
  expect(fake.unsubscribes.length).toBe(writes + (newer ? 1 : 0));
 });
 test("local clock skew never broadens remotely confirmed chronology", async () => {
  const { fake, a, b } = fixture();
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: new Date("2099-01-01T00:00:00Z") })).state;
  expect(Date.parse(a.optOutSync?.sourceSettlements?.[0]?.through ?? "")).toBe(now(1000).getTime());
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(101, 777);
  expect((await syncAbTestOptOuts(fake.client, b, { relatedTests: [a] })).result.ok).toBe(true);
  expect(fake.membership(777, SOURCE_A)).toBe("unsubscribed");
 });
 test("settling an absent or newly-created source membership creates no blanket subscriber exemption", async () => {
  const { fake, a, b } = fixture();
  fake.addSubscriber(777, { 200: "confirmed", 201: "confirmed" });
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(3000) })).state;
  expect(a.optOutSync?.sourceSettlements).toEqual([]);
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
  fake.advanceClock(2000);
		fake.unsubscribeViaCampaign(101, 777);
  expect((await syncAbTestOptOuts(fake.client, b, { relatedTests: [a] })).result.ok).toBe(true);
  expect(fake.membership(777, SOURCE_A)).toBe("unsubscribed");
 });
 test("progress covers only actually confirmed source lists, not other lists or newly-created memberships", async () => {
  const { fake, a, b } = fixture();
  b.baseConfig.lists = [SOURCE_A, SOURCE_B];
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
		fake.unsubscribeViaCampaign(101, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(1000) })).state;
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
  const outcome = await syncAbTestOptOuts(fake.client, b, { now: now(3000), relatedTests: [a] });
  expect(outcome.result.ok).toBe(true);
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
  expect(fake.membership(777, SOURCE_B)).toBe("unsubscribed");
  expect(fake.unsubscribes.at(-1)?.target_list_ids).toEqual([SOURCE_B]);
  expect(a.optOutSync?.sourceSettlements?.map((point) => point.sourceListId)).toEqual([SOURCE_A]);
 });
 test("a read-confirmed source unsubscribe without any timestamps stays explicitly unknown across tests", async () => {
  const { fake, a, b } = fixture({ omitMembershipTimestamps: true });
  fake.unsubscribeViaCampaign(100, 777);
		fake.unsubscribeViaCampaign(101, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a)).state;
  expect(a.optOutSync?.sourceSettlements).toEqual([{ subscriberId: 777, sourceListId: SOURCE_A, through: null }]);
  fake.resubscribeViaForm(777, SOURCE_A);
  expect((await syncAbTestOptOuts(fake.client, a)).result.ok).toBe(true);
  const writes = fake.unsubscribes.length;
  expect((await syncAbTestOptOuts(fake.client, b, { relatedTests: [a] })).result.ok).toBe(false);
  expect(fake.unsubscribes.length).toBe(writes);
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
 });
 test.each(["missing opt-out time", "legacy checkpoint"])("uncertain %s fails closed without overwriting consent", async (kind) => {
  const { fake, a, b } = fixture();
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
		fake.unsubscribeViaCampaign(101, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(1000) })).state;
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
  if (kind === "missing opt-out time") fake.options.omitMembershipTimestamps = true;
  else delete a.optOutSync?.sourceSettlements;
  const writes = fake.unsubscribes.length;
  const outcome = await syncAbTestOptOuts(fake.client, b, { now: now(3000), relatedTests: [a] });
  expect(outcome.result.ok).toBe(false);
  expect(outcome.result.lists[0]?.detail).toContain("fresh consent was not overwritten");
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
  expect(fake.unsubscribes.length).toBe(writes);
 });
 test.each(["stop", "delete"])("%s reconciles shared-source history before legacy cleanup", async (action) => {
  await createStorePath();
		const { fake, a, b } = fixture();
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
		fake.unsubscribeViaCampaign(101, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(1000) })).state;
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
  b.status = "scheduled";
		fake.addCampaign(101, "scheduled", [201]);
  const executors = createAbTestExecutors(fake.client, join(tempDir!, "conversions.sqlite"));
  executors.abTestService.hydrateTests([a, b]);
  const writes = fake.unsubscribes.length;
  if (action === "stop") await executors.stopAbTest("b");
  else await executors.abTestService.deleteTest("b");
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
  expect(fake.unsubscribes.length).toBe(writes);
 });
 test("retains source history after its own lists vanish until every related replay source is gone", async () => {
  await createStorePath();
		const { fake, a, b } = fixture();
  fake.advanceClock(1000);
		fake.unsubscribeViaCampaign(100, 777);
		fake.unsubscribeViaCampaign(101, 777);
  a.optOutSync = (await syncAbTestOptOuts(fake.client, a, { now: now(1000) })).state;
  fake.advanceClock(1000);
		fake.resubscribeViaForm(777, SOURCE_A);
		fake.removeList(200);
  const executors = createAbTestExecutors(fake.client, join(tempDir!, "conversions.sqlite"));
		executors.abTestService.hydrateTests([a, b]);
  await executors.abTestService.deleteTest("a");
  expect(executors.abTestService.snapshotRetiredTests().map((entry) => entry.id)).toEqual(["a"]);
  await executors.syncAbTestOptOuts({ testId: "b", now: now(3000) });
  expect(fake.membership(777, SOURCE_A)).toBe("unconfirmed");
  fake.removeList(201);
		await executors.syncAbTestOptOuts({ testId: "b", now: now(4000) });
  expect(executors.abTestService.snapshotRetiredTests()).toEqual([]);
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

describe("a failed stop or delete keeps the opt-outs it carried", () => {
	/**
	 * Both variants were scheduled, so a stop or delete removes their
	 * campaigns. Variant B's list holds two opt-outs: subscriber 15 (source
	 * list 1 only) is carried, but subscriber 14 also belongs to source list
	 * 2, which the API user cannot manage, so the list is kept and the
	 * attempt fails.
	 */
	function seedPartialFailure(status: "scheduled" | "completed") {
		const fake = createFakeListmonk({ unmanageableListIds: [SOURCE_B] });
		fake.addLists(SOURCE_A, SOURCE_B, 200, 201, 202);
		fake.addCampaign(100, status === "completed" ? "finished" : "scheduled", [200]);
		fake.addCampaign(101, status === "completed" ? "finished" : "scheduled", [201]);
		fake.addSubscriber(15, { [SOURCE_A]: "confirmed", 201: "unconfirmed" });
		fake.addSubscriber(14, {
			[SOURCE_A]: "confirmed",
			[SOURCE_B]: "confirmed",
			201: "unconfirmed",
		});
		fake.unsubscribeViaCampaign(101, 15);
		fake.unsubscribeViaCampaign(101, 14);
		return fake;
	}

	/** Subscriber 15 re-subscribes, then the permission problem is fixed. */
	function resubscribeAndFix(fake: FakeListmonk) {
		fake.advanceClock(DAY);
		fake.resubscribeViaForm(15, SOURCE_A);
		fake.options.unmanageableListIds = [];
	}

	test.each(["stop", "delete"] as const)("%s records partial source confirmations created by cleanup itself", async (action) => {
		const storePath = await createStorePath();
		const fake = seedPartialFailure("scheduled");
		await saveStoredAbTests([makeTest({ status: "scheduled" })], storePath);
		const context = { client: fake.client, storePath };
		const cleanup = () => action === "stop"
			? invokeStopAbTestOperation(context, { test_id: "test_optout" })
			: invokeDeleteAbTestOperation(context, { test_id: "test_optout" });
		await expect(cleanup()).rejects.toThrow();
		const [saved] = await loadStoredAbTests(storePath);
		expect(saved?.optOutSync?.sourceSettlements?.some((point) => point.subscriberId === 14 && point.sourceListId === SOURCE_A)).toBe(true);
		expect(saved?.optOutSync?.settledSubscriberIds).not.toContain(14);
		resubscribeAndFix(fake);
		fake.resubscribeViaForm(14, SOURCE_A);
		const writes = fake.unsubscribes.length;
		await cleanup();
		expect(fake.membership(14, SOURCE_A)).toBe("unconfirmed");
		expect(fake.membership(15, SOURCE_A)).toBe("unconfirmed");
		expect(fake.membership(14, SOURCE_B)).toBe("unsubscribed");
		expect(fake.unsubscribes.slice(writes)).toEqual([{ ids: [14], target_list_ids: [SOURCE_B] }]);
	});

	test("stop", async () => {
		const storePath = await createStorePath();
		const fake = seedPartialFailure("scheduled");
		await saveStoredAbTests([makeTest({ status: "scheduled" })], storePath);
		const context = { client: fake.client, storePath };

		await expect(
			invokeStopAbTestOperation(context, { test_id: "test_optout" }),
		).rejects.toThrow(/were recorded so a retry does not carry them again/);
		const [afterFailure] = await loadStoredAbTests(storePath);
		expect(afterFailure?.status).toBe("scheduled");
		expect(afterFailure?.optOutSync).toMatchObject({
			settledSubscriberIds: [15],
			missingListIds: [200, 202],
		});

		resubscribeAndFix(fake);
		const stopped = await invokeStopAbTestOperation(context, {
			test_id: "test_optout",
		});

		expect(stopped.test.status).toBe("cancelled");
		expect(fake.membership(15, SOURCE_A)).toBe("unconfirmed");
		expect(fake.membership(14, SOURCE_B)).toBe("unsubscribed");
		expect(fake.hasList(201)).toBe(false);
	});

	test("delete of an active test", async () => {
		const storePath = await createStorePath();
		const fake = seedPartialFailure("scheduled");
		await saveStoredAbTests([makeTest({ status: "scheduled" })], storePath);
		const context = { client: fake.client, storePath };

		await expect(
			invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).rejects.toThrow(/temporary list 201 kept to preserve its opt-outs/);
		const [afterFailure] = await loadStoredAbTests(storePath);
		expect(afterFailure?.optOutSync).toMatchObject({
			settledSubscriberIds: [15],
			missingListIds: [200, 202],
		});

		resubscribeAndFix(fake);
		expect(
			await invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).toEqual({ deleted: true });

		expect(fake.membership(15, SOURCE_A)).toBe("unconfirmed");
		expect(fake.membership(14, SOURCE_B)).toBe("unsubscribed");
		expect(await loadStoredAbTests(storePath)).toEqual([]);
	});

	test("delete of a terminal test", async () => {
		const storePath = await createStorePath();
		const fake = seedPartialFailure("completed");
		await saveStoredAbTests([completedTest({ winnerCampaignId: undefined })], storePath);
		const context = { client: fake.client, storePath };

		await expect(
			invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).rejects.toThrow(/was not deleted because the opt-outs on its temporary lists/);
		const [afterFailure] = await loadStoredAbTests(storePath);
		expect(afterFailure?.deletedAt).toBeUndefined();
		expect(afterFailure?.optOutSync?.settledSubscriberIds).toEqual([15]);
		expect(afterFailure?.optOutSync?.syncedAt).toBeUndefined();

		resubscribeAndFix(fake);
		expect(
			await invokeDeleteAbTestOperation(context, { test_id: "test_optout" }),
		).toEqual({ deleted: true });

		expect(fake.membership(15, SOURCE_A)).toBe("unconfirmed");
		expect(fake.membership(14, SOURCE_B)).toBe("unsubscribed");
	});
});

describe("abtest.sync-optouts", () => {
	test("syncs one test, persists the record, and a dry run only reads", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(100, 11);
		fake.unsubscribeViaCampaign(101, 14);
		await saveStoredAbTests(
			[completedTest(), completedTest({ id: "test_other", holdoutListId: undefined, testListMappings: [] })],
			storePath,
		);
		const context = { client: fake.client, storePath };

		const before = await readFile(storePath, "utf8");
		const preview = await invokeSyncAbTestOptOutsOperation(context, {
			test_id: "test_optout",
			dry_run: true,
		});
		expect(preview).toMatchObject({ dry_run: true, checked: 1, failed: 0 });
		expect(
			preview.results[0]?.lists.map((list) => [list.list_id, list.status, list.pending]),
		).toEqual([
			[200, "pending", 1],
			[201, "pending", 1],
			[202, "no_opt_outs", 0],
		]);
		expect(fake.unsubscribes).toEqual([]);
		expect(await readFile(storePath, "utf8")).toBe(before);

		const synced = await invokeSyncAbTestOptOutsOperation(context, {
			test_id: "test_optout",
		});
		expect(synced).toMatchObject({ dry_run: false, checked: 1, failed: 0 });
		expect(fake.membership(11, SOURCE_A)).toBe("unsubscribed");
		expect(fake.membership(14, SOURCE_A)).toBe("unsubscribed");
		const stored = (await loadStoredAbTests(storePath)).find(
			(candidate) => candidate.id === "test_optout",
		);
		expect(stored?.optOutSync?.settledSubscriberIds).toEqual([11, 14]);
	});

	test("reports lists it could not carry and counts the test as failed", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk({ unmanageableListIds: [SOURCE_B] });
		seedAbTestAudience(fake);
		fake.unsubscribeViaCampaign(100, 11);
		await saveStoredAbTests([completedTest()], storePath);

		const result = await invokeSyncAbTestOptOutsOperation(
			{ client: fake.client, storePath },
			{},
		);

		expect(result).toMatchObject({ checked: 1, failed: 1 });
		expect(result.results[0]?.lists[0]).toMatchObject({
			list_id: 200,
			status: "failed",
			pending: 1,
		});
		expect(result.results[0]?.lists[0]?.detail).toContain(
			"still subscribed to source lists 1, 2",
		);
		const [stored] = await loadStoredAbTests(storePath);
		expect(stored?.optOutSync?.syncedAt).toBeUndefined();
	});

	test("syncs a deleted test's retained record by id", async () => {
		const storePath = await createStorePath();
		const fake = createFakeListmonk();
		seedAbTestAudience(fake);
		await saveStoredAbTests([completedTest()], storePath);
		const context = { client: fake.client, storePath };
		await invokeDeleteAbTestOperation(context, { test_id: "test_optout" });

		fake.advanceClock(DAY);
		fake.unsubscribeViaCampaign(300, 13);
		const result = await invokeSyncAbTestOptOutsOperation(context, {
			test_id: "test_optout",
		});

		expect(result).toMatchObject({ checked: 1, failed: 0 });
		expect(result.results[0]).toMatchObject({
			test_id: "test_optout",
			status: "completed",
			deleted: true,
		});
		expect(fake.membership(13, SOURCE_B)).toBe("unsubscribed");
	});

	test("rejects an unknown test", async () => {
		const storePath = await createStorePath();
		await saveStoredAbTests([], storePath);

		await expect(
			invokeSyncAbTestOptOutsOperation(
				{ client: createFakeListmonk().client, storePath },
				{ test_id: "missing" },
			),
		).rejects.toMatchObject({ cause: expect.any(AbTestNotFoundError) });
	});
});

describe("persisted opt-out sync records", () => {
	test("round-trips a sync record and a retained deleted test", async () => {
		const storePath = await createStorePath();
		const optOutSync = {
			settledSubscriberIds: [11, 13],
			missingListIds: [201],
   sourceSettlements: [{ subscriberId: 11, sourceListId: SOURCE_A, through: "2026-10-01T00:00:00.000Z" }],
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
  ["an invalid source checkpoint ID", { optOutSync: { settledSubscriberIds: [], sourceSettlements: [{ subscriberId: -1, sourceListId: 1, through: "2026-10-01T00:00:00.000Z" }] } }],
  ["an invalid source checkpoint time", { optOutSync: { settledSubscriberIds: [], sourceSettlements: [{ subscriberId: 11, sourceListId: 1, through: "soon" }] } }],
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
