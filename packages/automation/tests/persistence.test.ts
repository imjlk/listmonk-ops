import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { runSegmentDriftSnapshot } from "../src/segment-drift";
import {
	getTemplateRegistryHistory,
	promoteTemplateVersion,
	rollbackTemplateVersion,
	syncTemplateRegistry,
	TemplateRegistryWriteTransactionError,
} from "../src/template-registry";

let temporaryDirectory: string | undefined;
let previousSegmentStore: string | undefined;
let previousTemplateStore: string | undefined;

async function useTemporaryStores() {
	temporaryDirectory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-automation-"),
	);
	previousSegmentStore = process.env.LISTMONK_OPS_SEGMENT_STORE;
	previousTemplateStore = process.env.LISTMONK_OPS_TEMPLATE_REGISTRY;
	const segmentStorePath = join(temporaryDirectory, "segment-drift.json");
	const templateStorePath = join(temporaryDirectory, "template-registry.json");
	process.env.LISTMONK_OPS_SEGMENT_STORE = segmentStorePath;
	process.env.LISTMONK_OPS_TEMPLATE_REGISTRY = templateStorePath;
	return { segmentStorePath, templateStorePath };
}

afterEach(async () => {
	if (previousSegmentStore === undefined) {
		delete process.env.LISTMONK_OPS_SEGMENT_STORE;
	} else {
		process.env.LISTMONK_OPS_SEGMENT_STORE = previousSegmentStore;
	}
	if (previousTemplateStore === undefined) {
		delete process.env.LISTMONK_OPS_TEMPLATE_REGISTRY;
	} else {
		process.env.LISTMONK_OPS_TEMPLATE_REGISTRY = previousTemplateStore;
	}
	previousSegmentStore = undefined;
	previousTemplateStore = undefined;

	if (temporaryDirectory) {
		await rm(temporaryDirectory, { recursive: true, force: true });
		temporaryDirectory = undefined;
	}
});

describe("automation persistence", () => {
	test("preserves every concurrent segment snapshot", async () => {
		const { segmentStorePath } = await useTemporaryStores();
		let requestCount = 0;
		const client = {
			list: {
				list: async () => {
					requestCount += 1;
					const subscriberCount = requestCount * 10;
					await Bun.sleep(requestCount === 1 ? 5 : 0);
					return {
						data: {
							results: [
								{
									id: 1,
									name: "Audience",
									subscriber_count: subscriberCount,
								},
							],
						},
					};
				},
			},
		} as unknown as ListmonkClient;

		const firstSnapshot = runSegmentDriftSnapshot(client);
		while (requestCount < 1) {
			await Bun.sleep(1);
		}
		await Bun.sleep(2);
		const secondSnapshot = runSegmentDriftSnapshot(client);
		const results = await Promise.all([firstSnapshot, secondSnapshot]);
		const persisted = JSON.parse(await readFile(segmentStorePath, "utf8")) as {
			version: number;
			snapshots: Array<{ subscriberCount: number }>;
		};

		expect(results.map((result) => result.storePath)).toEqual([
			segmentStorePath,
			segmentStorePath,
		]);
		expect(persisted.version).toBe(1);
		expect(
			persisted.snapshots.map((snapshot) => snapshot.subscriberCount),
		).toEqual([10, 20]);
		expect(
			results.map((result) => result.comparisons[0]?.previousCount),
		).toEqual([undefined, undefined]);
	});

	test("bounds retained segment snapshots per list", async () => {
		const { segmentStorePath } = await useTemporaryStores();
		const snapshots = Array.from({ length: 1_000 }, (_, index) => ({
			capturedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
			listId: 1,
			listName: "Audience",
			subscriberCount: index,
		}));
		await writeFile(
			segmentStorePath,
			`${JSON.stringify({ version: 1, snapshots })}\n`,
			"utf8",
		);
		const client = {
			list: {
				list: async () => ({
					data: {
						results: [
							{
								id: 1,
								name: "Audience",
								subscriber_count: 1_001,
							},
						],
					},
				}),
			},
		} as unknown as ListmonkClient;

		await runSegmentDriftSnapshot(client);
		const persisted = JSON.parse(await readFile(segmentStorePath, "utf8")) as {
			snapshots: Array<{ subscriberCount: number }>;
		};

		expect(persisted.snapshots).toHaveLength(1_000);
		expect(persisted.snapshots.at(-1)?.subscriberCount).toBe(1_001);
		expect(persisted.snapshots[0]?.subscriberCount).toBe(1);
	});

	test("serializes template versions, promotion, and rollback", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let requestCount = 0;
		const updatedSubjects: string[] = [];
		const client = {
			template: {
				getById: async () => {
					requestCount += 1;
					const currentRequest = requestCount;
					if (currentRequest === 1) {
						await Bun.sleep(10);
					}
					return {
						data: {
							id: 1,
							name: "Transactional template",
							type: "campaign",
							subject:
								currentRequest === 1 ? "Subject 1" : "Subject 2",
							body: "<p>Body</p>",
						},
					};
				},
				update: async ({ body }: { body: { subject: string } }) => {
					updatedSubjects.push(body.subject);
					return { data: {} };
				},
			},
		} as unknown as ListmonkClient;

		const firstSync = syncTemplateRegistry(client, { templateIds: [1] });
		while (requestCount < 1) {
			await Bun.sleep(1);
		}
		await Bun.sleep(2);
		const secondSync = syncTemplateRegistry(client, { templateIds: [1] });
		await Promise.all([firstSync, secondSync]);
		const initialHistory = await getTemplateRegistryHistory(1);
		expect(initialHistory.storePath).toBe(templateStorePath);
		expect(
			initialHistory.versions
				.map((version) => version.snapshot.subject)
				.sort(),
		).toEqual(["Subject 1", "Subject 2"]);
		expect(initialHistory.versions.at(-1)?.snapshot.subject).toBe("Subject 2");

		const unchanged = await syncTemplateRegistry(client, { templateIds: [1] });
		expect(unchanged.createdVersions).toBe(0);
		expect((await getTemplateRegistryHistory(1)).versions).toHaveLength(2);

		const firstVersion = initialHistory.versions[0];
		const lastVersion = initialHistory.versions.at(-1);
		if (!firstVersion || !lastVersion) {
			throw new Error("Expected a second persisted template version");
		}
		await promoteTemplateVersion(client, 1, lastVersion.versionId);
		const rolledBack = await rollbackTemplateVersion(client, 1);

		expect(updatedSubjects).toEqual([
			lastVersion.snapshot.subject,
			firstVersion.snapshot.subject,
		]);
		expect(rolledBack.versionId).toBe(firstVersion.versionId);
		const finalHistory = await getTemplateRegistryHistory(1);
		expect(finalHistory.activeVersionId).toBe(firstVersion.versionId);
	});

	test("reports an unconfirmed registry commit after a remote promotion", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let remoteUpdates = 0;
		let failLocalCommit = false;
		const client = {
			template: {
				getById: async () => ({
					data: {
						id: 1,
						name: "Transactional template",
						type: "campaign",
						subject: "Subject",
						body: "<p>Body</p>",
					},
				}),
				update: async () => {
					remoteUpdates += 1;
					if (failLocalCommit) {
						await rm(templateStorePath, { force: true });
						await mkdir(templateStorePath);
					}
					return { data: {} };
				},
			},
		} as unknown as ListmonkClient;

		await syncTemplateRegistry(client, { templateIds: [1] });
		const history = await getTemplateRegistryHistory(1);
		const version = history.versions[0];
		if (!version) {
			throw new Error("Expected a persisted template version");
		}
		failLocalCommit = true;

		let transactionError: unknown;
		try {
			await promoteTemplateVersion(client, 1, version.versionId);
		} catch (error) {
			transactionError = error;
		}

		expect(transactionError).toBeInstanceOf(
			TemplateRegistryWriteTransactionError,
		);
		expect((transactionError as Error).message).toContain(
			"was updated in Listmonk",
		);
		expect((transactionError as Error).message).toContain(templateStorePath);
		expect(remoteUpdates).toBe(1);
	});

	test("rejects an unsupported segment store version without overwriting it", async () => {
		const { segmentStorePath } = await useTemporaryStores();
		const unsupportedStore = '{"version":2,"snapshots":[]}\n';
		await writeFile(segmentStorePath, unsupportedStore, "utf8");
		const client = {
			list: {
				list: async () => ({ data: { results: [] } }),
			},
		} as unknown as ListmonkClient;

		await expect(runSegmentDriftSnapshot(client)).rejects.toThrow(
			"Invalid segment drift store: expected schema version 1",
		);
		expect(await readFile(segmentStorePath, "utf8")).toBe(unsupportedStore);
	});

	test("rejects a malformed persisted snapshot timestamp", async () => {
		const { segmentStorePath } = await useTemporaryStores();
		await writeFile(
			segmentStorePath,
			`${JSON.stringify({
				version: 1,
				snapshots: [
					{
						capturedAt: "not-a-timestamp",
						listId: 1,
						listName: "Audience",
						subscriberCount: 10,
					},
				],
			})}\n`,
			"utf8",
		);
		const client = {
			list: {
				list: async () => ({ data: { results: [] } }),
			},
		} as unknown as ListmonkClient;

		await expect(runSegmentDriftSnapshot(client)).rejects.toThrow(
			"snapshot 0 failed schema validation",
		);
	});
});
