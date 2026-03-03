import type { List, ListmonkClient } from "@listmonk-ops/openapi";

import { getListById } from "./api";
import {
	extractResults,
	readJsonFile,
	SEGMENT_STORE_PATH,
	toPositiveInt,
	writeJsonFile,
} from "./core";

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

async function loadSegmentStore(): Promise<SegmentDriftStore> {
	return readJsonFile<SegmentDriftStore>(SEGMENT_STORE_PATH, {
		version: 1,
		snapshots: [],
	});
}

async function saveSegmentStore(store: SegmentDriftStore): Promise<void> {
	await writeJsonFile(SEGMENT_STORE_PATH, store);
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
	return extractResults<List>(response.data);
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
	const store = await loadSegmentStore();

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

	const comparisons: SegmentDriftComparison[] = currentEntries.map((entry) => {
		const history = store.snapshots
			.filter((snapshot) => snapshot.listId === entry.listId)
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
		const deltaRate =
			previousCount === undefined
				? undefined
				: previousCount > 0
					? (entry.subscriberCount - previousCount) / previousCount
					: entry.subscriberCount > 0
						? 1
						: 0;
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

	store.snapshots.push(...currentEntries);
	await saveSegmentStore(store);

	return {
		capturedAt,
		storePath: SEGMENT_STORE_PATH,
		threshold,
		minAbsoluteChange,
		comparisons,
		alerts: comparisons.filter((comparison) => comparison.alert),
	};
}
