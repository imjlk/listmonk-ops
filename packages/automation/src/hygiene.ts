import type { List, ListmonkClient, Subscriber } from "@listmonk-ops/openapi";

import { unwrapResponseData } from "./api";
import { extractResults, toDate, toPositiveInt } from "./core";

export type SubscriberHygieneMode = "winback" | "sunset";

/** A Listmonk list's opt-in mode (`lists.optin`). */
export type ListOptinMode = "single" | "double";

/** The hygiene mutation a failure summary refers to. */
export type SubscriberHygieneMutationEffect = "list_add" | "blocklist";

/**
 * Bounded mutation failure code; it never carries remote error text.
 * `http_<status>` is a 4xx/5xx error envelope, `request_failed` a rejected
 * request or an error envelope without an HTTP error status, and
 * `negative_acknowledgement` a response without Listmonk's explicit
 * `data: true` acknowledgement.
 */
export type SubscriberHygieneMutationErrorCode =
	| `http_${number}`
	| "request_failed"
	| "negative_acknowledgement";

type SubscriberHygieneMutationFailure =
	`${SubscriberHygieneMutationEffect} ${SubscriberHygieneMutationErrorCode}`;

export interface SubscriberHygieneOptions {
	mode?: SubscriberHygieneMode;
	/**
	 * Minimum age in days of the subscriber profile's updated_at. Listmonk
	 * advances updated_at on profile edits and API blocklisting only —
	 * sends, opens, clicks, opt-in confirmations, unsubscribes, and list
	 * additions leave it untouched — so this selects profiles nobody has
	 * modified, not readers who stopped engaging.
	 */
	inactivityDays?: number;
	/**
	 * Only memberships on these lists count toward eligibility. Without it,
	 * any list membership counts. Either way a candidate needs a membership
	 * that permits delivery (see {@link membershipPermitsDelivery}).
	 */
	sourceListIds?: number[];
	targetListId?: number;
	/**
	 * Blocklist sunset candidates. Irreversible for list subscriptions:
	 * Listmonk marks every membership unsubscribed, and removing the
	 * blocklist does not restore them.
	 */
	blocklist?: boolean;
	/** Exact candidate set reported by a dry run; destructive runs process exactly this set. */
	subscriberIds?: readonly number[];
	/**
	 * Generation guard: the updated_at each selected subscriber carried when
	 * the dry run reported it. Listmonk advances updated_at on profile edits
	 * and API blocklisting, so a guarded destructive retry skips subscribers
	 * its own first attempt blocklisted as well as ones whose profile changed
	 * externally. A list add leaves updated_at unchanged; the retry skips an
	 * already-present target membership structurally instead.
	 */
	expectedUpdatedAt?: ReadonlyMap<number, string>; // raw updated_at strings
	dryRun?: boolean;
	maxSubscribers?: number;
}

export interface SubscriberHygieneResult {
	mode: SubscriberHygieneMode;
	cutoffAt: string;
	dryRun: boolean;
	totalSubscribersScanned: number;
	candidateSubscribers: number;
	/** Subscribers whose requested mutations Listmonk all acknowledged. */
	processedSubscribers: number;
	/**
	 * Subscribers with a failed or unacknowledged mutation, including a
	 * partially applied one (list add landed, blocklist failed).
	 */
	failedSubscribers: number;
	skippedDueToLimit: number;
	/** Selected subscribers skipped because their updated_at moved past the echoed guard. */
	skippedGuarded: number;
	/** The selected subscriber ids — echo them for the destructive run. */
	subscriberIds: number[];
	/**
	 * Parallel to subscriberIds: the raw updated_at each selected subscriber
	 * carried at observation. Pair them in order as the destructive run's
	 * subscriber_guards so a retry skips anyone that moved.
	 */
	subscriberUpdatedAt: string[];
	targetListId?: number;
	blocklist: boolean;
	sample: Array<{
		emailMasked: string;
		updated_at?: string;
	}>;
	/**
	 * Warnings plus one bounded summary per failed effect and code, e.g.
	 * `Subscriber mutation failed for 2 subscribers: list_add http_403`.
	 */
	errors: string[];
}

type SubscriberMembership = NonNullable<Subscriber["lists"]>[number];

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

/**
 * Listmonk's regular-campaign delivery rule for one list membership
 * (`next-campaign-subscribers`): an unsubscribed membership never receives
 * mail, a double opt-in list delivers only to confirmed members, and a
 * single opt-in list also delivers to unconfirmed ones. An unknown
 * subscription status or an undeterminable opt-in mode fails closed.
 */
export function membershipPermitsDelivery(
	subscriptionStatus: unknown,
	optin: ListOptinMode | undefined,
): boolean {
	if (subscriptionStatus === "confirmed") {
		return true;
	}
	return subscriptionStatus === "unconfirmed" && optin === "single";
}

/**
 * Read each list's opt-in mode from the list endpoint — the authority the
 * sequence consent check uses too — rather than trusting the list row
 * Listmonk embeds in subscriber payloads. Lists the token cannot read are
 * absent from the map, so their unconfirmed memberships fail closed; a
 * failed read rejects the run before anything is selected or mutated.
 */
export async function loadListOptinModes(
	client: ListmonkClient,
): Promise<Map<number, ListOptinMode>> {
	const response = await client.list.list({
		query: { per_page: "all", minimal: true },
	});
	const lists = extractResults<List>(
		unwrapResponseData(
			response,
			"Failed to list lists for the hygiene opt-in check",
		),
	);
	const modes = new Map<number, ListOptinMode>();
	for (const list of lists) {
		const listId = toPositiveInt(list.id);
		if (
			listId !== undefined &&
			(list.optin === "single" || list.optin === "double")
		) {
			modes.set(listId, list.optin);
		}
	}
	return modes;
}

/**
 * Classify one hygiene mutation response. The Listmonk client does not
 * throw on HTTP errors, so a 403 or 500 resolves as an `{ error }` envelope
 * instead of rejecting; only the explicit `data: true` acknowledgement
 * counts as applied. Returns undefined when acknowledged. The code is
 * derived from the HTTP status alone and never copies remote error text.
 */
export function classifyHygieneMutationResponse(
	response: unknown,
): SubscriberHygieneMutationErrorCode | undefined {
	if (typeof response !== "object" || response === null) {
		return "negative_acknowledgement";
	}
	const envelope = response as {
		data?: unknown;
		error?: unknown;
		response?: { status?: unknown };
	};
	if ("error" in envelope && envelope.error !== undefined) {
		const status = envelope.response?.status;
		return typeof status === "number" &&
			Number.isInteger(status) &&
			status >= 400 &&
			status <= 599
			? `http_${status}`
			: "request_failed";
	}
	return envelope.data === true ? undefined : "negative_acknowledgement";
}

async function applyHygieneMutation(
	mutation: () => Promise<unknown>,
): Promise<SubscriberHygieneMutationErrorCode | undefined> {
	try {
		return classifyHygieneMutationResponse(await mutation());
	} catch {
		// A rejected request carries no trustworthy status, and its message
		// may contain remote text, so only the bounded code is kept.
		return "request_failed";
	}
}

function eligibilityMemberships(
	subscriber: Subscriber,
	sourceListSet: ReadonlySet<number>,
): SubscriberMembership[] {
	const memberships = subscriber.lists ?? [];
	if (sourceListSet.size === 0) {
		return memberships;
	}
	return memberships.filter((membership) => {
		const listId = toPositiveInt(membership.id);
		return listId !== undefined && sourceListSet.has(listId);
	});
}

function hasDeliverableMembership(
	memberships: readonly SubscriberMembership[],
	listOptinModes: ReadonlyMap<number, ListOptinMode>,
): boolean {
	return memberships.some((membership) => {
		const listId = toPositiveInt(membership.id);
		return membershipPermitsDelivery(
			membership.subscription_status,
			listId === undefined ? undefined : listOptinModes.get(listId),
		);
	});
}

function formatMutationFailure(
	failure: SubscriberHygieneMutationFailure,
	count: number,
): string {
	return `Subscriber mutation failed for ${count} subscriber${count === 1 ? "" : "s"}: ${failure}`;
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

	// "Inactive" means the profile's updated_at is older than the cutoff;
	// Listmonk does not advance it on sends, opens, or clicks.
	const staleSubscribers = subscribers.filter((subscriber) => {
		const subscriberId = toPositiveInt(subscriber.id);
		if (!subscriberId) {
			return false;
		}

		if (String(subscriber.status || "").toLowerCase() !== "enabled") {
			return false;
		}

		const updatedAt = toDate(subscriber.updated_at || subscriber.created_at);
		return updatedAt !== undefined && updatedAt <= cutoffDate;
	});
	// Consent: a candidate must still hold a membership Listmonk would
	// deliver to (on a source list when given). Someone unsubscribed from
	// every list is never selected, so winback cannot add them to a target
	// list that then mails them. Opt-in modes decide only unconfirmed
	// memberships, so the lists are read once, and only when a subscriber
	// without a confirmed membership has an unconfirmed one.
	const needsOptinModes = staleSubscribers.some((subscriber) => {
		const memberships = eligibilityMemberships(subscriber, sourceListSet);
		return (
			!memberships.some((entry) => entry.subscription_status === "confirmed") &&
			memberships.some((entry) => entry.subscription_status === "unconfirmed")
		);
	});
	const listOptinModes = needsOptinModes
		? await loadListOptinModes(client)
		: new Map<number, ListOptinMode>();
	const candidates = staleSubscribers.filter((subscriber) =>
		hasDeliverableMembership(
			eligibilityMemberships(subscriber, sourceListSet),
			listOptinModes,
		),
	);

	const echoedIds =
		options.subscriberIds === undefined
			? undefined
			: new Set(options.subscriberIds);
	if (
		[...(echoedIds ?? [])].some((id) => !Number.isSafeInteger(id) || id <= 0)
	) {
		// A partly invalid echoed set would be silently truncated by the
		// candidate intersection; reject it before any mutation so a partial
		// authorization set is never applied.
		throw new Error("Echoed subscriber ids must be positive safe integers");
	}
	if (!dryRun && echoedIds === undefined) {
		// The operation boundary enforces the echo for CLI and MCP callers;
		// direct library consumers hit it here so the exported workflow can
		// never mutate a mutable unechoed candidate batch.
		throw new Error(
			"Destructive hygiene runs require the exact subscriber ids a dry run reported",
		);
	}
	if (echoedIds !== undefined && echoedIds.size > maxSubscribers) {
		// An echoed set larger than the effective limit would be silently
		// truncated, letting a retry mutate the next portion.
		throw new Error(
			`Echoed subscriber set (${echoedIds.size}) exceeds max_subscribers (${maxSubscribers}); raise max_subscribers to apply the full reviewed set`,
		);
	}
	// An echoed set is matched against the same eligibility criteria;
	// subscribers that left the eligible set (blocklisted, no longer
	// inactive, changed status, no deliverable membership left) are skipped
	// so an identical retry never re-applies a sunset blocklist, and winback
	// list additions are per-subscriber idempotent memberships.
	const eligibleForEcho = echoedIds
		? candidates.filter((subscriber) => {
				const id = toPositiveInt(subscriber.id);
				return id !== undefined && echoedIds.has(id);
			})
		: candidates;
	const selected = eligibleForEcho.slice(0, maxSubscribers);
	const skippedDueToLimit = echoedIds
		? Math.max(0, eligibleForEcho.length - selected.length)
		: Math.max(0, candidates.length - selected.length);
	// The guard observations echo verbatim as subscriber_guards: the RAW
	// updated_at string preserves Listmonk's microsecond precision (a
	// Date-normalized comparison would treat revisions within one
	// millisecond as equal), and a selected subscriber without a usable
	// updated_at fails the run instead of fabricating a generation token
	// that a later mutation could not move.
	const subscriberUpdatedAt = selected.map((subscriber) => {
		const id = toPositiveInt(subscriber.id)!;
		const observed = subscriber.updated_at;
		if (typeof observed !== "string" || Number.isNaN(Date.parse(observed))) {
			throw new Error(
				`Subscriber ${id} has no usable updated_at; the hygiene generation guard requires one`,
			);
		}
		return observed;
	});
	// The updated_at guard is the per-subscriber generation signal: Listmonk
	// advances updated_at when this workflow blocklists and on external
	// profile edits, so a guarded destructive retry skips everyone its first
	// attempt blocklisted and everyone whose profile changed, while untouched
	// members of the echoed set still run. A list add does not move it; the
	// structural target-membership check below keeps a retry from repeating
	// that effect. The comparison is a raw string equality.
	const expectedUpdatedAt = options.expectedUpdatedAt;
	const guardActive = !dryRun && expectedUpdatedAt !== undefined;
	if (guardActive && echoedIds !== undefined) {
		// The adapter schema enforces exact coverage; direct library
		// consumers hit it here so a partially supplied guard map can never
		// masquerade as an ordinary guarded skip and silently drop a
		// requested mutation.
		const missing = [...echoedIds].filter((id) => !expectedUpdatedAt.has(id));
		if (missing.length > 0) {
			throw new Error(
				`expectedUpdatedAt must cover every echoed subscriber id; missing ${missing.length} entr${missing.length === 1 ? "y" : "ies"}`,
			);
		}
	}
	const updatedAtById = new Map(
		selected
			.map((subscriber) => toPositiveInt(subscriber.id))
			.filter((id): id is number => id !== undefined)
			.map((id, index) => [id, subscriberUpdatedAt[index]!] as const),
	);
	const guardEligible = guardActive
		? selected.filter((subscriber) => {
				const id = toPositiveInt(subscriber.id)!;
				const expected = expectedUpdatedAt.get(id);
				const current = updatedAtById.get(id);
				return expected !== undefined && current === expected;
			})
		: selected;
	const skippedGuarded = selected.length - guardEligible.length;
	let processedSubscribers = 0;
	let failedSubscribers = 0;
	// Failures aggregate per effect and code so the summary stays bounded
	// however many subscribers fail, and it never carries remote text.
	const failureCounts = new Map<SubscriberHygieneMutationFailure, number>();

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
		const targetListId = options.targetListId;

		for (const candidate of guardEligible) {
			const id = toPositiveInt(candidate.id);
			if (!id) {
				continue;
			}

			// Structural completion for the list effect: when the fetched
			// record already shows an active target-list membership — a
			// partial sunset run whose list-add landed before its blocklist
			// failed re-reads exactly this — the add is skipped so the retry
			// only applies the missing effects. An unsubscribed membership
			// is not the subscription the request asked for, so it does not
			// count as complete.
			const alreadyMember =
				targetListId !== undefined &&
				(candidate.lists || []).some(
					(entry) =>
						toPositiveInt(entry.id) === targetListId &&
						entry.subscription_status !== "unsubscribed",
				);
			// Effects apply in order and the first failure stops this
			// subscriber, so a retry applies whatever is still missing.
			let failure: SubscriberHygieneMutationFailure | undefined;
			let mutated = false;
			if (targetListId && !alreadyMember) {
				const code = await applyHygieneMutation(() =>
					client.subscriber.manageListById({
						path: { id },
						// Listmonk 6.2 answers 400 "No IDs given." unless the
						// body repeats the subscriber id from the path.
						body: {
							action: "add",
							ids: [id],
							target_list_ids: [targetListId],
						},
					}),
				);
				if (code === undefined) {
					mutated = true;
				} else {
					failure = `list_add ${code}`;
				}
			}

			if (failure === undefined && mode === "sunset" && blocklist) {
				const code = await applyHygieneMutation(() =>
					client.subscriber.manageBlocklistById({
						path: { id },
						body: {
							action: "add",
						},
					}),
				);
				if (code === undefined) {
					mutated = true;
				} else {
					failure = `blocklist ${code}`;
				}
			}

			if (failure !== undefined) {
				failedSubscribers += 1;
				failureCounts.set(failure, (failureCounts.get(failure) ?? 0) + 1);
			} else if (mutated) {
				processedSubscribers += 1;
			}
		}
		for (const [failure, count] of failureCounts) {
			errors.push(formatMutationFailure(failure, count));
		}
	}

	return {
		mode,
		cutoffAt: cutoffDate.toISOString(),
		dryRun,
		totalSubscribersScanned: subscribers.length,
		candidateSubscribers: candidates.length,
		processedSubscribers: dryRun ? 0 : processedSubscribers,
		failedSubscribers: dryRun ? 0 : failedSubscribers,
		skippedDueToLimit,
		skippedGuarded,
		subscriberIds: selected
			.map((candidate) => toPositiveInt(candidate.id))
			.filter((id): id is number => id !== undefined),
		subscriberUpdatedAt,
		targetListId: options.targetListId,
		blocklist,
		sample: selected.slice(0, 20).map((candidate) => ({
			emailMasked: maskEmail(candidate.email || ""),
			updated_at: candidate.updated_at,
		})),
		errors,
	};
}
