import type { ListmonkClient, Subscriber } from "@listmonk-ops/openapi";

import { unwrapResponseData } from "./api";
import { extractResults, toDate, toPositiveInt } from "./core";

export type SubscriberHygieneMode = "winback" | "sunset";

export interface SubscriberHygieneOptions {
	mode?: SubscriberHygieneMode;
	inactivityDays?: number;
	sourceListIds?: number[];
	targetListId?: number;
	blocklist?: boolean;
	dryRun?: boolean;
	maxSubscribers?: number;
}

export interface SubscriberHygieneResult {
	mode: SubscriberHygieneMode;
	cutoffAt: string;
	dryRun: boolean;
	totalSubscribersScanned: number;
	candidateSubscribers: number;
	processedSubscribers: number;
	skippedDueToLimit: number;
	targetListId?: number;
	blocklist: boolean;
	sample: Array<{
		id: number;
		email: string;
		updated_at?: string;
	}>;
	errors: string[];
}

function intersects(source: number[], target: Set<number>): boolean {
	return source.some((value) => target.has(value));
}

export async function runSubscriberHygiene(
	client: ListmonkClient,
	options: SubscriberHygieneOptions = {},
): Promise<SubscriberHygieneResult> {
	const mode = options.mode ?? "winback";
	const inactivityDays = Math.max(1, options.inactivityDays ?? 90);
	const dryRun = options.dryRun ?? true;
	const blocklist = options.blocklist ?? false;
	const maxSubscribers = Math.max(1, options.maxSubscribers ?? 500);
	const cutoffDate = new Date(
		Date.now() - inactivityDays * 24 * 60 * 60 * 1000,
	);
	const sourceListSet = new Set(options.sourceListIds || []);
	const errors: string[] = [];

	const subscriberResponse = await client.subscriber.list({
		query: {
			per_page: "all",
		},
	});
	const subscribers = extractResults<Subscriber>(
		unwrapResponseData(
			subscriberResponse,
			"Failed to list subscribers for hygiene workflow",
		),
	);

	const candidates = subscribers.filter((subscriber) => {
		const subscriberId = toPositiveInt(subscriber.id);
		if (!subscriberId) {
			return false;
		}

		if (String(subscriber.status || "").toLowerCase() !== "enabled") {
			return false;
		}

		const updatedAt = toDate(subscriber.updated_at || subscriber.created_at);
		if (!updatedAt || updatedAt > cutoffDate) {
			return false;
		}

		if (sourceListSet.size > 0) {
			const subscriberListIds = (subscriber.lists || [])
				.map((entry) => toPositiveInt(entry.id))
				.filter((value): value is number => value !== undefined);
			return intersects(subscriberListIds, sourceListSet);
		}

		return true;
	});

	const selected = candidates.slice(0, maxSubscribers);
	const skippedDueToLimit = Math.max(0, candidates.length - selected.length);
	let processedSubscribers = 0;

	if (!dryRun) {
		if (!options.targetListId && !blocklist) {
			throw new Error(
				"targetListId or blocklist=true is required when dryRun=false",
			);
		}

		for (const candidate of selected) {
			const id = toPositiveInt(candidate.id);
			if (!id) {
				continue;
			}

			try {
				if (options.targetListId) {
					await client.subscriber.manageListById({
						path: { id },
						body: {
							action: "add",
							target_list_ids: options.targetListId,
						},
					});
				}

				if (mode === "sunset" && blocklist) {
					await client.subscriber.manageBlocklistById({
						path: { id },
						body: {
							action: "add",
						},
					});
				}

				processedSubscribers += 1;
			} catch (error) {
				errors.push(
					`Subscriber ${id}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}

	return {
		mode,
		cutoffAt: cutoffDate.toISOString(),
		dryRun,
		totalSubscribersScanned: subscribers.length,
		candidateSubscribers: candidates.length,
		processedSubscribers: dryRun ? 0 : processedSubscribers,
		skippedDueToLimit,
		targetListId: options.targetListId,
		blocklist,
		sample: selected.slice(0, 20).map((candidate) => ({
			id: Number(candidate.id),
			email: candidate.email || "",
			updated_at: candidate.updated_at,
		})),
		errors,
	};
}
