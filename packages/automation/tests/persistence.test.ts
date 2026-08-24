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
		// Force the later capture to commit first without relying on competing timers.
		let releaseFirstRequest = (): void => {};
		const firstRequestGate = new Promise<void>((resolve) => {
			releaseFirstRequest = resolve;
		});
		const client = {
			list: {
				list: async () => {
					requestCount += 1;
					const currentRequest = requestCount;
					if (currentRequest === 1) {
						await firstRequestGate;
					}
					return {
						data: {
							results: [
								{
									id: 1,
									name: "Audience",
									subscriber_count: currentRequest * 10,
								},
							],
						},
					};
				},
			},
		} as unknown as ListmonkClient;

		const firstSnapshot = runSegmentDriftSnapshot(client);
		// Keep the captures on distinct clock ticks so chronological ordering is testable.
		const firstCaptureUpperBound = Date.now();
		while (requestCount < 1 || Date.now() <= firstCaptureUpperBound) {
			await Bun.sleep(1);
		}
		const secondResult = await runSegmentDriftSnapshot(client).finally(
			releaseFirstRequest,
		);
		const firstResult = await firstSnapshot;
		const results = [firstResult, secondResult];
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

	test("replaces same-key drift snapshots instead of double-weighting", async () => {
		const { segmentStorePath } = await useTemporaryStores();
		const client = {
			list: {
				list: async () => ({
					data: {
						results: [
							{
								id: 1,
								name: "Audience",
								subscriber_count: 100,
							},
						],
					},
				}),
			},
		} as unknown as ListmonkClient;

		const unkeyed = await runSegmentDriftSnapshot(client);
		expect(unkeyed.replaced).toBe(0);
		expect(unkeyed.comparisons[0]?.previousCount).toBeUndefined();

		const firstKeyed = await runSegmentDriftSnapshot(client, {
			sampleKey: "2026-08-19",
		});
		expect(firstKeyed.replaced).toBe(0);
		// The keyed sample compares against the prior unkeyed snapshot, not itself.
		expect(firstKeyed.comparisons[0]?.previousCount).toBe(100);

		const retriedKeyed = await runSegmentDriftSnapshot(client, {
			sampleKey: "2026-08-19",
		});
		// A completed keyed sample replays from the store: the retry returns
		// the originally committed measurement without fetching live counts
		// or overwriting the period's sample.
		expect(retriedKeyed.replaced).toBe(0);
		expect(retriedKeyed.capturedAt).toBe(firstKeyed.capturedAt);
		// The replay returns the ORIGINAL measurement — including its
		// comparison fields — not a recomputation.
		expect(retriedKeyed.comparisons).toEqual(firstKeyed.comparisons);
		expect(retriedKeyed.alerts).toEqual(firstKeyed.alerts);

		const persisted = JSON.parse(await readFile(segmentStorePath, "utf8")) as {
			version: number;
			snapshots: Array<{ sampleKey?: string }>;
		};
		expect(persisted.snapshots.map((snapshot) => snapshot.sampleKey)).toEqual([
			undefined,
			"2026-08-19",
		]);

		await expect(
			runSegmentDriftSnapshot(client, { sampleKey: "   " }),
		).rejects.toThrow("sample key must be a non-empty");
		await expect(
			runSegmentDriftSnapshot(client, {
				sampleKey: `k-${"x".repeat(200)}`,
			}),
		).rejects.toThrow("at most 200 trimmed characters");
		const duplicatedIds = await runSegmentDriftSnapshot(
			{
				list: {
					getById: async () => ({
						data: { id: 7, name: "Repeated", subscriber_count: 5 },
					}),
				},
			} as unknown as ListmonkClient,
			{ listIds: [7, 7], sampleKey: "dup-check" },
		);
		expect(duplicatedIds.replaced).toBe(0);
		expect(duplicatedIds.comparisons).toHaveLength(1);

		// A persisted overlength key is rejected when the store is read, so
		// store state the supported transports could never create cannot
		// silently flow back through a later run.
		const reread = JSON.parse(await readFile(segmentStorePath, "utf8")) as {
			snapshots: Array<{ sampleKey?: string }>;
		};
		reread.snapshots[0]!.sampleKey = `bad-${"y".repeat(200)}`;
		await writeFile(
			segmentStorePath,
			`${JSON.stringify(reread)}\n`,
			"utf8",
		);
		await expect(
			runSegmentDriftSnapshot(client, { sampleKey: "after-bad-read" }),
		).rejects.toThrow("failed schema validation");

		// Whitespace-only persisted keys are also rejected on read.
		const whitespaceRead = JSON.parse(
			await readFile(segmentStorePath, "utf8"),
		) as { snapshots: Array<{ sampleKey?: string }> };
		for (const snapshot of whitespaceRead.snapshots) {
			if (snapshot.sampleKey !== undefined) {
				snapshot.sampleKey = "   ";
			}
		}
		await writeFile(
			segmentStorePath,
			`${JSON.stringify(whitespaceRead)}\n`,
			"utf8",
		);
		await expect(
			runSegmentDriftSnapshot(client, {}),
		).rejects.toThrow("failed schema validation");
	});

	test("keeps the newest same-key snapshot when runs overlap", async () => {
		const { segmentStorePath } = await useTemporaryStores();
		const client = {
			list: {
				list: async () => ({
					data: {
						results: [
							{ id: 1, name: "Audience", subscriber_count: 100 },
						],
					},
				}),
			},
		} as unknown as ListmonkClient;

		// Simulate the winning run of a same-key race: its snapshot is already
		// committed with a capture timestamp newer than any later retry can have.
		await writeFile(
			segmentStorePath,
			`${JSON.stringify({
				version: 1,
				snapshots: [
					{
						capturedAt: "2999-01-01T00:00:00.000Z",
						listId: 1,
						listName: "Audience",
						subscriberCount: 100,
						sampleKey: "race",
					},
				],
			})}\n`,
			"utf8",
		);

		const staleRun = await runSegmentDriftSnapshot(client, {
			sampleKey: "race",
		});
		// The stale run neither replaces the newer snapshot nor appends a
		// duplicate: the newest same-key capture wins.
		expect(staleRun.replaced).toBe(0);
		const persisted = JSON.parse(await readFile(segmentStorePath, "utf8")) as {
			snapshots: Array<{ capturedAt: string; sampleKey?: string }>;
		};
		expect(
			persisted.snapshots.filter((s) => s.sampleKey === "race"),
		).toEqual([
			{
				capturedAt: "2999-01-01T00:00:00.000Z",
				listId: 1,
				listName: "Audience",
				subscriberCount: 100,
				sampleKey: "race",
			},
		]);
	});

	test("serializes template versions, promotion, and rollback", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let requestCount = 0;
		const remote = { subjectOverride: undefined as string | undefined };
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
								remote.subjectOverride ??
								(currentRequest === 1 ? "Subject 1" : "Subject 2"),
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
		// Drift the remote off the captured content so promoting the latest
		// version is a genuine write: with the remote already matching, the
		// promote short-circuits as already-current.
		remote.subjectOverride = "Subject 2 externally touched";
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

	test("redacts remote template errors from registry sync results", async () => {
		await useTemporaryStores();
		const client = {
			template: {
				getById: async () => {
					throw new Error(
						"remote token=private-template-token https://internal.example",
					);
				},
			},
		} as unknown as ListmonkClient;

		let capturedFailure:
			| Readonly<{ templateId: number; error: unknown }>
			| undefined;
		const result = await syncTemplateRegistry(client, {
			templateIds: [42],
			onCaptureError: async (failure) => {
				capturedFailure = failure;
				throw new Error("diagnostic sink failed");
			},
		});
		expect(result.errors).toEqual(["Template 42: capture failed"]);
		expect(capturedFailure).toMatchObject({
			templateId: 42,
			error: expect.any(Error),
		});
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain("private-template-token");
		expect(serialized).not.toContain("internal.example");
	});

	test("pins registry rollbacks to an explicit target version", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let body = "<p>v1</p>";
		const client = {
			template: {
				getById: async () => ({
					data: { id: 10, name: "Pinned", type: "campaign", body },
				}),
				update: async () => ({ data: true }),
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;
		const { syncTemplateRegistry, rollbackTemplateVersion } =
			await import("../src/template-registry");
		await syncTemplateRegistry(client, { templateIds: [10] });
		// A changed body creates the second version rollback targets; keep
		// the captures on distinct timestamps so version ordering is stable.
		body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [10] });

		const record = JSON.parse(await readFile(templateStorePath, "utf8")) as {
			templates: Record<
				string,
				{ versions: { versionId: string }[]; activeVersionId?: string }
			>;
		};
		const versions = record.templates["10"]!.versions;
		// The registry keeps the first capture active; promote the second so
		// the pinned rollback has a genuine previous version to target.
		const { promoteTemplateVersion } = await import("../src/template-registry");
		const newer = versions.find(
			(version) => version.versionId !== record.templates["10"]!.activeVersionId,
		)!;
		await promoteTemplateVersion(client, 10, newer.versionId);
		const target = record.templates["10"]!.activeVersionId!;

		const rolled = await rollbackTemplateVersion(client, 10, {
			toVersionId: target,
		});
		expect(rolled.rolledBack).toBe(true);
		expect(rolled.activeVersionId).toBe(target);

		// An identical pinned retry is a documented no-op.
		const retried = await rollbackTemplateVersion(client, 10, {
			toVersionId: target,
		});
		expect(retried.rolledBack).toBe(false);
		expect(retried.activeVersionId).toBe(target);
	});

	test("conflicts ABA rollbacks through the source pin", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let body = "<p>v1</p>";
		const client = {
			template: {
				getById: async () => ({
					data: { id: 11, name: "ABA", type: "campaign", body },
				}),
				update: async () => ({ data: true }),
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;
		const { syncTemplateRegistry, rollbackTemplateVersion } =
			await import("../src/template-registry");
		await syncTemplateRegistry(client, { templateIds: [11] });
		body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [11] });

		const record = JSON.parse(await readFile(templateStorePath, "utf8")) as {
			templates: Record<
				string,
				{ versions: { versionId: string }[]; activeVersionId?: string }
			>;
		};
		// The registry keeps the FIRST capture active; promote the newer
		// version first so the rollback has a genuine previous target.
		const { promoteTemplateVersion } = await import("../src/template-registry");
		const initialActive = record.templates["11"]!.activeVersionId!;
		const previous = record.templates["11"]!.versions.find(
			(version) => version.versionId !== initialActive,
		)!;
		await promoteTemplateVersion(client, 11, previous.versionId);
		const active = previous.versionId;

		// Pin the observed source (active) and target (previous): the
		// rollback fires once...
		const rolled = await rollbackTemplateVersion(client, 11, {
			toVersionId: initialActive,
			fromVersionId: active,
		});
		expect(rolled.rolledBack).toBe(true);

		// ...promoting the original back (the ABA transition) restores the
		// expected previous-version relationship, so a to-only repeat would
		// silently roll again — the source pin conflicts instead.
		await promoteTemplateVersion(client, 11, active);
		await expect(
			rollbackTemplateVersion(client, 11, {
				toVersionId: initialActive,
				fromVersionId: initialActive,
			}),
		).rejects.toThrow(/source pin .* no longer matches/);

		// A matching source pin on the current head stays a no-op retry.
		const noop = await rollbackTemplateVersion(client, 11, {
			toVersionId: active,
			fromVersionId: active,
		});
		expect(noop.rolledBack).toBe(false);
	});

	test("conflicts registry head cycles through the head revision pin", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let body = "<p>v1</p>";
		const client = {
			template: {
				getById: async () => ({
					data: { id: 12, name: "Head", type: "campaign", body },
				}),
				update: async () => ({ data: true }),
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;
		const { syncTemplateRegistry, rollbackTemplateVersion } =
			await import("../src/template-registry");
		await syncTemplateRegistry(client, { templateIds: [12] });
		body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [12] });

		const record = JSON.parse(await readFile(templateStorePath, "utf8")) as {
			templates: Record<string, { versions: { versionId: string }[] }>;
		};
		const { promoteTemplateVersion, getTemplateRegistryHistory } =
			await import("../src/template-registry");
		const versions = record.templates["12"]!.versions;
		const initialActive = (
			await getTemplateRegistryHistory(12)
		).activeVersionId!;
		const newer = versions.find(
			(version) => version.versionId !== initialActive,
		)!;

		// v1 → v2 → v1 → v2: a full cycle that restores both the active
		// version id and the remote content. Every transition advances the
		// monotonic head revision, which is what a pinned retry echoes.
		const firstPromote = await promoteTemplateVersion(client, 12, newer.versionId);
		expect(firstPromote.headRevision).toBe(1);
		const rolled = await rollbackTemplateVersion(client, 12, {
			toVersionId: initialActive,
			fromVersionId: newer.versionId,
		});
		expect(rolled.headRevision).toBe(2);
		const cyclePromote = await promoteTemplateVersion(
			client,
			12,
			newer.versionId,
		);
		expect(cyclePromote.headRevision).toBe(3);
		expect((await getTemplateRegistryHistory(12)).headRevision).toBe(3);

		// After the cycle the registry is indistinguishable from the original
		// observation — same active version, same remote hash — so a retry
		// echoing the original pins AND the echoed head revision conflicts
		// instead of silently rolling back over the re-promotion.
		await expect(
			rollbackTemplateVersion(client, 12, {
				toVersionId: initialActive,
				fromVersionId: newer.versionId,
				expectedHeadRevision: rolled.headRevision,
			}),
		).rejects.toThrow(/head revision pin .* no longer matches/);

		// A same-version re-promotion — the registry-managed way to restore
		// drifted remote content — is still a write: it advances the head,
		// so a stale pinned rollback from before it conflicts even though
		// the active version never changed. (Drift the remote first: with
		// the remote still matching, the promote short-circuits as
		// already-current instead of writing.)
		body = "<p>drifted</p>";
		const rePromote = await promoteTemplateVersion(
			client,
			12,
			newer.versionId,
		);
		expect(rePromote.headRevision).toBe(4);
		expect(rePromote.activeVersionId).toBe(newer.versionId);
		await expect(
			rollbackTemplateVersion(client, 12, {
				toVersionId: initialActive,
				fromVersionId: newer.versionId,
				expectedHeadRevision: 3,
			}),
		).rejects.toThrow(/head revision pin .* no longer matches/);

		// Without the head pin this cycle is indistinguishable from the
		// original observation and an echoed retry would roll again; a fresh
		// observation via history pins the current head, and that retry is
		// the already-applied no-op.
		const currentHead = (await getTemplateRegistryHistory(12)).headRevision;
		const noop = await rollbackTemplateVersion(client, 12, {
			toVersionId: newer.versionId,
			fromVersionId: newer.versionId,
			expectedHeadRevision: currentHead,
		});
		expect(noop.rolledBack).toBe(false);
	});

	test("short-circuits an already-current promotion without writing", async () => {
		await useTemporaryStores();
		let body = "<p>v1</p>";
		let updates = 0;
		const client = {
			template: {
				getById: async () => ({
					data: { id: 13, name: "Current", type: "campaign", body },
				}),
				update: async () => {
					updates += 1;
					return { data: true };
				},
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;
		const { syncTemplateRegistry, promoteTemplateVersion } =
			await import("../src/template-registry");
		await syncTemplateRegistry(client, { templateIds: [13] });
		body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [13] });

		const history = await (
			await import("../src/template-registry")
		).getTemplateRegistryHistory(13);
		const newer = history.versions.find(
			(version) => version.versionId !== history.activeVersionId,
		)!;

		const promoted = await promoteTemplateVersion(client, 13, newer.versionId);
		expect(promoted.promoted).toBe(true);
		expect(promoted.headRevision).toBe(1);
		expect(updates).toBe(1);

		// The remote still carries the promoted content, so repeating the
		// same promotion is an already-current no-op: no PUT, no head
		// advance, and other callers' head pins stay valid.
		const repeated = await promoteTemplateVersion(client, 13, newer.versionId);
		expect(repeated.promoted).toBe(false);
		expect(repeated.headRevision).toBe(1);
		expect(updates).toBe(1);
	});

	test("conflicts rollbacks over remote drift through the hash pin", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let body = "<p>v1</p>";
		const client = {
			template: {
				getById: async () => ({
					data: { id: 12, name: "Drift", type: "campaign", body },
				}),
				update: async () => ({ data: true }),
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;
		const { syncTemplateRegistry, rollbackTemplateVersion } =
			await import("../src/template-registry");
		await syncTemplateRegistry(client, { templateIds: [12] });
		body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [12] });

		const record = JSON.parse(await readFile(templateStorePath, "utf8")) as {
			templates: Record<
				string,
				{ versions: { versionId: string }[]; activeVersionId?: string }
			>;
		};
		const active = record.templates["12"]!.activeVersionId!;
		const previous = record.templates["12"]!.versions.find(
			(version) => version.versionId !== active,
		)!;

		// The remote template mutates outside the registry before the retry:
		// the observed-hash pin conflicts instead of rolling back over it.
		body = "<p>externally mutated</p>";
		await expect(
			rollbackTemplateVersion(client, 12, {
				toVersionId: previous.versionId,
				fromVersionId: active,
				expectedRemoteHash: "sha256:0123456789abcdef0123456789abcdef",
			}),
		).rejects.toThrow(/remote hash mismatch/);
	});

	test("reports an unconfirmed registry commit after a remote promotion", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let remoteUpdates = 0;
		let failLocalCommit = false;
		let remoteSubject = "Subject A";
		const client = {
			template: {
				getById: async () => ({
					data: {
						id: 1,
						name: "Transactional template",
						type: "campaign",
						subject: remoteSubject,
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
		// Drift the remote off the captured content: with the remote already
		// matching, promoting the same version short-circuits as
		// already-current and never issues the remote update this test
		// needs to leave uncommitted.
		remoteSubject = "Subject B";
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
