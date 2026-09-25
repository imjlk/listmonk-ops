import { getListmonkDataDirectory } from "./configuration";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
} from "./json-file-store";

/**
 * Default time-to-live for a transactional idempotency record. Mirrors the
 * constant exported from `@listmonk-ops/operations`; duplicated here so the
 * file-backed store has no upward dependency on the operations package.
 */
export const DEFAULT_TRANSACTIONAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Soft cap on retained records. The store rejects new claims (rather than
 * evicting a retained record) once this many records are present, so
 * a high-volume installation cannot silently break the idempotency
 * guarantee for an in-flight key.
 */
export const TRANSACTIONAL_STORE_MAX_RECORDS = 10_000;

const TRANSACTIONAL_STORE_LOCK_TIMEOUT_MS = 30_000;

export type TransactionalSendStatus =
	| "pending"
	| "accepted"
	| "failed"
	| "unknown";

export interface TransactionalSendRecord {
	key: string;
	payloadHash: string;
	targetHash: string;
	status: TransactionalSendStatus;
	sent?: boolean;
	errorMessage?: string;
	claimToken: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
}

export interface StoredTransactionalDocument {
	version: 2;
	records: Record<string, TransactionalSendRecord>;
	/** Recent direct-send decisions plus durable sequence recovery decisions. */
	reconciliations?: TransactionalReconciliationEvent[];
}

const MAX_DIRECT_RECONCILIATIONS = 1_000;

function isSequenceReconciliationKey(key: string): boolean {
	return key.startsWith("sequence:");
}

function retainReconciliationHistory(events: TransactionalReconciliationEvent[]): TransactionalReconciliationEvent[] {
	const latestSequenceIndexes = new Map<string, number>();
	let directCount = 0;
	for (const [index, event] of events.entries()) {
		if (isSequenceReconciliationKey(event.key)) latestSequenceIndexes.set(event.key, index);
		else directCount += 1;
	}
	let directToDrop = Math.max(0, directCount - MAX_DIRECT_RECONCILIATIONS);
	return events.filter((event, index) => {
		if (isSequenceReconciliationKey(event.key)) return latestSequenceIndexes.get(event.key) === index;
		if (directToDrop > 0) {
			directToDrop -= 1;
			return false;
		}
		return true;
	});
}

export interface TransactionalReconciliationEvent {
	key: string;
	targetHash: string;
	payloadHash: string;
	previousStatus: "pending" | "unknown";
	previousRevision: string;
	decision: "accepted" | "retry";
	reason: string;
	reconciledAt: string;
}

export type TransactionalClaimResult =
	| { kind: "new"; record: TransactionalSendRecord }
	| { kind: "replay"; record: TransactionalSendRecord }
	| { kind: "conflict"; existing: TransactionalSendRecord };

/**
 * Persistence boundary used by `@listmonk-ops/operations`. The shape is
 * intentionally identical to `TransactionalIdempotencyStore` in the
 * operations package so an adapter can pass this file-backed implementation
 * to the operation without a runtime cast, while keeping the operations
 * package runtime-neutral (no `node:crypto`/`node:fs` imports).
 */
export interface TransactionalIdempotencyStore {
	claim(options: {
		key: string;
		payloadHash: string;
		targetHash: string;
		ttlMs?: number;
		now?: () => Date;
	}): Promise<TransactionalClaimResult>;
	commit(options: {
		key: string;
		claimToken: string;
		status: "accepted" | "failed" | "unknown";
		sent?: boolean;
		errorMessage?: string;
		now?: () => Date;
	}): Promise<void>;
	release(options: {
		key: string;
		claimToken: string;
		now?: () => Date;
	}): Promise<void>;
	load(): Promise<StoredTransactionalDocument>;
	reconcile(options: TransactionalReconciliationOptions): Promise<TransactionalReconciliationResult>;
	forgetReconciliation?(options: { key: string; targetHash: string }): Promise<void>;
}

export interface TransactionalReconciliationOptions {
	key: string;
	targetHash: string;
	expectedRevision: string;
	decision: "accepted" | "retry";
	reason: string;
	/** Required for retry decisions after TTL; confirms the sender stopped. */
	quiesced?: boolean;
	now?: () => Date;
}

export interface TransactionalReconciliationResult {
	key: string;
	decision: "accepted" | "retry";
	reconciledAt: string;
	/** Accepted records get a new revision; retry removes the old record. */
	revision?: string;
}

const TRANSACTIONAL_STATUSES = new Set<TransactionalSendStatus>([
	"pending",
	"accepted",
	"failed",
	"unknown",
]);

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

function isReconciliationEvent(value: unknown): value is TransactionalReconciliationEvent {
	return isRecordValue(value)
		&& typeof value.key === "string" && value.key.length > 0
		&& typeof value.targetHash === "string" && value.targetHash.length > 0
		&& typeof value.payloadHash === "string" && value.payloadHash.length > 0
		&& (value.previousStatus === "pending" || value.previousStatus === "unknown")
		&& typeof value.previousRevision === "string" && value.previousRevision.length > 0
		&& (value.decision === "accepted" || value.decision === "retry")
		&& typeof value.reason === "string" && value.reason.trim().length >= 10 && value.reason.length <= 500
		&& !/[\u0000-\u001f\u007f]/u.test(value.reason)
		&& isIsoTimestampValue(value.reconciledAt);
}

/**
 * Status-discriminated invariant: `accepted` requires `sent: true`. Used at
 * read time so manually reconciled or malformed state fails closed.
 */
export function isStoredTransactionalSendRecord(
	value: unknown,
): value is TransactionalSendRecord {
	if (!isRecordValue(value)) return false;
	if (typeof value.key !== "string" || value.key.length === 0) return false;
	if (typeof value.payloadHash !== "string" || value.payloadHash.length === 0)
		return false;
	if (typeof value.targetHash !== "string" || value.targetHash.length === 0)
		return false;
	if (
		typeof value.status !== "string" ||
		!TRANSACTIONAL_STATUSES.has(value.status as TransactionalSendStatus)
	) {
		return false;
	}
	// Status-discriminated invariants:
	//   accepted requires sent:true (positive acknowledgement)
	//   failed   requires sent !== true (definitive negative acknowledgement)
	// so manually reconciled or malformed state cannot lie about the outcome.
	if (value.status === "accepted" && value.sent !== true) return false;
	if (value.status === "failed" && value.sent === true) return false;
	if (value.sent !== undefined && typeof value.sent !== "boolean") return false;
	if (value.errorMessage !== undefined && typeof value.errorMessage !== "string")
		return false;
	if (typeof value.claimToken !== "string" || value.claimToken.length === 0)
		return false;
	if (!isIsoTimestampValue(value.createdAt)) return false;
	if (!isIsoTimestampValue(value.updatedAt)) return false;
	if (!isIsoTimestampValue(value.expiresAt)) return false;
	return true;
}

export function parseStoredTransactionalDocument(
	value: unknown,
): StoredTransactionalDocument {
	if (!isRecordValue(value)) {
		throw new Error("Invalid transactional store: expected an object");
	}
	if (value.version !== 1 && value.version !== 2) {
		throw new Error(
			`Invalid transactional store: unsupported schema version ${String(value.version)} (expected 1 or 2)`,
		);
	}
	if (value.version === 1 && value.reconciliations !== undefined) {
		throw new Error(
			"Invalid transactional store: version 1 cannot contain reconciliation history",
		);
	}
	if (!isRecordValue(value.records)) {
		throw new Error("Invalid transactional store: records must be an object");
	}
	for (const [key, record] of Object.entries(value.records)) {
		if (!isStoredTransactionalSendRecord(record)) {
			throw new Error(
				`Invalid transactional store: record '${key}' failed schema validation`,
			);
		}
		if (record.key !== key) {
			throw new Error(
				`Invalid transactional store: record key '${record.key}' does not match map key '${key}'`,
			);
		}
	}
	if (value.reconciliations !== undefined && (!Array.isArray(value.reconciliations)
		|| value.reconciliations.some((event) => !isReconciliationEvent(event))
		|| value.reconciliations.filter((event) => !isSequenceReconciliationKey(event.key)).length > MAX_DIRECT_RECONCILIATIONS)) {
		throw new Error("Invalid transactional reconciliation history");
	}
	return {
		version: 2,
		records: value.records as Record<string, TransactionalSendRecord>,
		...(value.reconciliations === undefined ? {} : { reconciliations: value.reconciliations as TransactionalReconciliationEvent[] }),
	};
}

export class TransactionalStoreCapacityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TransactionalStoreCapacityError";
	}
}

export function getTransactionalStorePath(): string {
	const overridden = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE?.trim();
	if (!overridden) {
		return join(getListmonkDataDirectory(), "transactional.json");
	}
	// Resolve relative overrides against the user's home directory (not
	// process.cwd()) so the CLI (invoked from any directory) and the MCP
	// server (started from its service directory) share the same file.
	// A cwd-based resolve would map the same configuration to different
	// files depending on where each process was launched.
	if (overridden.startsWith("/")) {
		return overridden;
	}
	return resolve(homedir(), overridden);
}

/**
 * Derive a stable hash for the Listmonk target (API base URL + auth
 * identity). Including this in both the record and the payload hash
 * prevents a key reused across staging and production from replaying the
 * wrong instance's result. Mirrors the pure implementation exported from
 * `@listmonk-ops/operations` so adapters can compute the target hash
 * without an upward dependency.
 */
export function computeTransactionalTargetHash(options: {
	baseUrl?: string;
	username?: string;
}): string {
	const normalized = `${(options.baseUrl ?? "").trim()}\u0000${(options.username ?? "").trim()}`;
	// Mirror the operations-package pure implementation: two independent
	// FNV-1a 32-bit passes (different seeds) combined into 64 bits so a
	// deliberate cross-instance collision is impractical.
	const hi = fnv1a32(normalized, 0x811c9dc5);
	const lo = fnv1a32(normalized, 0x84222325);
	return hi.padStart(8, "0") + lo.padStart(8, "0");
}

function fnv1a32(input: string, seed: number): string {
	let hash = seed;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16);
}

function createTransactionalStore(
	storePath = getTransactionalStorePath(),
): JsonFileStore<StoredTransactionalDocument> {
	return {
		path: storePath,
		createDefault: () => ({ version: 2, records: Object.create(null) }),
		parse: parseStoredTransactionalDocument,
		lock: { timeoutMs: TRANSACTIONAL_STORE_LOCK_TIMEOUT_MS },
	};
}

/** Promote a legacy document before an operator relies on a read-only inspection. */
async function loadTransactionalDocument(storePath: string): Promise<StoredTransactionalDocument> {
	const store = createTransactionalStore(storePath);
	const document = await readJsonFileStore(store);
	let raw: string;
	try {
		raw = await readFile(storePath, "utf8");
	} catch (error) {
		if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
			// Establish the version-2 marker even for an empty inspection, so an
			// old process cannot subsequently create a version-1 store here.
			return updateJsonFileStore<StoredTransactionalDocument, StoredTransactionalDocument>(
				store,
				(current) => commitJsonFileStoreUpdate(current, current),
			);
		}
		throw error;
	}
	if ((JSON.parse(raw) as { version?: unknown }).version !== 1) return document;
	// Re-read under the store lock. A concurrent old writer must see version 2
	// before it can sweep another ambiguous claim.
	return updateJsonFileStore<StoredTransactionalDocument, StoredTransactionalDocument>(
		store,
		(current) => commitJsonFileStoreUpdate(current, current),
	);
}

function newClaimToken(): string {
	return createHash("sha256")
		.update(`${Date.now()}-${Math.random()}-${process.pid}`)
		.digest("hex")
		.slice(0, 16);
}

function getOwnRecord(
	records: Record<string, TransactionalSendRecord>,
	key: string,
): TransactionalSendRecord | undefined {
	if (!Object.prototype.hasOwnProperty.call(records, key)) return undefined;
	return records[key];
}

/**
 * Drop expired definitive outcomes under the lock. Pending and unknown
 * dispatches may already have reached Listmonk, so time alone must never
 * authorize another delivery with the same key. The operator must reconcile
 * those records explicitly, even after their original TTL.
 */
function sweepExpiredRecords(
	document: StoredTransactionalDocument,
	now: Date,
): { document: StoredTransactionalDocument; changed: boolean } {
	const nowMs = now.getTime();
	const survivors: Record<string, TransactionalSendRecord> = Object.create(
		null,
	);
	let changed = false;
	for (const [key, record] of Object.entries(document.records)) {
		if (record.status === "pending" || record.status === "unknown" ||
			(record.status === "accepted" && isSequenceReconciliationKey(key)) ||
			new Date(record.expiresAt).getTime() >= nowMs) {
			survivors[key] = record;
		} else {
			changed = true;
		}
	}
	return {
		document: changed ? { ...document, records: survivors } : document,
		changed,
	};
}

function copyRecords(
	records: Record<string, TransactionalSendRecord>,
): Record<string, TransactionalSendRecord> {
	const next: Record<string, TransactionalSendRecord> = Object.create(null);
	for (const [k, v] of Object.entries(records)) next[k] = v;
	return next;
}

/**
 * Atomically claim (or replay) an idempotency slot. Sweeps expired records
 * on every locked update. When the survivor count is already at the cap,
 * rejects with `TransactionalStoreCapacityError` rather than evicting a
 * live record.
 */
export async function claimTransactionalSend(options: {
	storePath?: string;
	key: string;
	payloadHash: string;
	targetHash: string;
	ttlMs?: number;
	now?: () => Date;
}): Promise<TransactionalClaimResult> {
	const store = createTransactionalStore(options.storePath);
	const nowFn = options.now ?? (() => new Date());
	const ttlMs = options.ttlMs ?? DEFAULT_TRANSACTIONAL_TTL_MS;
	// A non-positive TTL would produce an already-expired record; the next
	// locked update would sweep it, so an identical retry would receive a
	// fresh claim and dispatch again — defeating idempotency.
	if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
		throw new Error(
			`Transactional idempotency TTL must be a positive finite number of milliseconds (received ${String(ttlMs)})`,
		);
	}

	return updateJsonFileStore<StoredTransactionalDocument, TransactionalClaimResult>(store, (document) => {
		// Capture the timestamp INSIDE the locked update so lock-wait time
		// does not eat into the TTL. Computing it outside could persist a
		// record whose expiration is already in the past after contention.
		const now = nowFn();
		const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
		const swept = sweepExpiredRecords(document, now);
		const records = swept.document.records;
		const existing = getOwnRecord(records, options.key);

		if (existing !== undefined) {
			const samePayload =
				existing.payloadHash === options.payloadHash &&
				existing.targetHash === options.targetHash;
			if (!samePayload) {
				return commitJsonFileStoreUpdate(swept.document, {
					kind: "conflict",
					existing,
				});
			}
			return commitJsonFileStoreUpdate(swept.document, {
				kind: "replay",
				record: existing,
			});
		}

		// Capacity guard: reject rather than evicting a live record.
		if (
			Object.keys(records).length >= TRANSACTIONAL_STORE_MAX_RECORDS
		) {
			throw new TransactionalStoreCapacityError(
				`Transactional idempotency store is at capacity (${TRANSACTIONAL_STORE_MAX_RECORDS} retained records). Reconcile ambiguous sends, raise TRANSACTIONAL_STORE_MAX_RECORDS, or use a partitioned store.`,
			);
		}

		const record: TransactionalSendRecord = {
			key: options.key,
			payloadHash: options.payloadHash,
			targetHash: options.targetHash,
			status: "pending",
			claimToken: newClaimToken(),
			createdAt: now.toISOString(),
			updatedAt: now.toISOString(),
			expiresAt,
		};
		const nextRecords = copyRecords(records);
		nextRecords[options.key] = record;
		return commitJsonFileStoreUpdate(
			{ ...swept.document, records: nextRecords },
			{ kind: "new", record },
		);
	});
}

/**
 * Transition a claimed record to a terminal state. `claimToken` binds the
 * commit to the originating claim; a mismatched token (record expired and
 * was replaced) is a no-op. Accepted ⇒ `sent: true` is enforced at write
 * time.
 */
export async function commitTransactionalSend(options: {
	storePath?: string;
	key: string;
	claimToken: string;
	status: "accepted" | "failed" | "unknown";
	sent?: boolean;
	errorMessage?: string;
	now?: () => Date;
}): Promise<void> {
	const store = createTransactionalStore(options.storePath);
	const now = (options.now ?? (() => new Date()))();

	await updateJsonFileStore<StoredTransactionalDocument, undefined>(
		store,
		(document) => {
			const swept = sweepExpiredRecords(document, now);
			const existing = getOwnRecord(swept.document.records, options.key);
			if (existing === undefined) {
				return commitJsonFileStoreUpdate(swept.document, undefined);
			}
			if (existing.claimToken !== options.claimToken) {
				return commitJsonFileStoreUpdate(swept.document, undefined);
			}
			// Enforce the status-discriminated sent invariant at write time:
			// accepted ⇒ true, failed ⇒ not true, unknown leaves it optional.
			// This stops a caller (or a manual reconcile) from persisting a
			// contradictory combination the read-side validator would reject.
			const sent =
				options.status === "accepted"
					? true
					: options.status === "failed"
						? options.sent === true
							? false
							: options.sent
						: options.sent;
			const updated: TransactionalSendRecord = {
				...existing,
				status: options.status,
				sent,
				errorMessage: options.errorMessage,
				updatedAt: now.toISOString(),
			};
			const nextRecords = copyRecords(swept.document.records);
			nextRecords[options.key] = updated;
			return commitJsonFileStoreUpdate(
				{ ...swept.document, records: nextRecords },
				undefined,
			);
		},
	);
}

/**
 * Release (delete) a claim whose dispatch threw a definitive error so a
 * retry can dispatch again. `claimToken` binds the release to the
 * originating claim; a mismatched token (record expired and was replaced)
 * is a no-op.
 */
export async function releaseTransactionalSend(options: {
	storePath?: string;
	key: string;
	claimToken: string;
	now?: () => Date;
}): Promise<void> {
	const store = createTransactionalStore(options.storePath);
	const now = (options.now ?? (() => new Date()))();

	await updateJsonFileStore<StoredTransactionalDocument, undefined>(
		store,
		(document) => {
			const swept = sweepExpiredRecords(document, now);
			const existing = getOwnRecord(swept.document.records, options.key);
			if (existing === undefined || existing.claimToken !== options.claimToken) {
				return commitJsonFileStoreUpdate(swept.document, undefined);
			}
			const nextRecords = copyRecords(swept.document.records);
			delete nextRecords[options.key];
			return commitJsonFileStoreUpdate(
				{ ...swept.document, records: nextRecords },
				undefined,
			);
		},
	);
}

/** Resolve an ambiguous claim under the same lock used for send and commit. */
export async function reconcileTransactionalSend(options: TransactionalReconciliationOptions & { storePath?: string }): Promise<TransactionalReconciliationResult> {
	if (options.reason.trim().length < 10 || options.reason.length > 500 || /[\u0000-\u001f\u007f]/u.test(options.reason)) {
		throw new Error(
			"A reconciliation reason of 10-500 printable characters is required",
		);
	}
	const store = createTransactionalStore(options.storePath);
	return updateJsonFileStore<StoredTransactionalDocument, TransactionalReconciliationResult>(store, (document) => {
		const now = (options.now ?? (() => new Date()))();
		const swept = sweepExpiredRecords(document, now);
		const existing = getOwnRecord(swept.document.records, options.key);
		if (!existing || existing.targetHash !== options.targetHash) throw new Error("Transactional record not found for this Listmonk target");
		if (existing.claimToken !== options.expectedRevision) throw new Error("Transactional record changed; inspect it again before reconciling");
		if (existing.status !== "pending" && existing.status !== "unknown") throw new Error("Only pending or unknown transactional records can be reconciled");
		if (options.decision === "retry" && (new Date(existing.expiresAt).getTime() >= now.getTime() || options.quiesced !== true)) {
			throw new Error("Dispatch may still be active; wait past its TTL and attest that its sender has stopped");
		}
		const nextRecords = copyRecords(swept.document.records);
		const result: TransactionalReconciliationResult = { key: options.key, decision: options.decision, reconciledAt: now.toISOString() };
		if (options.decision === "accepted") {
			const revision = newClaimToken();
			nextRecords[options.key] = {
				...existing, status: "accepted", sent: true, errorMessage: undefined,
				claimToken: revision, updatedAt: now.toISOString(),
				expiresAt: new Date(now.getTime() + DEFAULT_TRANSACTIONAL_TTL_MS).toISOString(),
			};
			result.revision = revision;
		} else if (options.decision === "retry") {
			delete nextRecords[options.key];
		} else {
			throw new Error("Invalid transactional reconciliation decision");
		}
		const event: TransactionalReconciliationEvent = {
			key: options.key, targetHash: options.targetHash, decision: options.decision,
			payloadHash: existing.payloadHash, previousStatus: existing.status, previousRevision: existing.claimToken,
			reason: options.reason, reconciledAt: now.toISOString(),
		};
		return commitJsonFileStoreUpdate({
			...swept.document, records: nextRecords,
			reconciliations: retainReconciliationHistory([...(swept.document.reconciliations ?? []), event]),
		}, result);
	});
}

/** Drop a sequence recovery decision and accepted receipt only after its enrollment has durably advanced. */
export async function forgetSequenceReconciliation(options: { storePath?: string; key: string; targetHash: string }): Promise<void> {
	if (!isSequenceReconciliationKey(options.key)) return;
	const store = {
		...createTransactionalStore(options.storePath),
		skipUnchangedWrites: true,
	};
	await updateJsonFileStore<StoredTransactionalDocument, void>(store, (document) => {
		const previous = document.reconciliations;
		const remaining = previous?.filter(
			(event) => event.key !== options.key || event.targetHash !== options.targetHash,
		);
		const record = getOwnRecord(document.records, options.key);
		const removeAccepted = record?.status === "accepted" && record.targetHash === options.targetHash;
		if (remaining?.length === previous?.length && !removeAccepted) return commitJsonFileStoreUpdate(document, undefined);
		const records = removeAccepted ? copyRecords(document.records) : document.records;
		if (removeAccepted) delete records[options.key];
		return commitJsonFileStoreUpdate({ ...document, records, reconciliations: remaining }, undefined);
	});
}

/**
 * Convenience wrapper that exposes the file-backed claim/commit/release
 * triple behind the `TransactionalIdempotencyStore` interface used by the
 * operations package. Adapters pass this to `TransactionalOperationContext`.
 */
export function createFileBackedTransactionalIdempotencyStore(
	options: { storePath?: string } = {},
): TransactionalIdempotencyStore {
	const storePath = options.storePath ?? getTransactionalStorePath();
	return {
		claim: (claimOptions) =>
			claimTransactionalSend({ storePath, ...claimOptions }),
		commit: (commitOptions) =>
			commitTransactionalSend({ storePath, ...commitOptions }),
		release: (releaseOptions) =>
			releaseTransactionalSend({ storePath, ...releaseOptions }),
		load: () => loadTransactionalDocument(storePath),
		reconcile: (reconcileOptions) =>
			reconcileTransactionalSend({ storePath, ...reconcileOptions }),
		forgetReconciliation: (forgetOptions) =>
			forgetSequenceReconciliation({ storePath, ...forgetOptions }),
	};
}

/**
 * SHA-256 hex digest of the canonical serialized payload. Adapters pass this
 * as `TransactionalOperationContext.hashPayload` so the operations package
 * does not depend on `node:crypto`.
 */
export function hashTransactionalPayload(serialized: string): string {
	return createHash("sha256").update(serialized).digest("hex");
}

export async function loadStoredTransactionalDocument(
	storePath = getTransactionalStorePath(),
): Promise<StoredTransactionalDocument> {
	return loadTransactionalDocument(storePath);
}

export async function validateStoredTransactionalStore(
	storePath = getTransactionalStorePath(),
): Promise<void> {
	await readJsonFileStore(createTransactionalStore(storePath));
}

// Re-export randomUUID consumers can use for idempotency keys if desired.
export { randomUUID as newTransactionalIdempotencyKey };
