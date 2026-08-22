import { createHash, randomUUID } from "node:crypto";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
} from "./json-file-store";

/**
 * A durable mapping from a caller-scoped create key to the resource that
 * was created, so an ambiguous create retry replays the original instead
 * of provisioning a duplicate. Keys are claimed atomically before the
 * remote create: a concurrent same-key caller observes the pending claim
 * instead of racing a second POST. Schema-versioned and written atomically.
 */
export type ResourceCreateStatus = "pending" | "created";

export interface StoredResourceCreateRecord {
	key: string;
	payloadHash: string;
	targetHash: string;
	resourceKind: string;
	status: ResourceCreateStatus;
	/** Bound once the remote create is known to have succeeded. */
	resourceId?: string;
	claimToken: string;
	owner: { pid: number; hostname: string };
	createdAt: string;
	updatedAt: string;
}

export interface ResourceCreateStoreDocument {
	version: 1;
	records: Record<string, StoredResourceCreateRecord>;
}

export type ResourceCreateClaimConflictReason = "payload" | "target" | "resourceKind";

export type ResourceCreateClaimResult =
	| {
			kind: "new";
			claimToken: string;
			record: StoredResourceCreateRecord;
			/**
			 * True when a stale claim from a dead or aged-out owner was taken
			 * over. The previous attempt's remote outcome is unknown, so the
			 * caller must reconcile before issuing a fresh create.
			 */
			recovered: boolean;
	  }
	| { kind: "replay"; record: StoredResourceCreateRecord }
	| { kind: "pending"; record: StoredResourceCreateRecord }
	| {
			kind: "conflict";
			reason: ResourceCreateClaimConflictReason;
			existing: StoredResourceCreateRecord;
	  };

/**
 * Persistence boundary used by `@listmonk-ops/operations`. The shape mirrors
 * the transactional claim/commit/release triple so an adapter can pass a
 * file-backed implementation to the operation without a runtime cast, while
 * the operations package stays runtime-neutral.
 */
export interface ResourceCreateIdempotencyStore {
	claim(options: {
		key: string;
		payloadHash: string;
		targetHash: string;
		resourceKind: string;
		now?: () => Date;
	}): Promise<ResourceCreateClaimResult>;
	/** Bind the claimed key to the created resource id. */
	commit(options: {
		key: string;
		claimToken: string;
		resourceId: string;
		now?: () => Date;
	}): Promise<void>;
	/** Drop a pending claim whose remote create definitively never happened. */
	release(options: { key: string; claimToken: string; now?: () => Date }): Promise<void>;
}

/** Soft cap mirroring the transactional store bound. */
export const RESOURCE_CREATE_STORE_MAX_RECORDS = 10_000;

/**
 * A pending claim older than this (or whose same-host owner process is dead)
 * is considered crashed and may be taken over by a later claim, which then
 * has to reconcile the previous attempt's unknown outcome.
 */
export const RESOURCE_CREATE_CLAIM_STALE_MS = 10 * 60 * 1000;

const RESOURCE_CREATE_STORE_LOCK_TIMEOUT_MS = 30_000;
const STORE_HOSTNAME = hostname();

export function getResourceCreateStorePath(): string {
	const overridden = process.env.LISTMONK_OPS_RESOURCE_CREATE_STORE?.trim();
	if (!overridden) {
		return join(homedir(), ".listmonk-ops", "ops", "resource-creates.json");
	}
	// Resolve relative overrides against the user's home directory (not
	// process.cwd()) so the CLI (invoked from any directory) and the MCP
	// server (started from its service directory) share the same file.
	if (overridden.startsWith("/")) {
		return overridden;
	}
	return resolve(homedir(), overridden);
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestampValue(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.test(
			value,
		) &&
		!Number.isNaN(new Date(value).getTime())
	);
}

/**
 * Status-discriminated invariant: `created` requires a bound `resourceId`
 * and `pending` must not have one. Enforced at read time so manually
 * reconciled or malformed state fails closed.
 */
export function isStoredResourceCreateRecord(
	value: unknown,
): value is StoredResourceCreateRecord {
	if (!isRecordValue(value)) return false;
	if (typeof value.key !== "string" || value.key.length === 0) return false;
	if (typeof value.payloadHash !== "string" || value.payloadHash.length === 0) {
		return false;
	}
	if (typeof value.targetHash !== "string" || value.targetHash.length === 0) {
		return false;
	}
	if (typeof value.resourceKind !== "string" || value.resourceKind.length === 0) {
		return false;
	}
	if (value.status !== "pending" && value.status !== "created") return false;
	if (value.status === "created" && typeof value.resourceId !== "string") {
		return false;
	}
	if (value.status === "pending" && value.resourceId !== undefined) return false;
	if (value.resourceId !== undefined && typeof value.resourceId !== "string") {
		return false;
	}
	if (typeof value.claimToken !== "string" || value.claimToken.length === 0) {
		return false;
	}
	const owner = value.owner;
	if (
		!isRecordValue(owner) ||
		typeof owner.pid !== "number" ||
		!Number.isInteger(owner.pid) ||
		typeof owner.hostname !== "string" ||
		owner.hostname.length === 0
	) {
		return false;
	}
	if (!isIsoTimestampValue(value.createdAt)) return false;
	if (!isIsoTimestampValue(value.updatedAt)) return false;
	return true;
}

export function parseResourceCreateStoreDocument(
	value: unknown,
): ResourceCreateStoreDocument {
	if (!isRecordValue(value)) {
		throw new Error("Invalid resource create store: expected an object");
	}
	if (value.version !== 1) {
		throw new Error(
			`Invalid resource create store: unsupported schema version ${String(value.version)} (expected 1)`,
		);
	}
	if (!isRecordValue(value.records)) {
		throw new Error("Invalid resource create store: records must be an object");
	}
	for (const [key, record] of Object.entries(value.records)) {
		if (!isStoredResourceCreateRecord(record)) {
			throw new Error(
				`Invalid resource create store: record '${key}' failed schema validation`,
			);
		}
		if (record.key !== key) {
			throw new Error(
				`Invalid resource create store: record key '${record.key}' does not match map key '${key}'`,
			);
		}
	}
	return {
		version: 1,
		records: value.records as Record<string, StoredResourceCreateRecord>,
	};
}

export function createResourceCreateStore(
	storePath: string,
): JsonFileStore<ResourceCreateStoreDocument> {
	return {
		path: storePath,
		createDefault: () => ({ version: 1, records: Object.create(null) }),
		parse: parseResourceCreateStoreDocument,
		lock: { timeoutMs: RESOURCE_CREATE_STORE_LOCK_TIMEOUT_MS },
	};
}

function newClaimToken(): string {
	return createHash("sha256")
		.update(`${Date.now()}-${Math.random()}-${randomUUID()}`)
		.digest("hex")
		.slice(0, 16);
}

function copyRecords(
	records: Record<string, StoredResourceCreateRecord>,
): Record<string, StoredResourceCreateRecord> {
	const next: Record<string, StoredResourceCreateRecord> = Object.create(null);
	for (const [key, record] of Object.entries(records)) next[key] = record;
	return next;
}

function isErrnoException(
	error: unknown,
	code: string,
): error is NodeJS.ErrnoException {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === code
	);
}

function isOwnerProcessDead(owner: { pid: number; hostname: string }): boolean {
	if (owner.hostname !== STORE_HOSTNAME) {
		// Cross-host owner liveness cannot be verified locally; only the age
		// threshold below can mark such a claim stale.
		return false;
	}
	try {
		process.kill(owner.pid, 0);
		return false;
	} catch (error) {
		return isErrnoException(error, "ESRCH");
	}
}

function isClaimStale(
	record: StoredResourceCreateRecord,
	now: Date,
): boolean {
	if (isOwnerProcessDead(record.owner)) return true;
	return now.getTime() - new Date(record.createdAt).getTime() >= RESOURCE_CREATE_CLAIM_STALE_MS;
}

function conflictReason(
	existing: StoredResourceCreateRecord,
	options: { payloadHash: string; targetHash: string; resourceKind: string },
): ResourceCreateClaimConflictReason {
	if (existing.targetHash !== options.targetHash) return "target";
	if (existing.payloadHash !== options.payloadHash) return "payload";
	return "resourceKind";
}

/**
 * Atomically claim (or replay) a create key. The locked update serializes
 * concurrent claimants across processes: exactly one receives `new`, and
 * every other same-key caller observes the pending claim. A stale pending
 * claim (dead same-host owner, or older than the age threshold) is replaced
 * for the caller with `recovered: true` so it can reconcile the previous
 * attempt's unknown outcome before creating.
 */
export async function claimResourceCreate(options: {
	storePath?: string;
	key: string;
	payloadHash: string;
	targetHash: string;
	resourceKind: string;
	now?: () => Date;
}): Promise<ResourceCreateClaimResult> {
	const store = createResourceCreateStore(
		options.storePath ?? getResourceCreateStorePath(),
	);
	const nowFn = options.now ?? (() => new Date());

	return updateJsonFileStore<
		ResourceCreateStoreDocument,
		ResourceCreateClaimResult
	>(store, (document) => {
		const now = nowFn();
		const existing = Object.hasOwn(document.records, options.key)
			? document.records[options.key]
			: undefined;

		if (existing !== undefined) {
			if (
				existing.payloadHash !== options.payloadHash ||
				existing.targetHash !== options.targetHash ||
				existing.resourceKind !== options.resourceKind
			) {
				return commitJsonFileStoreUpdate(document, {
					kind: "conflict",
					reason: conflictReason(existing, options),
					existing,
				});
			}
			if (existing.status === "created") {
				return commitJsonFileStoreUpdate(document, {
					kind: "replay",
					record: existing,
				});
			}
			if (!isClaimStale(existing, now)) {
				return commitJsonFileStoreUpdate(document, {
					kind: "pending",
					record: existing,
				});
			}
			// Stale claim: fall through and replace it for this caller.
		}

		if (
			existing === undefined &&
			Object.keys(document.records).length >= RESOURCE_CREATE_STORE_MAX_RECORDS
		) {
			throw new Error(
				"Resource create idempotency store is full; expire old records before claiming new ones",
			);
		}

		const record: StoredResourceCreateRecord = {
			key: options.key,
			payloadHash: options.payloadHash,
			targetHash: options.targetHash,
			resourceKind: options.resourceKind,
			status: "pending",
			claimToken: newClaimToken(),
			owner: { pid: process.pid, hostname: STORE_HOSTNAME },
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
		};
		const records = copyRecords(document.records);
		records[options.key] = record;
		return commitJsonFileStoreUpdate(
			{ version: 1, records },
			{ kind: "new", claimToken: record.claimToken, record, recovered: existing !== undefined },
		);
	});
}

/**
 * Transition a pending claim to the bound `created` state. `claimToken`
 * binds the commit to the originating claim; a mismatched token (the claim
 * was taken over after going stale) is a no-op.
 */
export async function commitResourceCreate(options: {
	storePath?: string;
	key: string;
	claimToken: string;
	resourceId: string;
	now?: () => Date;
}): Promise<void> {
	const store = createResourceCreateStore(
		options.storePath ?? getResourceCreateStorePath(),
	);
	const now = (options.now ?? (() => new Date()))();

	await updateJsonFileStore<ResourceCreateStoreDocument, undefined>(
		store,
		(document) => {
			const existing = Object.hasOwn(document.records, options.key)
				? document.records[options.key]
				: undefined;
			if (
				existing === undefined ||
				existing.claimToken !== options.claimToken ||
				existing.status !== "pending"
			) {
				return commitJsonFileStoreUpdate(document, undefined);
			}
			const updated: StoredResourceCreateRecord = {
				...existing,
				status: "created",
				resourceId: options.resourceId,
				updatedAt: now.toISOString(),
			};
			const records = copyRecords(document.records);
			records[options.key] = updated;
			return commitJsonFileStoreUpdate({ version: 1, records }, undefined);
		},
	);
}

/**
 * Drop a pending claim whose remote create definitively never happened so a
 * retry can claim fresh. A claim already bound to a resource is never
 * removed; a mismatched `claimToken` is a no-op.
 */
export async function releaseResourceCreate(options: {
	storePath?: string;
	key: string;
	claimToken: string;
	now?: () => Date;
}): Promise<void> {
	const store = createResourceCreateStore(
		options.storePath ?? getResourceCreateStorePath(),
	);

	await updateJsonFileStore<ResourceCreateStoreDocument, undefined>(
		store,
		(document) => {
			const existing = Object.hasOwn(document.records, options.key)
				? document.records[options.key]
				: undefined;
			if (
				existing === undefined ||
				existing.claimToken !== options.claimToken ||
				existing.status !== "pending"
			) {
				return commitJsonFileStoreUpdate(document, undefined);
			}
			const records = copyRecords(document.records);
			delete records[options.key];
			return commitJsonFileStoreUpdate({ version: 1, records }, undefined);
		},
	);
}

export function createFileBackedResourceCreateIdempotencyStore(
	options: { storePath?: string } = {},
): ResourceCreateIdempotencyStore {
	const storePath = options.storePath ?? getResourceCreateStorePath();
	return {
		claim: (claimOptions) =>
			claimResourceCreate({ storePath, ...claimOptions }),
		commit: (commitOptions) =>
			commitResourceCreate({ storePath, ...commitOptions }),
		release: (releaseOptions) =>
			releaseResourceCreate({ storePath, ...releaseOptions }),
	};
}

/** Deterministic record identity for tests and diagnostics. */
export function resourceCreateTestKey(kind: string): string {
	return `${kind}:${randomUUID()}`;
}
