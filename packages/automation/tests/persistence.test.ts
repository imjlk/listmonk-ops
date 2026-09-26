import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeTemplateRegistryRollbackOperation,
	invokeTemplateRegistrySyncOperation,
} from "../src/ops-operations";
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

/**
 * An in-memory Listmonk template that applies writes like the real remote,
 * so registry flows observe the content they promote or roll back.
 */
function createTemplateRemote(templateId: number, body: string) {
	const remote = { body, writes: [] as string[] };
	const client = {
		template: {
			getById: async () => ({
				data: {
					id: templateId,
					name: "Registry",
					type: "campaign",
					subject: "Subject",
					body: remote.body,
				},
			}),
			update: async ({ body: update }: { body: { body: string } }) => {
				remote.writes.push(update.body);
				remote.body = update.body;
				return { data: true };
			},
		},
	} as unknown as ListmonkClient;
	return { remote, client };
}

/**
 * Mimics Listmonk 6.2 template updates: an empty campaign-template subject
 * is stored as the template name, and the response returns the stored
 * template.
 */
function createNormalizingTemplateRemote(templateId: number, body: string) {
	const remote = { subject: "", body, writes: [] as string[] };
	const stored = () => ({
		id: templateId,
		name: "Registry",
		type: "campaign",
		subject: remote.subject,
		body: remote.body,
	});
	const client = {
		template: {
			getById: async () => ({ data: stored() }),
			update: async ({
				body: update,
			}: {
				body: { name: string; subject: string; body: string };
			}) => {
				remote.writes.push(update.body);
				remote.subject = update.subject || update.name;
				remote.body = update.body;
				return { data: stored() };
			},
		},
	} as unknown as ListmonkClient;
	return { remote, client };
}

/** Edit the template outside the registry, then capture it. */
async function editAndSync(
	remote: { body: string },
	client: ListmonkClient,
	templateId: number,
	body: string,
) {
	remote.body = body;
	// Distinct capture timestamps keep the version order stable.
	await Bun.sleep(2);
	return syncTemplateRegistry(client, { templateIds: [templateId] });
}

function versionIdFor(
	history: { versions: { versionId: string; snapshot: { body: string } }[] },
	body: string,
): string {
	const version = history.versions.find(
		(candidate) => candidate.snapshot.body === body,
	);
	if (!version) {
		throw new Error(`Expected a stored version with body ${body}`);
	}
	return version.versionId;
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
				// Apply writes like the real remote: an unpinned rollback
				// resolves its target from the live template content.
				update: async ({ body }: { body: { subject: string } }) => {
					updatedSubjects.push(body.subject);
					remote.subjectOverride = body.subject;
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
		// The older capture may commit last, but it never becomes active:
		// only the newest observation describes what is live.
		expect(initialHistory.activeVersionId).toBe(
			initialHistory.versions.at(-1)?.versionId,
		);

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
				// Apply writes like the real remote so the rollback's
				// already-applied verification observes them.
				update: async ({ body: updateBody }: { body: { body: string } }) => {
					body = updateBody.body;
					return { data: true };
				},
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
		// The second sync recorded the live v2 content and made it active, so
		// the v1 capture is the pinned rollback's genuine previous version.
		const [older, newer] = record.templates["10"]!.versions;
		expect(record.templates["10"]!.activeVersionId).toBe(newer!.versionId);
		const target = older!.versionId;

		const rolled = await rollbackTemplateVersion(client, 10, {
			toVersionId: target,
		});
		expect(rolled.rolledBack).toBe(true);
		expect(rolled.activeVersionId).toBe(target);
		expect(body).toBe("<p>v1</p>");

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
				// Apply writes like the real remote so the rollback's
				// already-applied verification observes them.
				update: async ({ body: updateBody }: { body: { body: string } }) => {
					body = updateBody.body;
					return { data: true };
				},
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
		// The second sync recorded the live v2 content and made it active,
		// so the v1 capture is the rollback's genuine previous target.
		const { promoteTemplateVersion } = await import("../src/template-registry");
		const active = record.templates["11"]!.activeVersionId!;
		const previous = record.templates["11"]!.versions.find(
			(version) => version.versionId !== active,
		)!;

		// Pin the observed source (active) and target (previous): the
		// rollback fires once...
		const rolled = await rollbackTemplateVersion(client, 11, {
			toVersionId: previous.versionId,
			fromVersionId: active,
		});
		expect(rolled.rolledBack).toBe(true);

		// ...promoting the original back (the ABA transition) restores the
		// expected previous-version relationship, so a to-only repeat would
		// silently roll again — the source pin conflicts instead.
		await promoteTemplateVersion(client, 11, active);
		await expect(
			rollbackTemplateVersion(client, 11, {
				toVersionId: previous.versionId,
				fromVersionId: previous.versionId,
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
				// Apply writes like the real remote so the rollback's
				// already-applied verification observes them.
				update: async ({ body: updateBody }: { body: { body: string } }) => {
					body = updateBody.body;
					return { data: true };
				},
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
		// The second sync made the live v2 capture active without a
		// registry-managed write, so the head revision is still 0.
		const observed = await getTemplateRegistryHistory(12);
		expect(observed.headRevision).toBe(0);
		const newer = versions.find(
			(version) => version.versionId === observed.activeVersionId,
		)!;
		const olderVersionId = versions.find(
			(version) => version.versionId !== newer.versionId,
		)!.versionId;

		// v2 → v1 → v2: a full cycle that restores both the active version
		// id and the remote content. Every registry-managed transition
		// advances the monotonic head revision, which is what a pinned retry
		// echoes.
		const rolled = await rollbackTemplateVersion(client, 12, {
			toVersionId: olderVersionId,
			fromVersionId: newer.versionId,
		});
		expect(rolled.headRevision).toBe(1);
		const cyclePromote = await promoteTemplateVersion(
			client,
			12,
			newer.versionId,
		);
		expect(cyclePromote.headRevision).toBe(2);
		expect((await getTemplateRegistryHistory(12)).headRevision).toBe(2);

		// After the cycle the registry is indistinguishable from the original
		// observation — same active version, same remote hash — so a retry
		// echoing the original pins AND the echoed head revision conflicts
		// instead of silently rolling back over the re-promotion.
		await expect(
			rollbackTemplateVersion(client, 12, {
				toVersionId: olderVersionId,
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
		expect(rePromote.headRevision).toBe(3);
		expect(rePromote.activeVersionId).toBe(newer.versionId);
		await expect(
			rollbackTemplateVersion(client, 12, {
				toVersionId: olderVersionId,
				fromVersionId: newer.versionId,
				expectedHeadRevision: 2,
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

	test("reapplies a rollback whose target drifted while marked active", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let body = "<p>v1</p>";
		const writtenBodies: string[] = [];
		const client = {
			template: {
				getById: async () => ({
					data: { id: 15, name: "Drifted", type: "campaign", body },
				}),
				update: async ({ body: updateBody }: { body: { body: string } }) => {
					writtenBodies.push(updateBody.body);
					body = updateBody.body;
					return { data: true };
				},
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;
		const { syncTemplateRegistry, rollbackTemplateVersion } =
			await import("../src/template-registry");
		await syncTemplateRegistry(client, { templateIds: [15] });
		body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [15] });
		const { getTemplateRegistryHistory } = await import(
			"../src/template-registry"
		);
		const history = await getTemplateRegistryHistory(15);
		// The second sync made the live v2 capture active, so the v1 capture
		// is the rollback target.
		const target = history.versions.find(
			(version) => version.versionId !== history.activeVersionId,
		)!.versionId;
		// Make the target (v1) the active version through the normal
		// rollback path, so the remote genuinely carries it.
		const rolled = await rollbackTemplateVersion(client, 15, {
			toVersionId: target,
		});
		expect(rolled.rolledBack).toBe(true);

		// The remote drifts away from the target while the registry still
		// marks it active: a pinned retry must repair the drift, not report
		// an already-applied no-op over the wrong content.
		body = "<p>externally drifted</p>";
		const repaired = await rollbackTemplateVersion(client, 15, {
			toVersionId: target,
		});
		expect(repaired.rolledBack).toBe(true);
		expect(writtenBodies.at(-1)).toBe("<p>v1</p>");
		expect(body).toBe("<p>v1</p>");

		// With the remote matching again, the same pinned retry is the
		// documented no-op.
		const noop = await rollbackTemplateVersion(client, 15, {
			toVersionId: target,
		});
		expect(noop.rolledBack).toBe(false);
	});

	test("short-circuits an already-current promotion without writing", async () => {		await useTemporaryStores();
		let body = "<p>v1</p>";
		let updates = 0;
		const client = {
			template: {
				getById: async () => ({
					data: { id: 13, name: "Current", type: "campaign", body },
				}),
				// Apply writes like the real remote so the repeated promotion
				// observes the content the first one wrote.
				update: async ({ body: updateBody }: { body: { body: string } }) => {
					updates += 1;
					body = updateBody.body;
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
		// The sync made the live v2 capture active; promoting the older v1
		// capture is a genuine write.
		const older = history.versions.find(
			(version) => version.versionId !== history.activeVersionId,
		)!;

		const promoted = await promoteTemplateVersion(client, 13, older.versionId);
		expect(promoted.promoted).toBe(true);
		expect(promoted.headRevision).toBe(1);
		expect(updates).toBe(1);

		// The remote still carries the promoted content, so repeating the
		// same promotion is an already-current no-op: no PUT, no head
		// advance, and other callers' head pins stay valid.
		const repeated = await promoteTemplateVersion(client, 13, older.versionId);
		expect(repeated.promoted).toBe(false);
		expect(repeated.headRevision).toBe(1);
		expect(updates).toBe(1);
	});

	test("does not report an unconfirmed remote commit for an already-current promotion", async () => {
		const { templateStorePath } = await useTemporaryStores();
		let remoteUpdates = 0;
		let sabotageLocalCommit = false;
		const client = {
			template: {
				getById: async () => {
					if (sabotageLocalCommit) {
						await rm(templateStorePath, { force: true });
						await mkdir(templateStorePath);
					}
					return {
						data: {
							id: 14,
							name: "Current no-op",
							type: "campaign",
							subject: "Subject",
							body: "<p>Body</p>",
						},
					};
				},
				update: async () => {
					remoteUpdates += 1;
					return { data: {} };
				},
			},
		} as unknown as import("@listmonk-ops/openapi").ListmonkClient;
		const {
			syncTemplateRegistry,
			promoteTemplateVersion,
			getTemplateRegistryHistory,
			TemplateRegistryWriteTransactionError,
		} = await import("../src/template-registry");
		await syncTemplateRegistry(client, { templateIds: [14] });
		const history = await getTemplateRegistryHistory(14);
		const version = history.versions[0];
		if (!version) {
			throw new Error("Expected a persisted template version");
		}
		sabotageLocalCommit = true;

		let storeError: unknown;
		try {
			await promoteTemplateVersion(client, 14, version.versionId);
		} catch (error) {
			storeError = error;
		}
		// The no-op never touched Listmonk, so the failing local commit is
		// a plain store error — not the unconfirmed-remote-commit wrapper
		// that demands remote reconciliation.
		expect(storeError).toBeInstanceOf(Error);
		expect(storeError).not.toBeInstanceOf(
			TemplateRegistryWriteTransactionError,
		);
		expect(remoteUpdates).toBe(0);
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

describe("template registry active version", () => {
	test("rolls a synced edit back to the version captured before it", async () => {
		await useTemporaryStores();
		const { remote, client } = createTemplateRemote(21, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [21] });
		// Edited outside the registry (a manifest apply, say), then synced.
		await editAndSync(remote, client, 21, "<p>v2</p>");
		const v1 = versionIdFor(await getTemplateRegistryHistory(21), "<p>v1</p>");

		const rolled = await rollbackTemplateVersion(client, 21);
		expect(rolled).toMatchObject({
			versionId: v1,
			activeVersionId: v1,
			rolledBack: true,
		});
		expect(remote.body).toBe("<p>v1</p>");
		expect(remote.writes).toEqual(["<p>v1</p>"]);
	});

	test("rolls back to a promoted version after a later synced edit", async () => {
		await useTemporaryStores();
		const { remote, client } = createTemplateRemote(22, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [22] });
		await editAndSync(remote, client, 22, "<p>v2</p>");
		const v2 = versionIdFor(await getTemplateRegistryHistory(22), "<p>v2</p>");
		await promoteTemplateVersion(client, 22, v2);
		await editAndSync(remote, client, 22, "<p>v3</p>");

		// The version immediately preceding the live v3 capture is v2; v1
		// must not be skipped to.
		const rolled = await rollbackTemplateVersion(client, 22);
		expect(rolled.versionId).toBe(v2);
		expect(remote.body).toBe("<p>v2</p>");
		expect((await getTemplateRegistryHistory(22)).activeVersionId).toBe(v2);
	});

	test("fails closed when the live template changed after the last sync", async () => {
		await useTemporaryStores();
		const { remote, client } = createTemplateRemote(23, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [23] });
		await editAndSync(remote, client, 23, "<p>v2</p>");
		const observed = await getTemplateRegistryHistory(23);
		// Edited outside the registry and never synced.
		remote.body = "<p>v3 unrecorded</p>";

		await expect(rollbackTemplateVersion(client, 23)).rejects.toMatchObject({
			name: "TemplateRegistryDriftError",
			activeVersionId: observed.activeVersionId,
			matchingVersionIds: [],
			message: expect.stringMatching(
				/matches no stored registry version.*registry-sync.*to_version_id/,
			),
		});
		// Nothing was guessed: no remote write and no registry change.
		expect(remote.writes).toEqual([]);
		expect(await getTemplateRegistryHistory(23)).toEqual(observed);

		// Syncing first records the edit as the active version, and the
		// rollback then reverts exactly that edit.
		await editAndSync(remote, client, 23, "<p>v3 unrecorded</p>");
		const rolled = await rollbackTemplateVersion(client, 23);
		expect(rolled.versionId).toBe(versionIdFor(observed, "<p>v2</p>"));
		expect(remote.body).toBe("<p>v2</p>");
	});

	test("does not guess when live content equals an older stored version", async () => {
		await useTemporaryStores();
		const { remote, client } = createTemplateRemote(24, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [24] });
		await editAndSync(remote, client, 24, "<p>v2</p>");
		await editAndSync(remote, client, 24, "<p>v3</p>");
		const history = await getTemplateRegistryHistory(24);
		// Restored to v1's content outside the registry: where that state
		// sits in history is unknown, so any rollback target would be a guess.
		remote.body = "<p>v1</p>";

		await expect(rollbackTemplateVersion(client, 24)).rejects.toMatchObject({
			name: "TemplateRegistryDriftError",
			matchingVersionIds: [versionIdFor(history, "<p>v1</p>")],
		});
		expect(remote.writes).toEqual([]);
	});

	test("lets a pinned rollback overwrite unrecorded live content explicitly", async () => {
		await useTemporaryStores();
		const { remote, client } = createTemplateRemote(25, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [25] });
		await editAndSync(remote, client, 25, "<p>v2</p>");
		await editAndSync(remote, client, 25, "<p>v3</p>");
		const history = await getTemplateRegistryHistory(25);
		const v1 = versionIdFor(history, "<p>v1</p>");
		const v2 = versionIdFor(history, "<p>v2</p>");
		remote.body = "<p>unrecorded</p>";

		// The pin stays relative to the active v3 version, so a pin further
		// back conflicts instead of rolling past v2.
		await expect(
			rollbackTemplateVersion(client, 25, { toVersionId: v1 }),
		).rejects.toThrow(/no longer the previous version/);
		expect(remote.writes).toEqual([]);

		const rolled = await rollbackTemplateVersion(client, 25, {
			toVersionId: v2,
		});
		expect(rolled).toMatchObject({
			versionId: v2,
			activeVersionId: v2,
			rolledBack: true,
		});
		expect(remote.body).toBe("<p>v2</p>");
	});

	test("keeps a promoted version active across syncs of its content", async () => {
		await useTemporaryStores();
		const { remote, client } = createTemplateRemote(26, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [26] });
		await editAndSync(remote, client, 26, "<p>v2</p>");
		await editAndSync(remote, client, 26, "<p>v3</p>");
		const history = await getTemplateRegistryHistory(26);
		const [v1, v2, v3] = history.versions.map((version) => version.versionId);
		// Each sync activated the live capture, so promoting it is an
		// already-current no-op.
		expect(history.activeVersionId).toBe(v3);
		expect(await promoteTemplateVersion(client, 26, v3!)).toMatchObject({
			promoted: false,
			headRevision: 0,
		});
		expect(remote.writes).toEqual([]);

		// Syncing a promoted older version's content records nothing: a
		// duplicate capture at the end of history would make the next
		// rollback undo the promotion instead of stepping back from it.
		await promoteTemplateVersion(client, 26, v2!);
		await Bun.sleep(2);
		const synced = await syncTemplateRegistry(client, { templateIds: [26] });
		expect(synced).toMatchObject({ createdVersions: 0, unchangedTemplates: 1 });
		expect(synced.templates[0]?.versionId).toBe(v2);
		const afterSync = await getTemplateRegistryHistory(26);
		expect(afterSync.versions).toHaveLength(3);
		expect(afterSync.activeVersionId).toBe(v2);

		const rolled = await rollbackTemplateVersion(client, 26);
		expect(rolled.versionId).toBe(v1);
		expect(remote.body).toBe("<p>v1</p>");
	});

	test("does not let a capture that raced a promotion move the active version", async () => {
		await useTemporaryStores();
		let body = "<p>v1</p>";
		let heldCapture:
			| { observed: () => void; release: Promise<void> }
			| undefined;
		const client = {
			template: {
				getById: async () => {
					const data = { id: 27, name: "Race", type: "campaign", body };
					const hold = heldCapture;
					heldCapture = undefined;
					if (hold) {
						hold.observed();
						await hold.release;
					}
					return { data };
				},
				update: async ({ body: update }: { body: { body: string } }) => {
					body = update.body;
					return { data: true };
				},
			},
		} as unknown as ListmonkClient;
		await syncTemplateRegistry(client, { templateIds: [27] });
		body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [27] });
		const v1 = versionIdFor(await getTemplateRegistryHistory(27), "<p>v1</p>");

		let captureObserved = (): void => {};
		let releaseCapture = (): void => {};
		const observed = new Promise<void>((resolve) => {
			captureObserved = resolve;
		});
		heldCapture = {
			observed: () => captureObserved(),
			release: new Promise<void>((resolve) => {
				releaseCapture = resolve;
			}),
		};
		// Newer than every stored version, so only the race makes it stale.
		await Bun.sleep(2);
		const racingSync = syncTemplateRegistry(client, { templateIds: [27] });
		// The sync read the live v2 content; a promotion commits while that
		// capture is still in flight...
		await observed;
		await promoteTemplateVersion(client, 27, v1);
		releaseCapture();
		// ...so the stale v2 observation must not reactivate v2 over it.
		expect(await racingSync).toMatchObject({ createdVersions: 0 });
		expect((await getTemplateRegistryHistory(27)).activeVersionId).toBe(v1);
		expect(body).toBe("<p>v1</p>");
	});

	test("repairs a legacy registry whose sync left a stale active version", async () => {
		const { templateStorePath } = await useTemporaryStores();
		const { remote, client } = createTemplateRemote(28, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [28] });
		await editAndSync(remote, client, 28, "<p>v2</p>");
		// Recreate a schema version 1 file an older sync wrote: the active
		// version stayed on the first capture while v2 went live.
		const store = JSON.parse(await readFile(templateStorePath, "utf8")) as {
			version: number;
			templates: Record<
				string,
				{ activeVersionId?: string; versions: { versionId: string }[] }
			>;
		};
		expect(store.version).toBe(1);
		const [v1, v2] = store.templates["28"]!.versions.map(
			(version) => version.versionId,
		);
		store.templates["28"]!.activeVersionId = v1;
		const legacyStore = `${JSON.stringify(store)}\n`;

		// A sync points the active version at the live capture without
		// recording a duplicate.
		await writeFile(templateStorePath, legacyStore, "utf8");
		await Bun.sleep(2);
		const synced = await syncTemplateRegistry(client, { templateIds: [28] });
		expect(synced.createdVersions).toBe(0);
		expect((await getTemplateRegistryHistory(28)).activeVersionId).toBe(v2);

		// Without that sync, the rollback still resolves the live v2 content.
		await writeFile(templateStorePath, legacyStore, "utf8");
		const rolled = await rollbackTemplateVersion(client, 28);
		expect(rolled.versionId).toBe(v1);
		expect(remote.body).toBe("<p>v1</p>");
	});

	test("recognizes a written version after Listmonk normalizes it", async () => {
		await useTemporaryStores();
		const { remote, client } = createNormalizingTemplateRemote(
			30,
			"<p>v1</p>",
		);
		await syncTemplateRegistry(client, { templateIds: [30] });
		// A manifest apply edits the template; Listmonk stores the name as the
		// subject the v1 capture left empty.
		remote.subject = "Registry";
		remote.body = "<p>v2</p>";
		await Bun.sleep(2);
		await syncTemplateRegistry(client, { templateIds: [30] });
		const v1 = versionIdFor(await getTemplateRegistryHistory(30), "<p>v1</p>");

		const rolled = await rollbackTemplateVersion(client, 30);
		expect(rolled.versionId).toBe(v1);
		// The live v1 content no longer hashes to its snapshot, yet the
		// registry knows its own write produced it: nothing reads as drift.
		expect(remote.subject).toBe("Registry");
		await expect(rollbackTemplateVersion(client, 30)).rejects.toThrow(
			"Template 30 has no previous version to roll back to",
		);
		expect(
			await syncTemplateRegistry(client, { templateIds: [30] }),
		).toMatchObject({ createdVersions: 0 });
		expect(
			await rollbackTemplateVersion(client, 30, { toVersionId: v1 }),
		).toMatchObject({ rolledBack: false });
		expect(await promoteTemplateVersion(client, 30, v1)).toMatchObject({
			promoted: false,
		});
		expect(remote.writes).toEqual(["<p>v1</p>"]);
	});

	test("rejects a malformed stored write observation", async () => {
		const { templateStorePath } = await useTemporaryStores();
		const { client } = createTemplateRemote(31, "<p>v1</p>");
		await syncTemplateRegistry(client, { templateIds: [31] });
		const store = JSON.parse(await readFile(templateStorePath, "utf8")) as {
			templates: Record<string, Record<string, unknown>>;
		};
		store.templates["31"]!.lastWrite = { versionId: 31 };
		await writeFile(templateStorePath, `${JSON.stringify(store)}\n`, "utf8");

		await expect(getTemplateRegistryHistory(31)).rejects.toThrow(
			"template 31 failed schema validation",
		);
	});

	test("shares the live-version semantics with the CLI and MCP operations", async () => {
		await useTemporaryStores();
		const { remote, client } = createTemplateRemote(29, "<p>v1</p>");
		await invokeTemplateRegistrySyncOperation({ client }, { template_id: 29 });
		remote.body = "<p>v2</p>";
		await Bun.sleep(2);
		await invokeTemplateRegistrySyncOperation({ client }, { template_id: 29 });

		const rolled = await invokeTemplateRegistryRollbackOperation(
			{ client },
			{ template_id: 29 },
		);
		expect(rolled.rolledBack).toBe(true);
		expect(remote.body).toBe("<p>v1</p>");

		remote.body = "<p>unrecorded</p>";
		await expect(
			invokeTemplateRegistryRollbackOperation({ client }, { template_id: 29 }),
		).rejects.toThrow(/changed outside the registry.*registry-sync/);
		expect(remote.writes).toEqual(["<p>v1</p>"]);
	});
});
