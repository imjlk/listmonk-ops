import {
	commitJsonFileStoreUpdate,
	type JsonFileStore,
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
}

export interface SegmentDriftStore {
	version: 1;
	snapshots: SegmentSnapshotEntry[];
}

export interface SegmentDriftOptions {
	listIds?: number[];
	threshold?: number;
	minAbsoluteChange?: number;
	lookbackDays?: number;
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
			snapshot.subscriberCount < 0
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

async function getListsForDrift(
	client: ListmonkClient,
	listIds?: number[],
): Promise<List[]> {
	if (listIds && listIds.length > 0) {
		const lists: List[] = [];
		for (const listId of listIds) {
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
	const capturedAt = new Date().toISOString();
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
			};
		})
		.filter((entry): entry is SegmentSnapshotEntry => entry !== undefined);

	const lookbackCutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
	const storeDefinition = createSegmentDriftStore();

	return updateJsonFileStore(storeDefinition, (store) => {
		const comparisons: SegmentDriftComparison[] = currentEntries.map((entry) => {
			const history = store.snapshots
				.filter(
					(snapshot) =>
						snapshot.listId === entry.listId &&
						snapshot.capturedAt < entry.capturedAt,
				)
				.sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
			const previous = history.at(-1);
			const lookbackHistory = history.filter((snapshot) => {
				const time = new Date(snapshot.capturedAt).getTime();
				return !Number.isNaN(time) && time >= lookbackCutoff;
			});
			const baselineCount =
				lookbackHistory.length > 0
					? Math.round(
							lookbackHistory.reduce(
								(sum, snapshot) => sum + snapshot.subscriberCount,
								0,
							) / lookbackHistory.length,
						)
					: undefined;
			const previousCount = previous?.subscriberCount;
			const delta =
				previousCount === undefined
					? undefined
					: entry.subscriberCount - previousCount;
			const deltaRate = calculateDeltaRate(
				entry.subscriberCount,
				previousCount,
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
				baselineCount,
				delta,
				deltaRate,
				alert,
			};
		});
		const nextStore: SegmentDriftStore = {
			version: 1,
			snapshots: retainRecentSegmentSnapshots([
				...store.snapshots,
				...currentEntries,
			]),
		};
		const result: SegmentDriftResult = {
			capturedAt,
			storePath: storeDefinition.path,
			threshold,
			minAbsoluteChange,
			comparisons,
			alerts: comparisons.filter((comparison) => comparison.alert),
		};

		return commitJsonFileStoreUpdate(nextStore, result);
	});
}
