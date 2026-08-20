import {
	commitJsonFileStoreUpdate,
	type JsonFileStore,
	readJsonFileStore,
	updateJsonFileStore,
} from "@listmonk-ops/common";
import type { List, ListmonkClient } from "@listmonk-ops/openapi";

import { getListById, unwrapResponseData } from "./api";
import {
	extractResults,
	getOpsStorePaths,
	isRecord,
	toPositiveInt,
} from "./core";

const MAX_SEGMENT_SNAPSHOTS_PER_LIST = 1_000;

export interface SegmentSnapshotEntry {
	capturedAt: string;
	listId: number;
	listName: string;
	subscriberCount: number;
	/** Caller-scoped sampling period; same-key entries replace their predecessor. */
	sampleKey?: string;
}

/**
 * A committed keyed sample's original result, persisted so an identical
 * retry replays the exact measurement (including alerts) instead of
 * re-observing live counts.
 */
export interface StoredSegmentDriftSettings {
	threshold: number;
	minAbsoluteChange: number;
	lookbackDays: number;
	baselineMode: "previous" | "lookback-mean" | "lookback-median";
}

export interface StoredSegmentDriftResult {
	scope: "all" | "lists";
	listIds: number[];
	capturedAt: string;
	settings: StoredSegmentDriftSettings;
	comparisons: SegmentDriftComparison[];
	alerts: SegmentDriftComparison[];
}

/** Upper bound on retained replay records so the store cannot grow unbounded. */
const MAX_STORED_KEYED_RESULTS = 100;

export interface SegmentDriftStore {
	version: 1;
	snapshots: SegmentSnapshotEntry[];
	keyedResults?: Record<string, StoredSegmentDriftResult>;
}

export interface SegmentDriftOptions {
	listIds?: number[];
	threshold?: number;
	minAbsoluteChange?: number;
	lookbackDays?: number;
	/** How to compute the baseline for alert decisions. */
	baselineMode?: "previous" | "lookback-mean" | "lookback-median";
	/**
	 * Caller-scoped sampling period key. Snapshots sharing a listId and
	 * sampleKey replace their predecessor instead of appending, so an
	 * ambiguous retry never double-weights the same period.
	 */
	sampleKey?: string;
}

export interface SegmentDriftComparison {
	listId: number;
	listName: string;
	previousCount?: number;
	currentCount: number;
	baselineCount?: number;
	delta?: number;
	deltaRate?: number;
	alert: boolean;
}

export interface SegmentDriftResult {
	capturedAt: string;
	storePath: string;
	threshold: number;
	minAbsoluteChange: number;
	/** Snapshots replaced by this run because they shared its sample key. */
	replaced: number;
	comparisons: SegmentDriftComparison[];
	alerts: SegmentDriftComparison[];
}

function parseSegmentDriftStore(value: unknown): SegmentDriftStore {
	if (!isRecord(value) || value.version !== 1) {
		throw new Error("Invalid segment drift store: expected schema version 1");
	}
	if (!Array.isArray(value.snapshots)) {
		throw new Error("Invalid segment drift store: snapshots must be an array");
	}

	const keyedResults: unknown = value.keyedResults;
	if (keyedResults !== undefined) {
		const isValidComparison = (comparison: unknown): boolean => {
			if (!isRecord(comparison)) return false;
			return (
				typeof comparison.listId === "number" &&
				Number.isInteger(comparison.listId) &&
				comparison.listId > 0 &&
				typeof comparison.listName === "string" &&
				typeof comparison.currentCount === "number" &&
				Number.isFinite(comparison.currentCount) &&
				comparison.currentCount >= 0 &&
				typeof comparison.alert === "boolean" &&
				(comparison.previousCount === undefined ||
					typeof comparison.previousCount === "number") &&
				(comparison.baselineCount === undefined ||
					typeof comparison.baselineCount === "number") &&
				(comparison.delta === undefined ||
					typeof comparison.delta === "number") &&
				(comparison.deltaRate === undefined ||
					typeof comparison.deltaRate === "number")
			);
		};
		const keyedRecord = keyedResults as Record<string, unknown>;
		for (const [key, storedEntry] of Object.entries(keyedRecord)) {
			const stored: unknown = storedEntry;
			if (
				!isRecord(stored) ||
				(stored.scope !== "all" && stored.scope !== "lists") ||
				!Array.isArray(stored.listIds) ||
				!stored.listIds.every(
					(id) => Number.isInteger(id) && (id as number) > 0,
				) ||
				typeof stored.capturedAt !== "string" ||
				Number.isNaN(new Date(stored.capturedAt).getTime()) ||
				!isRecord(stored.settings) ||
				typeof stored.settings.threshold !== "number" ||
				!Number.isFinite(stored.settings.threshold) ||
				typeof stored.settings.minAbsoluteChange !== "number" ||
				!Number.isFinite(stored.settings.minAbsoluteChange) ||
				typeof stored.settings.lookbackDays !== "number" ||
				!Number.isFinite(stored.settings.lookbackDays) ||
				(stored.settings.baselineMode !== "previous" &&
					stored.settings.baselineMode !== "lookback-mean" &&
					stored.settings.baselineMode !== "lookback-median") ||
				!Array.isArray(stored.comparisons) ||
				!stored.comparisons.every(isValidComparison) ||
				!Array.isArray(stored.alerts) ||
				!stored.alerts.every(isValidComparison)
			) {
				throw new Error(
					`Invalid segment drift store: keyed result ${key} failed schema validation`,
				);
			}
		}
	}

	for (const [index, snapshot] of value.snapshots.entries()) {
		if (
			!isRecord(snapshot) ||
			typeof snapshot.capturedAt !== "string" ||
			Number.isNaN(new Date(snapshot.capturedAt).getTime()) ||
			typeof snapshot.listId !== "number" ||
			!Number.isInteger(snapshot.listId) ||
			snapshot.listId <= 0 ||
			typeof snapshot.listName !== "string" ||
			typeof snapshot.subscriberCount !== "number" ||
			!Number.isFinite(snapshot.subscriberCount) ||
			snapshot.subscriberCount < 0 ||
			(snapshot.sampleKey !== undefined &&
				(typeof snapshot.sampleKey !== "string" ||
					snapshot.sampleKey.trim() === "" ||
					// The published contract caps the key at 200 trimmed
					// characters; reject store state the supported transports
					// could never have created.
					snapshot.sampleKey.trim().length > 200))
		) {
			throw new Error(
				`Invalid segment drift store: snapshot ${index} failed schema validation`,
			);
		}
	}

	return value as unknown as SegmentDriftStore;
}

function createSegmentDriftStore(): JsonFileStore<SegmentDriftStore> {
	return {
		path: getOpsStorePaths().segmentStorePath,
		createDefault: () => ({ version: 1, snapshots: [] }),
		parse: parseSegmentDriftStore,
	};
}

function calculateDeltaRate(
	currentCount: number,
	previousCount: number | undefined,
): number | undefined {
	if (previousCount === undefined) {
		return undefined;
	}
	if (previousCount > 0) {
		return (currentCount - previousCount) / previousCount;
	}
	// Growth from an empty list is capped at 100% for alert thresholding.
	if (currentCount > 0) {
		return 1;
	}
	return 0;
}

function retainRecentSegmentSnapshots(
	snapshots: SegmentSnapshotEntry[],
): SegmentSnapshotEntry[] {
	const snapshotsByList = new Map<number, SegmentSnapshotEntry[]>();
	for (const snapshot of snapshots) {
		const entries = snapshotsByList.get(snapshot.listId) || [];
		entries.push(snapshot);
		snapshotsByList.set(snapshot.listId, entries);
	}

	return Array.from(snapshotsByList.values())
		.flatMap((entries) =>
			entries
				.sort((left, right) =>
					left.capturedAt.localeCompare(right.capturedAt),
				)
				.slice(-MAX_SEGMENT_SNAPSHOTS_PER_LIST),
		)
		.sort(
			(left, right) =>
				left.capturedAt.localeCompare(right.capturedAt) ||
				left.listId - right.listId,
		);
}

function normalizedListIdSet(listIds: readonly number[]): string {
	return [...new Set(listIds)].sort((left, right) => left - right).join(",");
}

function storedRequestMatches(
	stored: StoredSegmentDriftResult,
	options: SegmentDriftOptions,
	threshold: number,
	minAbsoluteChange: number,
	lookbackDays: number,
	baselineMode: "previous" | "lookback-mean" | "lookback-median",
): boolean {
	const requestIsAll =
		options.listIds === undefined || options.listIds.length === 0;
	const scopeMatches = requestIsAll
		? stored.scope === "all"
		: stored.scope === "lists" &&
			normalizedListIdSet(options.listIds ?? []) ===
				normalizedListIdSet(stored.listIds);
	return (
		scopeMatches &&
		stored.settings.threshold === threshold &&
		stored.settings.minAbsoluteChange === minAbsoluteChange &&
		stored.settings.lookbackDays === lookbackDays &&
		stored.settings.baselineMode === baselineMode
	);
}

function replayStoredResult(
	stored: StoredSegmentDriftResult,
	storePath: string,
	threshold: number,
	minAbsoluteChange: number,
): SegmentDriftResult {
	return {
		capturedAt: stored.capturedAt,
		storePath,
		threshold,
		minAbsoluteChange,
		replaced: 0,
		comparisons: stored.comparisons,
		alerts: stored.alerts,
	};
}

function sharesSampleKey(
	entry: SegmentSnapshotEntry,
	snapshot: SegmentSnapshotEntry,
): boolean {
	return (
		entry.sampleKey !== undefined && snapshot.sampleKey === entry.sampleKey
	);
}

async function getListsForDrift(
	client: ListmonkClient,
	listIds?: number[],
): Promise<List[]> {
	if (listIds && listIds.length > 0) {
		const lists: List[] = [];
		// Duplicate ids would produce duplicate snapshots for one list and
		// double-weight that list's period, so fetch each id exactly once.
		for (const listId of new Set(listIds)) {
			lists.push(await getListById(client, listId));
		}
		return lists;
	}

	const response = await client.list.list({
		query: { per_page: "all" },
	});
	return extractResults<List>(
		unwrapResponseData(response, "Failed to list lists for segment drift"),
	);
}

export async function runSegmentDriftSnapshot(
	client: ListmonkClient,
	options: SegmentDriftOptions = {},
): Promise<SegmentDriftResult> {
	const threshold = Math.max(0, options.threshold ?? 0.2);
	const minAbsoluteChange = Math.max(0, options.minAbsoluteChange ?? 50);
	const lookbackDays = Math.max(1, options.lookbackDays ?? 14);
	const baselineMode = options.baselineMode ?? "previous";
	if (
		options.sampleKey !== undefined &&
		(typeof options.sampleKey !== "string" ||
			options.sampleKey.trim() === "" ||
			// Match the published 200-character contract limit so direct
			// callers cannot persist keys the CLI and MCP reject.
			options.sampleKey.trim().length > 200)
	) {
		// A persisted empty or overlength key would fail store parsing on
		// every later run, so reject it before any snapshot is written.
		throw new TypeError(
			"Segment drift sample key must be a non-empty string of at most 200 trimmed characters",
		);
	}
	const sampleKey = options.sampleKey?.trim();
	const capturedAt = new Date().toISOString();
	const storeDefinition = createSegmentDriftStore();

	if (sampleKey !== undefined) {
		// A completed keyed sample replays from the store: an exactly
		// identical request — same scope, same list set, and same drift
		// settings — returns the originally committed measurement,
		// comparisons and alerts included, instead of overwriting it with
		// freshly observed counts. Any other request under the same key
		// takes the normal capture path.
		const existing = await readJsonFileStore(storeDefinition);
		const results = existing.keyedResults;
		const stored =
			results !== undefined && Object.hasOwn(results, sampleKey)
				? results[sampleKey]
				: undefined;
		if (stored) {
			const requestMatches = storedRequestMatches(
				stored,
				options,
				threshold,
				minAbsoluteChange,
				lookbackDays,
				baselineMode,
			);
			if (requestMatches) {
				return replayStoredResult(
					stored,
					storeDefinition.path,
					threshold,
					minAbsoluteChange,
				);
			}
			// The key already committed a different measurement; reusing it
			// with a different scope or settings stays an explicit conflict
			// rather than silently capturing an unrecorded result.
			throw new Error(
				`Segment drift sample key already committed a different request: ${sampleKey}`,
			);
		}
	}

	const lists = await getListsForDrift(client, options.listIds);

	const currentEntries: SegmentSnapshotEntry[] = lists
		.map((list) => {
			const id = toPositiveInt(list.id);
			if (!id) {
				return undefined;
			}
			return {
				capturedAt,
				listId: id,
				listName: list.name || `List ${id}`,
				subscriberCount: Math.max(0, Number(list.subscriber_count || 0)),
				...(sampleKey === undefined ? {} : { sampleKey }),
			};
		})
		.filter((entry): entry is SegmentSnapshotEntry => entry !== undefined);

	const lookbackCutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;

	return updateJsonFileStore(storeDefinition, (store) => {
		// Same-key snapshots are the same logical sample: they are excluded
		// from the comparison history and replaced in the store, so a retry
		// with the same sample key never double-weights the period. When a
		// concurrent same-key run already committed a newer capture, keep it
		// and drop this run's stale entry instead of overwriting it.
		const retainedEntries = currentEntries.filter((entry) => {
			const committedSameKey = store.snapshots.find(
				(snapshot) =>
					snapshot.listId === entry.listId && sharesSampleKey(entry, snapshot),
			);
			return (
				committedSameKey === undefined ||
				committedSameKey.capturedAt <= entry.capturedAt
			);
		});
		const replacedKeys = new Set(
			retainedEntries
				.filter((entry) =>
					store.snapshots.some(
						(snapshot) =>
							snapshot.listId === entry.listId &&
							sharesSampleKey(entry, snapshot),
					),
				)
				.map((entry) => `${entry.listId}:${entry.sampleKey}`),
		);
		const comparisons: SegmentDriftComparison[] = currentEntries.map((entry) => {
			const history = store.snapshots
				.filter(
					(snapshot) =>
						snapshot.listId === entry.listId &&
						snapshot.capturedAt < entry.capturedAt &&
						!sharesSampleKey(entry, snapshot),
				)
				.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
			const previous = history.at(-1);
			const lookbackHistory = history.filter((snapshot) => {
				const time = new Date(snapshot.capturedAt).getTime();
				return !Number.isNaN(time) && time >= lookbackCutoff;
			});
				const baselineCount =
					lookbackHistory.length > 0
						? lookbackHistory.reduce(
								(sum, snapshot) => sum + snapshot.subscriberCount,
								0,
							) / lookbackHistory.length
						: undefined;
				const previousCount = previous?.subscriberCount;

				// Choose the alert baseline based on baselineMode.
				// "previous" (default) compares against the immediately
				// preceding snapshot. "lookback-mean" / "lookback-median"
				// compare against the lookback window aggregate.
				// The aggregate is kept as a fractional number so delta and
				// deltaRate are computed precisely.
				let alertBaseline: number | undefined;
				if (baselineMode === "lookback-mean" || baselineMode === "lookback-median") {
					if (baselineCount !== undefined) {
						if (baselineMode === "lookback-median" && lookbackHistory.length > 0) {
							const sorted = lookbackHistory
								.map((s) => s.subscriberCount)
								.sort((a, b) => a - b);
							const mid = Math.floor(sorted.length / 2);
							alertBaseline =
								sorted.length % 2 === 0
									? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
									: sorted[mid];
						} else {
							alertBaseline = baselineCount;
						}
					}
				} else {
					alertBaseline = previousCount;
				}

				const delta =
					alertBaseline === undefined
						? undefined
						: entry.subscriberCount - alertBaseline;
				const deltaRate = calculateDeltaRate(
					entry.subscriberCount,
					alertBaseline,
				);
				const alert =
					delta !== undefined &&
					deltaRate !== undefined &&
					Math.abs(delta) >= minAbsoluteChange &&
					Math.abs(deltaRate) >= threshold;

				return {
					listId: entry.listId,
					listName: entry.listName,
					previousCount,
					currentCount: entry.subscriberCount,
					baselineCount:
						alertBaseline !== undefined || baselineCount !== undefined
							? Math.round(alertBaseline ?? baselineCount ?? 0)
							: undefined,
					delta,
					deltaRate,
					alert,
				};
		});
		const survivingSnapshots = store.snapshots.filter((snapshot) => {
			if (snapshot.sampleKey === undefined) {
				return true;
			}
			return !retainedEntries.some(
				(entry) =>
					snapshot.listId === entry.listId && sharesSampleKey(entry, snapshot),
			);
		});
		const requestIsAllScope =
			options.listIds === undefined || options.listIds.length === 0;
		// Preserve committed replay records on every write. A keyed record is
		// only written when the key has none yet — the first committed
		// measurement is the period's measurement — and an overlapping
		// identical run that lost the race replays the committed winner
		// instead of returning its own uncommitted values.
		const previousResults = store.keyedResults ?? {};
		const committed =
			sampleKey !== undefined &&
			Object.hasOwn(previousResults, sampleKey)
				? previousResults[sampleKey]
				: undefined;
		if (committed !== undefined) {
			// The replay check before the lock missed this record; the
			// committed measurement wins.
			if (
				!storedRequestMatches(
					committed,
					options,
					threshold,
					minAbsoluteChange,
					lookbackDays,
					baselineMode,
				)
			) {
				throw new Error(
					`Segment drift sample key already committed a different request: ${sampleKey}`,
				);
			}
			return commitJsonFileStoreUpdate(
				store,
				replayStoredResult(
					committed,
					storeDefinition.path,
					threshold,
					minAbsoluteChange,
				),
			);
		}
		const keyedResults =
			sampleKey === undefined
				? previousResults
				: {
						...previousResults,
						[sampleKey]: {
							scope: requestIsAllScope ? ("all" as const) : ("lists" as const),
							listIds: [
								...new Set(retainedEntries.map((entry) => entry.listId)),
							].sort((left, right) => left - right),
							capturedAt,
							settings: {
								threshold,
								minAbsoluteChange,
								lookbackDays,
								baselineMode,
							},
							comparisons,
							alerts: comparisons.filter(
								(comparison) => comparison.alert,
							),
						} satisfies StoredSegmentDriftResult,
					};
		// Replay records live exactly as long as the measurements they
		// describe: evict a record together with the last retained snapshot
		// carrying its key, so a replay never silently replaces a historical
		// measurement after retention has forgotten it. A hard cap bounds the
		// record map itself.
		const nextSnapshots = retainRecentSegmentSnapshots([
			...survivingSnapshots,
			...retainedEntries,
		]);
		const retainedKeys = new Set(
			nextSnapshots
				.filter((snapshot) => snapshot.sampleKey !== undefined)
				.map((snapshot) => snapshot.sampleKey),
		);
		const prunedKeyedResults = Object.fromEntries(
			Object.entries(keyedResults)
				.filter(([key]) => retainedKeys.has(key))
				.sort(
					(left, right) =>
						right[1].capturedAt.localeCompare(left[1].capturedAt),
				)
				.slice(0, MAX_STORED_KEYED_RESULTS),
		);
		const nextStore: SegmentDriftStore = {
			version: 1,
			snapshots: nextSnapshots,
			keyedResults: prunedKeyedResults,
		};
		const result: SegmentDriftResult = {
			capturedAt,
			storePath: storeDefinition.path,
			threshold,
			minAbsoluteChange,
			replaced: replacedKeys.size,
			comparisons,
			alerts: comparisons.filter((comparison) => comparison.alert),
		};

		return commitJsonFileStoreUpdate(nextStore, result);
	});
}
