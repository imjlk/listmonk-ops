import type { ListmonkClient } from "@listmonk-ops/openapi";

type SubscriberConsentState = {
	status?: string | undefined;
	lists?: readonly Record<string, unknown>[] | undefined;
};

export class SequenceConsentLookupRetryError extends Error {
	constructor() {
		super("Temporary list lookup failure while verifying sequence consent");
		this.name = "SequenceConsentLookupRetryError";
	}
}

function retryableListStatus(status: unknown): boolean {
	return typeof status === "number" && (status === 408 || status === 429 || status >= 500);
}

/** Policy absence preserves legacy transactional use. A scoped send fails closed. */
export async function checkSequenceListConsent(
 client: Partial<Pick<ListmonkClient, "list">>,
 subscriber: SubscriberConsentState,
 requiredListIds: readonly number[] | undefined,
): Promise<string | undefined> {
	if (requiredListIds === undefined) return undefined;
	if (requiredListIds.length === 0 || requiredListIds.length > 100
  || new Set(requiredListIds).size !== requiredListIds.length
  || requiredListIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
		throw new Error("Invalid sequence consent policy");
	}
	if (subscriber.status !== "enabled") return "subscriber is not enabled for a consent-scoped send";
	for (const id of requiredListIds) {
		const memberships = (subscriber.lists ?? []).filter(
			(list) => list.id === id,
		);
		if (memberships.length !== 1) return "a required consent-list membership is missing or ambiguous";
		const status = memberships[0]!.subscription_status;
		if (status === "confirmed") continue;
		if (status !== "unconfirmed") return "a required consent-list membership does not permit delivery";
  // Do not guess single/double opt-in from unrelated memberships or cached profiles.
		if (!client.list?.getById) throw new Error("Consent-scoped sends require list-read access to verify unconfirmed membership");
		let response;
		try {
			response = await client.list.getById({ path: { list_id: id } });
		} catch (error) {
			const httpStatus = (error as { httpStatus?: unknown } | null)?.httpStatus;
			if (typeof httpStatus === "number" && !retryableListStatus(httpStatus)) {
				throw new Error("Unable to verify the required list opt-in policy");
			}
			// This idempotent GET precedes dispatch, so any transport failure is
			// safe to retry even when it cannot be classified as a send.
			throw new SequenceConsentLookupRetryError();
		}
		const httpStatus = (response as { response?: { status?: unknown } }).response?.status;
		if ("error" in response && (httpStatus === undefined || retryableListStatus(httpStatus))) {
			throw new SequenceConsentLookupRetryError();
		}
		if ("error" in response || !("data" in response) || !response.data || response.data.id !== id) {
			throw new Error("Unable to verify the required list opt-in policy");
		}
		if (response.data.optin === "single") continue;
		if (response.data.optin === "double") return "a required double opt-in list has not been confirmed";
		throw new Error("Unable to verify the required list opt-in policy");
	}
	return undefined;
}
