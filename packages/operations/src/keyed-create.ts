import type {
	ResourceCreateClaimResult,
	ResourceCreateIdempotencyStore,
} from "@listmonk-ops/common";

/** Bounded wait for a live same-key create to finish before giving up. */
const KEYED_CREATE_PENDING_WAIT_MS = 10_000;
const KEYED_CREATE_PENDING_POLL_MS = 200;

function delay(ms: number): Promise<void> {
	return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export type SettledKeyedClaim =
	| { kind: "new"; claimToken: string }
	| { kind: "replay"; resourceId: string };

/**
 * Claim a keyed create, waiting out a live concurrent same-key claim for a
 * bounded window. Conflicts (different payload, target, or resource kind),
 * an unresolved previous attempt, and a still-in-flight claim after the
 * wait budget surface as explicit errors instead of a second POST.
 */
async function claimKeyedCreate(
	store: ResourceCreateIdempotencyStore,
	options: {
		key: string;
		payloadHash: string;
		targetHash: string;
		resourceKind: string;
		resourceLabel: string;
	},
): Promise<SettledKeyedClaim> {
	const deadline = Date.now() + KEYED_CREATE_PENDING_WAIT_MS;
	while (true) {
		const claim: ResourceCreateClaimResult = await store.claim({
			key: options.key,
			payloadHash: options.payloadHash,
			targetHash: options.targetHash,
			resourceKind: options.resourceKind,
		});
		if (claim.kind === "conflict") {
			if (claim.reason === "payload") {
				throw new Error(
					`Idempotency key already used by a different create request: ${options.key}`,
				);
			}
			if (claim.reason === "target") {
				throw new Error(
					`Idempotency key already used against a different Listmonk target: ${options.key}`,
				);
			}
			throw new Error(
				`Idempotency key is bound to a ${claim.existing.resourceKind} resource: ${options.key}`,
			);
		}
		if (claim.kind === "replay") {
			if (claim.record.resourceId === undefined) {
				// A bound record always carries its resource id; a malformed
				// store entry fails closed instead of replaying garbage.
				throw new Error(
					`Idempotency key '${options.key}' is bound without a resource id; the store record is malformed. Reconcile the store manually and use a new idempotency key.`,
				);
			}
			return {
				kind: "replay",
				resourceId: claim.record.resourceId,
			};
		}
		if (claim.kind === "new") {
			return { kind: "new", claimToken: claim.claimToken };
		}
		if (claim.kind === "unresolved") {
			throw new Error(
				`Idempotency key '${options.key}' has an unresolved previous attempt (status ${claim.record.status}); its ${options.resourceLabel} create outcome cannot be determined automatically — a record can even have been renamed or deleted after creation. Inspect Listmonk for the intended result, reconcile manually, and use a new idempotency key.`,
			);
		}
		if (Date.now() >= deadline) {
			throw new Error(
				`Another ${options.resourceLabel} create with idempotency key ${options.key} is still in flight; retry after it completes to replay its result`,
			);
		}
		await delay(KEYED_CREATE_PENDING_POLL_MS);
	}
}

/** Best-effort release of a definitively failed claim. */
async function releaseKeyedClaim(
	store: ResourceCreateIdempotencyStore,
	options: { key: string; claimToken: string },
): Promise<void> {
	try {
		await store.release(options);
	} catch (error) {
		console.warn(
			`Failed to release resource-create idempotency claim for key '${options.key}': ${toMessage(error)}`,
		);
	}
}

/** Best-effort transition of an unfinished claim to unknown. */
async function markKeyedClaimUnknown(
	store: ResourceCreateIdempotencyStore,
	options: { key: string; claimToken: string },
): Promise<void> {
	try {
		await store.markUnknown(options);
	} catch (error) {
		console.warn(
			`Failed to mark resource-create idempotency claim unknown for key '${options.key}': ${toMessage(error)}`,
		);
	}
}

function toMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** The remote outcome of issuing a keyed create, classified by the caller. */
export interface KeyedCreateIssueResult<Resource> {
	/**
	 * The resolved created record, when the POST succeeded and could be
	 * identified (its id, or an immutable correlation). Bindable only when
	 * `resourceIdOf` can extract an id from it.
	 */
	resource?: Resource;
	/**
	 * A failed POST, classified by the caller: `definitive` means the
	 * request provably produced no record (4xx answer, proven pre-dispatch
	 * transport failure) and the key may be released; anything else keeps
	 * the claim for reconciliation.
	 */
	failure?: { error: unknown; definitive: boolean };
}

export interface KeyedCreateOptions<Resource> {
	store: ResourceCreateIdempotencyStore;
	hashCreatePayload: (serialized: string) => string;
	/** Resolved target identity namespacing the idempotency record. */
	target: { baseUrl: string; username: string };
	key: string;
	/** Store record kind, e.g. "list" or "campaign". */
	resourceKind: string;
	/** Human label used in errors, e.g. "list" or "campaign". */
	resourceLabel: string;
	/** Canonical, order-stable payload whose hash identifies retries. */
	canonicalPayload: Record<string, unknown>;
	/** Issue the create: perform the POST and classify the outcome. */
	issue: () => Promise<KeyedCreateIssueResult<Resource>>;
	/** Extract the bindable id from a resolved record, if present. */
	resourceIdOf: (resource: Resource) => string | undefined;
	/** Human-facing identity of the created record for error messages. */
	describeResource: (resource: Resource) => string;
	/** Load the previously bound record for a replay. */
	replay: (resourceId: string) => Promise<Resource>;
}

export interface KeyedCreateResult<Resource> {
	resource: Resource;
	created: boolean;
}

/**
 * The shared keyed-create executor behind every promoted keyed create.
 *
 * The key is atomically claimed in the durable store before the remote
 * create is issued; a concurrent same-key create waits for the in-flight
 * one instead of racing a second POST. A definitive rejection (4xx answer,
 * proven pre-dispatch transport failure) releases the claim for a fresh
 * retry. Everything else that cannot end with the key bound to a resource
 * id — ambiguous transport failures, unidentifiable responses, failed
 * commits — marks the claim unknown, and later same-key creates fail fast
 * with reconciliation guidance: the key is intentionally not reused,
 * because no name-based check can prove which same-named record a create
 * produced.
 */
export async function executeKeyedCreate<Resource>(
	options: KeyedCreateOptions<Resource>,
): Promise<KeyedCreateResult<Resource>> {
	const payloadHash = options.hashCreatePayload(
		JSON.stringify(options.canonicalPayload),
	);
	const targetHash = options.hashCreatePayload(
		JSON.stringify([options.target.baseUrl, options.target.username]),
	);
	const claim = await claimKeyedCreate(options.store, {
		key: options.key,
		payloadHash,
		targetHash,
		resourceKind: options.resourceKind,
		resourceLabel: options.resourceLabel,
	});
	if (claim.kind === "replay") {
		return { resource: await options.replay(claim.resourceId), created: false };
	}

	// claim.kind === "new" — this call owns the key from here on.
	let issued: KeyedCreateIssueResult<Resource>;
	try {
		issued = await options.issue();
	} catch (error) {
		// issue() is expected to classify its own failures; an unexpected
		// throw still must not leave the claim pending on this live owner.
		await markKeyedClaimUnknown(options.store, {
			key: options.key,
			claimToken: claim.claimToken,
		});
		throw error;
	}

	if (issued.failure !== undefined) {
		const error = issued.failure.error instanceof Error
			? issued.failure.error
			: new Error(String(issued.failure.error));
		if (issued.failure.definitive) {
			// No record was created, so the key can be released for a fresh
			// retry. Best effort: an unreleased claim still blocks a
			// duplicate until it is marked unknown or recovered.
			await releaseKeyedClaim(options.store, {
				key: options.key,
				claimToken: claim.claimToken,
			});
			throw error;
		}
		await markKeyedClaimUnknown(options.store, {
			key: options.key,
			claimToken: claim.claimToken,
		});
		throw new Error(
			`Keyed ${options.resourceLabel} create failed ambiguously (${toMessage(error)}); the request may or may not have created a ${options.resourceLabel}. The idempotency key is marked unknown and needs manual reconciliation: inspect Listmonk for the intended result and use a new idempotency key — retries with this key fail fast.`,
			{ cause: error },
		);
	}

	const resourceId =
		issued.resource !== undefined
			? options.resourceIdOf(issued.resource)
			: undefined;
	if (issued.resource === undefined || resourceId === undefined) {
		// The create was accepted but cannot be immutably correlated to a
		// record id. Binding a name-matched record could permanently replay
		// an unrelated one, and a silent second POST is exactly what the key
		// exists to prevent.
		await markKeyedClaimUnknown(options.store, {
			key: options.key,
			claimToken: claim.claimToken,
		});
		throw new Error(
			`${options.resourceLabel} was created but its id could not be correlated (no id or immutable uuid in the response). The idempotency key is marked unknown and needs manual reconciliation: inspect Listmonk and use a new idempotency key — retries with this key fail fast.`,
		);
	}

	const resource = issued.resource;
	try {
		await options.store.commit({
			key: options.key,
			claimToken: claim.claimToken,
			resourceId,
		});
	} catch (error) {
		// The create is the source of truth. The claim still blocks a
		// duplicate POST; marking it unknown makes later same-key calls fail
		// fast with reconciliation guidance instead of timing out.
		console.warn(
			`Failed to persist resource-create idempotency record for key '${options.key}' (${options.resourceLabel} ${options.describeResource(resource)}): ${toMessage(error)}`,
		);
		await markKeyedClaimUnknown(options.store, {
			key: options.key,
			claimToken: claim.claimToken,
		});
	}
	return { resource, created: true };
}
