/** Application decisions are separate from the provider's suppression state. */
export interface SubscriberMembershipDecision {
	email: string;
	/** Only pass a list owned by this application. */
	ownedListId: number;
	eligible: boolean;
	consented: boolean;
	cachedSubscriberId?: number;
}

export type SubscriberMembershipStatus =
	| "absent"
	| "unconfirmed"
	| "confirmed"
	| "unsubscribed";

export interface SubscriberMembershipReconciliationResult {
	subscriberId: number | null;
	listId: number;
	application: { eligible: boolean; consented: boolean };
	provider: {
		subscriber: "absent" | "enabled" | "blocklisted";
		membership: SubscriberMembershipStatus;
		optIn: "single" | "double";
	};
	/** Point-in-time eligibility only, never evidence of delivery or consent. */
	deliveryEligible: boolean;
	subscriberCreated: boolean;
	action: "none" | "added" | "unsubscribed";
}

const MEMBERSHIP_ERROR_MESSAGES = {
	invalid_reconciliation: "Invalid subscriber membership reconciliation input.",
	membership_rejected: "Listmonk did not acknowledge the membership mutation.",
	provider_state_unknown: "Listmonk subscriber membership state is unknown.",
} as const;

export class MembershipReconciliationError extends Error {
	constructor(public readonly code: keyof typeof MEMBERSHIP_ERROR_MESSAGES) {
		super(MEMBERSHIP_ERROR_MESSAGES[code]);
	}
}

export const MISSING_SUBSCRIBER = Symbol("missing-subscriber");

export interface MembershipTransport {
	getSubscriber(id: number): Promise<unknown>;
	findSubscriber(email: string): Promise<unknown>;
	getList(id: number): Promise<unknown>;
	createSubscriber(email: string): Promise<unknown>;
	manageMembership(id: number, listId: number, action: "add" | "unsubscribe"): Promise<unknown>;
}

type SubscriberSnapshot = {
	id: number;
	email: string;
	status: "enabled" | "blocklisted";
	memberships: Map<number, Exclude<SubscriberMembershipStatus, "absent">>;
};

const MAX_MEMBERSHIPS = 100;

function positiveId(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownState(): never {
	throw new MembershipReconciliationError("provider_state_unknown");
}

export function validateMembershipDecision(input: SubscriberMembershipDecision): void {
	if (
		!positiveId(input.ownedListId) ||
		typeof input.eligible !== "boolean" ||
		typeof input.consented !== "boolean" ||
		(input.cachedSubscriberId !== undefined && !positiveId(
			input.cachedSubscriberId,
		))
	) throw new MembershipReconciliationError("invalid_reconciliation");
}

function parseSubscriber(value: unknown, expectedId?: number): SubscriberSnapshot {
	if (
		!record(value) || !positiveId(value.id) ||
		(expectedId !== undefined && value.id !== expectedId) ||
		typeof value.email !== "string" || value.email.length === 0 ||
		(value.status !== "enabled" && value.status !== "blocklisted") ||
		!Array.isArray(value.lists) || value.lists.length > MAX_MEMBERSHIPS
	) return unknownState();
	const memberships = new Map<number, Exclude<SubscriberMembershipStatus, "absent">>();
	for (const list of value.lists) {
		if (
			!record(list) || !positiveId(list.id) || memberships.has(list.id) ||
			(list.subscription_status !== "unconfirmed" &&
				list.subscription_status !== "confirmed" &&
				list.subscription_status !== "unsubscribed")
		) return unknownState();
		memberships.set(list.id, list.subscription_status);
	}
	return {
		id: value.id,
		email: value.email.toLowerCase(),
		status: value.status,
		memberships,
	};
}

function parseOptIn(value: unknown, id: number): "single" | "double" {
	if (!record(value) || value.id !== id || (value.optin !== "single" && value.optin !== "double")) {
		return unknownState();
	}
	return value.optin;
}

async function resolveSubscriber(
	transport: MembershipTransport,
	input: SubscriberMembershipDecision,
): Promise<SubscriberSnapshot | undefined> {
	if (input.cachedSubscriberId !== undefined) {
		const cached = await transport.getSubscriber(input.cachedSubscriberId);
		if (cached !== MISSING_SUBSCRIBER) {
			const subscriber = parseSubscriber(cached, input.cachedSubscriberId);
			if (subscriber.email === input.email) return subscriber;
		}
	}
	const page = await transport.findSubscriber(input.email);
	if (!record(page) || !Array.isArray(page.results) ||
		(page.total !== 0 && page.total !== 1) || page.results.length !== page.total) {
		return unknownState();
	}
	if (page.total === 0) return undefined;
	const subscriber = parseSubscriber(page.results[0]);
	if (subscriber.email !== input.email) return unknownState();
	return subscriber;
}

/** Provider mutations never overwrite a membership status during an add. */
export async function executeMembershipReconciliation(
	transport: MembershipTransport,
	input: SubscriberMembershipDecision,
): Promise<SubscriberMembershipReconciliationResult> {
	validateMembershipDecision(input);
	let optIn = parseOptIn(
		await transport.getList(input.ownedListId),
		input.ownedListId,
	);
	let subscriber = await resolveSubscriber(transport, input);
	let subscriberCreated = false;
	let action: SubscriberMembershipReconciliationResult["action"] = "none";
	const desired = input.eligible && input.consented;
	if (subscriber === undefined && desired) {
		// Insertion only: no upsert, preconfirmation, names, attributes or lists of
		// an existing subscriber can be overwritten. Ambiguous creates fail and
		// a later job resolves the exact email before deciding whether to insert.
		subscriber = parseSubscriber(await transport.createSubscriber(input.email));
		if (subscriber.email !== input.email) return unknownState();
		subscriberCreated = true;
	}
	if (subscriber !== undefined && subscriber.status !== "blocklisted") {
		const membership = subscriber.memberships.get(input.ownedListId);
		let mutation: "add" | "unsubscribe" | undefined;
		if (desired && membership === undefined) mutation = "add";
		else if (!desired && membership !== undefined && membership !== "unsubscribed") mutation = "unsubscribe";
		if (mutation !== undefined) {
			const acknowledgement = await transport.manageMembership(
				subscriber.id,
				input.ownedListId,
				mutation,
			);
			if (acknowledgement !== true) {
				throw new MembershipReconciliationError(
					acknowledgement === false
						? "membership_rejected"
						: "provider_state_unknown",
				);
			}
			action = mutation === "add" ? "added" : "unsubscribed";
			// A positive ack is not proof of current membership or delivery eligibility.
			// Re-read after concurrent unsubscribe/blocklist and permission filtering.
			const [currentSubscriber, currentList] = await Promise.all([
				transport.getSubscriber(subscriber.id),
				transport.getList(input.ownedListId),
			]);
			subscriber = parseSubscriber(currentSubscriber, subscriber.id);
			if (subscriber.email !== input.email) return unknownState();
			optIn = parseOptIn(currentList, input.ownedListId);
			if (!subscriber.memberships.has(input.ownedListId)) return unknownState();
			if (mutation === "unsubscribe" && subscriber.memberships.get(
				input.ownedListId,
			) !== "unsubscribed") {
				return unknownState();
			}
		}
	}
	const membership = subscriber?.memberships.get(input.ownedListId) ?? "absent";
	return {
		subscriberId: subscriber?.id ?? null,
		listId: input.ownedListId,
		application: { eligible: input.eligible, consented: input.consented },
		provider: { subscriber: subscriber?.status ?? "absent", membership, optIn },
		deliveryEligible: desired && subscriber?.status === "enabled" &&
			(membership === "confirmed" || (membership === "unconfirmed" && optIn === "single")),
		subscriberCreated,
		action,
	};
}
