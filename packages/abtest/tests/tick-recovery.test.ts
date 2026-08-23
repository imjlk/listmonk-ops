import type { ListmonkClient } from "@listmonk-ops/openapi";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AbTest } from "../src/types";
import {
	invokeGetAbTestOperation,
	invokeTickAbTestsOperation,
} from "../src/operations";
import { saveStoredAbTests } from "../src/persistence";

const directories: string[] = [];

async function createStorePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-abtest-tick-"));
	directories.push(directory);
	return join(directory, "abtests.json");
}

function scheduledFixture(id: string, launchAtPast = true): AbTest {
	const now = new Date("2026-01-01T00:00:00.000Z");
	const launchAt = launchAtPast
		? new Date(now.getTime() - 60_000)
		: new Date(now.getTime() + 3_600_000);
	return {
		id,
		name: `Fixture ${id}`,
		campaignId: "campaign-1",
		variants: [
			{
				id: "variant-a",
				name: "A",
				percentage: 50,
				contentOverrides: {},
			},
			{
				id: "variant-b",
				name: "B",
				percentage: 50,
				contentOverrides: {},
			},
		],
		status: "scheduled",
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
		launchAt: launchAt.toISOString(),
		endsAt: new Date(launchAt.getTime() + 3_600_000).toISOString(),
		campaignMappings: [],
		testListMappings: [],
	};
}

function noopClient(): ListmonkClient {
	return {
		campaign: {
			update: async () => ({ data: true }),
			updateStatus: async () => ({ data: true }),
		},
		list: {},
		template: {},
		subscriber: {},
	} as unknown as ListmonkClient;
}

describe("abtest tick echoed-set recovery", () => {
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
	});

	test("echoes pre-tick claim positions and converges a retried recovery", async () => {
		const storePath = await createStorePath();
		const fixture = scheduledFixture("test-scheduled");
		await saveStoredAbTests([fixture], storePath);
		const context = { client: noopClient(), storePath };

		const tick = await invokeTickAbTestsOperation(context, {});
		expect(tick.claim_steps).toEqual([
			{ test_id: fixture.id, status: "scheduled" },
		]);
		expect(tick.results).toEqual([
			{
				test_id: fixture.id,
				status: "running",
				action: "progress:scheduled->running",
			},
		]);
		expect(
			(await invokeGetAbTestOperation(context, { test_id: fixture.id })).test
				.status,
		).toBe("running");

		// Recovery bound to the echoed pre-tick status (scheduled): the test
		// already advanced, so the recovery pass skips it — one retry
		// converges with no further mutation.
		const recovery = await invokeTickAbTestsOperation(context, {
			recovery_set: tick.claim_steps,
		});
		expect(recovery).toMatchObject({
			processed: 0,
			results: [],
			requested: 1,
			already_done: 1,
		});
		expect(
			(await invokeGetAbTestOperation(context, { test_id: fixture.id })).test
				.status,
		).toBe("running");
	});

	test("re-processes a member still at its echoed status", async () => {
		const storePath = await createStorePath();
		const fixture = scheduledFixture("test-still-due");
		await saveStoredAbTests([fixture], storePath);
		const context = { client: noopClient(), storePath };

		const recovery = await invokeTickAbTestsOperation(context, {
			recovery_set: [{ test_id: fixture.id, status: "scheduled" }],
		});
		expect(recovery).toMatchObject({
			processed: 1,
			requested: 1,
			already_done: 0,
		});
		expect(recovery.results[0]).toMatchObject({
			test_id: fixture.id,
			action: "progress:scheduled->running",
		});
	});

	test("never sweeps tests outside the echoed set", async () => {
		const storePath = await createStorePath();
		const inside = scheduledFixture("test-inside");
		const outside = scheduledFixture("test-outside");
		await saveStoredAbTests([inside, outside], storePath);
		const context = { client: noopClient(), storePath };

		const recovery = await invokeTickAbTestsOperation(context, {
			recovery_set: [{ test_id: inside.id, status: "scheduled" }],
		});
		expect(recovery.results).toHaveLength(1);
		expect(recovery.results[0]?.test_id).toBe(inside.id);
		// The untouched member stays scheduled.
		expect(
			(await invokeGetAbTestOperation(context, { test_id: outside.id })).test
				.status,
		).toBe("scheduled");
	});

	test("rejects duplicate echoed claims", async () => {
		const storePath = await createStorePath();
		const context = { client: noopClient(), storePath };
		await expect(
			invokeTickAbTestsOperation(context, {
				recovery_set: [
					{ test_id: "t-1", status: "scheduled" },
					{ test_id: "t-1", status: "scheduled" },
				],
			}),
		).rejects.toThrow(/must be unique/);
	});
});
