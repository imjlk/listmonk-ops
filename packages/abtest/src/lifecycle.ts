import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { AbTest } from "./types";

/**
 * Lifecycle planning and execution for A/B test cancellation and cleanup.
 *
 * The Listmonk v6.2.0 spike (see package README) showed that campaign
 * status transitions are stricter than the earlier "stop = cancel-first"
 * design assumed:
 *
 * - `cancelled` and `paused` are only accepted on `running` ("active")
 *   campaigns. A `draft` or `scheduled` campaign cannot be cancelled; the
 *   server replies `400 Only active campaigns can be cancelled`.
 * - `DELETE /campaigns/{id}` works from `draft`, `scheduled`, and terminal
 *   states, returning 404 for an already-deleted campaign.
 *
 * So to stop a test we must branch on each backing campaign's current
 * status: `running` -> cancel; `draft`/`scheduled` -> delete (otherwise a
 * scheduled campaign will still fire at its send_at). Terminal campaigns
 * (`finished`, `sent`, `cancelled`) are left alone to preserve delivery
 * history, unless an explicit `deleteTerminalCampaigns` flag is set.
 *
 * Temporary lists are only deleted once no remaining backing campaign
 * references them, so an in-flight or partially-failed cancel cannot detach
 * a list a still-running campaign needs.
 *
 * Campaign names are never overwritten. The previous code renamed every
 * campaign to the same `A/B Test Completed - ...` string, which destroyed
 * the original variant name and could fail on finished campaigns Listmonk
 * refuses to mutate.
 */

export type RemoteCampaignAction =
	| { kind: "cancel"; campaignId: number }
	| { kind: "delete"; campaignId: number }
	| { kind: "leave"; campaignId: number; reason: string };

export interface RemoteListAction {
	kind: "delete";
	listId: number;
}

export interface CancelPlan {
	testId: string;
	campaignActions: RemoteCampaignAction[];
	listActions: RemoteListAction[];
	/**
	 * Numeric campaign IDs that still reference their temporary lists after
	 * the campaign actions run (unobservable, left-terminal, or winner
	 * campaigns). The executor blocks list deletion while any of these
	 * survive. Despite the "list" theme of cleanup, this array carries
	 * campaign IDs, not list IDs.
	 */
	campaignsBlockingListDeletion: number[];
}

export interface CancelExecutionResult {
	testId: string;
	plan: CancelPlan;
	campaignResults: {
		campaignId: number;
		action: RemoteCampaignAction["kind"];
		outcome: "success" | "not_found" | "failed";
		detail?: string;
	}[];
	listResults: {
		listId: number;
		outcome: "success" | "not_found" | "skipped_active_reference" | "failed";
		detail?: string;
	}[];
	/**
	 * True only when every campaign reached a terminal state AND every list
	 * was actually deleted. A `skipped_active_reference` list outcome means a
	 * campaign survived, so the test still holds resources; fullyCleaned is
	 * false in that case. Use `hadRetainedResources` to distinguish
	 * "intentionally retained for safety" from a genuine failure.
	 */
	fullyCleaned: boolean;
	/**
	 * True when one or more lists were intentionally retained because a
	 * campaign survived (was left, unobservable, or failed to delete). This
	 * is not itself an error; callers may need to reconcile later.
	 */
	hadRetainedResources: boolean;
	/**
	 * True when at least one campaign or list action genuinely failed
	 * (network error, permission denied, 5xx). Distinct from
	 * hadRetainedResources and from fullyCleaned.
	 */
	hadFailures: boolean;
	/**
	 * True when at least one backing campaign's remote status could not be
	 * read before planning. The planner leaves unobservable campaigns in
	 * place, so a stop with fetch failures is not authoritative — the caller
	 * must not persist the test as fully cancelled. Distinct from hadFailures
	 * (which covers the mutation actions) but callers should treat both as
	 * "stop is not authoritative".
	 */
	hadFetchFailures: boolean;
}

export interface PlanCancelOptions {
	/**
	 * When true, terminal campaigns (finished/sent/cancelled) are also
	 * scheduled for deletion. Defaults to false so delivery history is
	 * preserved.
	 */
	deleteTerminalCampaigns?: boolean;
	/**
	 * Campaign statuses that count as "already terminal" and should be left
	 * alone (or deleted, if deleteTerminalCampaigns is set).
	 */
	terminalStatuses?: string[];
	/** Statuses that may be cancelled (active). */
	activeStatuses?: string[];
}

const DEFAULT_ACTIVE_STATUSES = ["running"];
const DEFAULT_TERMINAL_STATUSES = ["finished", "sent", "cancelled"];

/**
 * Inspect each backing campaign's remote status and produce a deterministic
 * plan of cancel / delete / leave actions. This is a pure function over the
 * observed statuses, so it can be unit-tested without a live Listmonk.
 */
export function planCancelAbTest(
	test: AbTest,
	observedStatuses: Map<number, string>,
	options: PlanCancelOptions = {},
): CancelPlan {
	const active = options.activeStatuses ?? DEFAULT_ACTIVE_STATUSES;
	const terminal = options.terminalStatuses ?? DEFAULT_TERMINAL_STATUSES;
	const deleteTerminal = options.deleteTerminalCampaigns ?? false;

	const campaignActions: RemoteCampaignAction[] = [];
	const survivingCampaignIds: number[] = [];

	for (const mapping of test.campaignMappings) {
		const status = observedStatuses.get(mapping.campaignId);
		if (status === undefined) {
			// Could not observe (e.g. 403/5xx). Do not guess: leave it so a
			// later reconcile pass can decide. Mark the list as still
			// referenced to avoid premature list deletion.
			campaignActions.push({
				kind: "leave",
				campaignId: mapping.campaignId,
				reason: "status could not be observed",
			});
			survivingCampaignIds.push(mapping.campaignId);
			continue;
		}
		if (active.includes(status)) {
			campaignActions.push({ kind: "cancel", campaignId: mapping.campaignId });
			// A cancelled campaign still references its temporary list for any
			// partial delivery history and Listmonk's own reporting, so retain
			// the list rather than deleting it out from under the campaign
			// record. The list can be cleaned up by an explicit reconcile once
			// the caller confirms the delivery history is no longer needed.
			survivingCampaignIds.push(mapping.campaignId);
			continue;
		}
		if (terminal.includes(status)) {
			if (deleteTerminal) {
				campaignActions.push({
					kind: "delete",
					campaignId: mapping.campaignId,
				});
			} else {
				campaignActions.push({
					kind: "leave",
					campaignId: mapping.campaignId,
					reason: `terminal status ${status}`,
				});
				// A finished/sent/cancelled campaign still references its
				// temporary list, so retain the list alongside the campaign
				// rather than deleting it out from under the preserved
				// delivery history.
				survivingCampaignIds.push(mapping.campaignId);
			}
			continue;
		}
		// draft / scheduled / unknown non-terminal: cancel is not allowed, so
		// delete is the only way to prevent a scheduled campaign from firing.
		campaignActions.push({ kind: "delete", campaignId: mapping.campaignId });
	}

	// Collect list ids from testListMappings and the optional holdout list.
	const listIds = new Set<number>();
	for (const mapping of test.testListMappings) {
		listIds.add(mapping.listId);
	}
	if (test.holdoutListId !== undefined) {
		listIds.add(test.holdoutListId);
	}
	if (test.winnerCampaignId !== undefined) {
		// Winner campaign is separately managed; do not auto-delete its list
		// unless the caller also removed the winner campaign id from the test.
		survivingCampaignIds.push(test.winnerCampaignId);
	}

	const listActions: RemoteListAction[] = [];
	for (const listId of listIds) {
		listActions.push({ kind: "delete", listId });
	}

	return {
		testId: test.id,
		campaignActions,
		listActions,
		campaignsBlockingListDeletion: survivingCampaignIds,
	};
}

/**
 * If a Listmonk client response is an error envelope (`{ error, response }`,
 * return a string describing the error; otherwise return `undefined`. The
 * generated client returns non-2xx mutations as envelopes rather than
 * throwing, so callers must inspect the response before treating a mutation
 * as successful.
 */
export function errorEnvelopeMessage(response: unknown): string | undefined {
	if (
		response &&
		typeof response === "object" &&
		"error" in response &&
		(response as { error?: unknown }).error !== undefined
	) {
		const error = (response as { error?: unknown }).error;
		return error instanceof Error ? error.message : String(error);
	}
	return undefined;
}

/**
 * Whether a fetch error should be treated as "resource already gone"
 * (idempotent success). Listmonk returns 404 with a JSON body for missing
 * campaigns and lists.
 *
 * Prefers the structured HTTP status carried by OpenAPI client errors
 * (their `response.status`); falls back to the error message text only when
 * no structured status is available, since some throw sites wrap the
 * response into a plain Error.
 */
export function isNotFoundError(error: unknown): boolean {
	if (error && typeof error === "object" && "response" in error) {
		const response = (error as { response?: { status?: unknown } }).response;
		if (response && typeof response === "object" && "status" in response) {
			const status = (response as { status?: unknown }).status;
			if (typeof status === "number") {
				return status === 404;
			}
		}
	}
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: error &&
						typeof error === "object" &&
						"message" in error
					? String((error as { message: unknown }).message)
					: "";
	return /not found|404/i.test(message);
}

/**
 * Execute a cancel plan against Listmonk. Each campaign and list action is
 * attempted independently; a single failure does not abort the rest, but it
 * is recorded in the result so the caller can decide whether to retry or
 * mark the test as reconcile-required.
 *
 * Lists are only deleted when no surviving campaign still references them.
 */
export async function executeCancelPlan(
	client: ListmonkClient,
	plan: CancelPlan,
): Promise<CancelExecutionResult> {
	// Campaign actions are independent API calls; run them concurrently so
	// total latency is the slowest call rather than the sum. A failure in
	// one action does not abort the others — each settles to its own result.
	const campaignResults: CancelExecutionResult["campaignResults"] =
		await Promise.all(
			plan.campaignActions.map(async (action) => {
				if (action.kind === "leave") {
					return {
						campaignId: action.campaignId,
						action: "leave" as const,
						outcome: "success" as const,
						detail: action.reason,
					};
				}
				try {
					let response: unknown;
					if (action.kind === "cancel") {
						response = await client.campaign.updateStatus({
							path: { id: action.campaignId },
							body: { status: "cancelled" },
						});
					} else {
						response = await client.campaign.delete({
							path: { id: action.campaignId },
						});
					}
					// The generated Listmonk client returns non-2xx mutations as
					// { error, response } envelopes instead of throwing. Treat
					// any error envelope as a failure so we never mark a
					// campaign action successful while Listmonk rejected it.
					const envelopeError = errorEnvelopeMessage(response);
					if (envelopeError !== undefined) {
						return {
							campaignId: action.campaignId,
							action: action.kind,
							outcome: isNotFoundError(response)
								? ("not_found" as const)
								: ("failed" as const),
							detail: envelopeError,
						};
					}
					return {
						campaignId: action.campaignId,
						action: action.kind,
						outcome: "success" as const,
					};
				} catch (error) {
					const outcome = isNotFoundError(error)
						? ("not_found" as const)
						: ("failed" as const);
					return {
						campaignId: action.campaignId,
						action: action.kind,
						outcome,
						detail: error instanceof Error ? error.message : String(error),
					};
				}
			}),
		);

	// A list is safe to delete only if no surviving campaign still references
	// it. Surviving references include:
	//   - campaigns the plan could not observe or chose to leave (encoded in
	//     plan.campaignsBlockingListDeletion and not subsequently deleted);
	//   - campaigns whose cancel/delete action failed (they may still be
	//     active in Listmonk).
	const survivingListReferences = new Set<number>();
	const deletedCampaignIds = new Set(
		campaignResults
			.filter((r) => r.outcome === "success" && r.action === "delete")
			.map((r) => r.campaignId),
	);
	for (const id of plan.campaignsBlockingListDeletion) {
		if (!deletedCampaignIds.has(id)) {
			survivingListReferences.add(id);
		}
	}
	for (const result of campaignResults) {
		if (result.outcome === "failed") {
			survivingListReferences.add(result.campaignId);
		}
	}

	const anySurvivingReference = survivingListReferences.size > 0;
	const listResults: CancelExecutionResult["listResults"] = await Promise.all(
		plan.listActions.map(async (action) => {
			// If any campaign survived (left, unobservable, or failed to
			// delete), retain every list to avoid detaching a list a
			// still-active campaign may need.
			if (anySurvivingReference) {
				return {
					listId: action.listId,
					outcome: "skipped_active_reference" as const,
					detail: "one or more campaigns survived cancel; list retained",
				};
			}
			try {
				const response = await client.list.delete({
					path: { list_id: action.listId },
				});
				const envelopeError = errorEnvelopeMessage(response);
				if (envelopeError !== undefined) {
					return {
						listId: action.listId,
						outcome: isNotFoundError(response)
							? ("not_found" as const)
							: ("failed" as const),
						detail: envelopeError,
					};
				}
				return { listId: action.listId, outcome: "success" as const };
			} catch (error) {
				const outcome = isNotFoundError(error)
					? ("not_found" as const)
					: ("failed" as const);
				return {
					listId: action.listId,
					outcome,
					detail: error instanceof Error ? error.message : String(error),
				};
			}
		}),
	);

	// fullyCleaned is true only when every campaign reached a terminal state
	// AND every list was actually deleted. skipped_active_reference means a
	// campaign survived, so the test still holds resources and is not fully
	// cleaned. hadRetainedResources / hadFailures let callers distinguish
	// intentional retention from genuine errors.
	const fullyCleaned =
		campaignResults.every(
			(r) => r.outcome === "success" || r.outcome === "not_found",
		) &&
		listResults.every(
			(r) => r.outcome === "success" || r.outcome === "not_found",
		);
	const hadRetainedResources = listResults.some(
		(r) => r.outcome === "skipped_active_reference",
	);
	const hadFailures =
		campaignResults.some((r) => r.outcome === "failed") ||
		listResults.some((r) => r.outcome === "failed");

	return {
		testId: plan.testId,
		plan,
		campaignResults,
		listResults,
		fullyCleaned,
		hadRetainedResources,
		hadFailures,
		// executeCancelPlan does not fetch statuses; only cancelAbTest does.
		hadFetchFailures: false,
	};
}

/**
 * Fetch each backing campaign's current status from Listmonk. A campaign
 * that cannot be fetched (network error, permission, envelope error) is
 * omitted from the returned map, which `planCancelAbTest` treats as
 * "unobservable" and leaves alone. This is the bridge between the pure
 * planner and the live Listmonk API.
 */
export async function fetchCampaignStatuses(
	client: ListmonkClient,
	campaignIds: number[],
): Promise<{
	statuses: Map<number, string>;
	/** Campaigns whose status could not be read (fetch error or envelope). */
	unobservable: number[];
}> {
	const statuses = new Map<number, string>();
	const unobservable: number[] = [];
	await Promise.all(
		campaignIds.map(async (campaignId) => {
			try {
				const response = await client.campaign.getById({
					path: { id: campaignId },
				});
				const envelopeError = errorEnvelopeMessage(response);
				if (envelopeError !== undefined) {
					// A 404 envelope means the campaign is gone — it cannot
					// still send, so classify it as already-stopped (terminal)
					// rather than unobservable. This lets stopAbTest proceed
					// when a previous stop deleted the campaign but the local
					// state write failed, or an operator deleted it manually.
					if (isNotFoundError(envelopeError)) {
						statuses.set(campaignId, "cancelled");
						return;
					}
					console.error(
						`Failed to fetch status for campaign ${campaignId}:`,
						envelopeError,
					);
					unobservable.push(campaignId);
					return;
				}
				const status = (
					response as { data?: { status?: string } }
				)?.data?.status;
				if (typeof status === "string") {
					statuses.set(campaignId, status);
				} else {
					console.error(
						`Status for campaign ${campaignId} was missing or not a string`,
					);
					unobservable.push(campaignId);
				}
			} catch (error) {
				// A thrown 404 (network-level not-found) is also already-stopped.
				if (isNotFoundError(error)) {
					statuses.set(campaignId, "cancelled");
					return;
				}
				// Log per-campaign fetch errors so a systemic failure (auth
				// token expired, network partition, Listmonk down) does not
				// silently make every campaign unobservable — which would
				// otherwise cause the planner to leave everything and the
				// caller to mark the test cancelled while nothing was cleaned.
				// Record the failure so the caller treats the stop as
				// non-authoritative rather than persisted-cancelled.
				console.error(
					`Failed to fetch status for campaign ${campaignId}:`,
					error instanceof Error ? error.message : String(error),
				);
				unobservable.push(campaignId);
			}
		}),
	);
	return { statuses, unobservable };
}

/**
 * Top-level cancellation orchestration: fetch each backing campaign's remote
 * status, build a status-aware cancel plan, and execute it. Returns the full
 * execution result so the caller can decide whether to mark the test
 * cancelled, failed, or reconcile-required.
 *
 * This is the production entry point that `stopAbTest` should call instead
 * of the legacy cleanup paths, so that scheduled/draft campaigns are deleted
 * and running campaigns are cancelled per the observed remote status.
 */
export async function cancelAbTest(
	client: ListmonkClient,
	test: AbTest,
	options?: { deleteTerminalCampaigns?: boolean },
): Promise<CancelExecutionResult> {
	const campaignIds = [
		...new Set([
			...test.campaignMappings.map((m) => m.campaignId),
			...(test.winnerCampaignId !== undefined
				? [test.winnerCampaignId]
				: []),
		]),
	];
	const { statuses: observedStatuses, unobservable } =
		await fetchCampaignStatuses(client, campaignIds);
	const plan = planCancelAbTest(test, observedStatuses, options);
	const result = await executeCancelPlan(client, plan);
	// Surface fetch failures so the caller does not persist the test as
	// fully cancelled when a campaign's status could not be verified.
	return { ...result, hadFetchFailures: unobservable.length > 0 };
}
