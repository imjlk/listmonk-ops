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
	/** Exact candidate set reported by a dry run; destructive runs process exactly this set. */
	subscriberIds?: readonly number[];
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
	/** The selected subscriber ids — echo them for the destructive run. */
	subscriberIds: number[];
	targetListId?: number;
	blocklist: boolean;
	sample: Array<{
		emailMasked: string;
		updated_at?: string;
	}>;
	errors: string[];
}

/**
 * Mask an email address for safe display in results (e.g. `j***@example.com`).
 * Never returns the raw email.
 */
export function maskEmail(email: string): string {
	const atIndex = email.lastIndexOf("@");
	if (atIndex < 1) return "***";
	const localPart = email.slice(0, atIndex);
	const domain = email.slice(atIndex);
	const firstChar = localPart[0] ?? "";
	return `${firstChar}***${domain}`;
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

	const echoedIds =
		options.subscriberIds === undefined
			? undefined
			: new Set(options.subscriberIds);
	// An echoed set is matched against the same eligibility criteria;
	// subscribers that left the eligible set (blocklisted, no longer
	// inactive, changed status) are skipped so an identical retry never
	// re-applies a sunset blocklist, and winback list additions are
	// per-subscriber idempotent memberships.
	const eligibleForEcho = echoedIds
		? candidates.filter((subscriber) => {
				const id = toPositiveInt(subscriber.id);
				return id !== undefined && echoedIds.has(id);
			})
		: candidates;
	const selected = eligibleForEcho.slice(0, maxSubscribers);
	const skippedDueToLimit = Math.max(0, candidates.length - selected.length);
	let processedSubscribers = 0;

	// Warn if winback + blocklist is set (blocklist is ignored in winback).
	// This runs in both dry-run and live mode so operators see the warning early.
	if (mode === "winback" && blocklist) {
		errors.push(
			"Warning: blocklist=true is ignored in winback mode; use sunset mode for blocklisting",
		);
	}

	if (!dryRun) {
			// Validate mode-appropriate mutations: winback requires targetListId,
			// sunset requires blocklist=true. Reject no-op combinations.
		if (mode === "winback" && !options.targetListId) {
			throw new Error(
				"targetListId is required for winback mode when dryRun=false",
			);
		}
		if (mode === "sunset" && !blocklist && !options.targetListId) {
			throw new Error(
				"blocklist=true or targetListId is required for sunset mode when dryRun=false",
			);
		}

		for (const candidate of selected) {
			const id = toPositiveInt(candidate.id);
			if (!id) {
				continue;
			}

			let mutated = false;
			try {
				if (options.targetListId) {
					await client.subscriber.manageListById({
						path: { id },
						body: {
							action: "add",
							target_list_ids: [options.targetListId],
						},
					});
					mutated = true;
				}

				if (mode === "sunset" && blocklist) {
					await client.subscriber.manageBlocklistById({
						path: { id },
						body: {
							action: "add",
						},
					});
					mutated = true;
				}
			} catch {
				errors.push("Subscriber mutation failed");
			} finally {
				if (mutated) {
					processedSubscribers += 1;
				}
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
		subscriberIds: selected
			.map((candidate) => toPositiveInt(candidate.id))
			.filter((id): id is number => id !== undefined),
		targetListId: options.targetListId,
		blocklist,
		sample: selected.slice(0, 20).map((candidate) => ({
			emailMasked: maskEmail(candidate.email || ""),
			updated_at: candidate.updated_at,
		})),
		errors,
	};
}
