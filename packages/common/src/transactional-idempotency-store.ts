import { createHash, randomUUID } from "node:crypto";
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
 * evicting a live record) once this many unexpired records are present, so
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
	version: 1;
	records: Record<string, TransactionalSendRecord>;
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
	if (value.version !== 1) {
		throw new Error(
			`Invalid transactional store: unsupported schema version ${String(value.version)} (expected 1)`,
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
	return {
		version: 1,
		records: value.records as Record<string, TransactionalSendRecord>,
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
		return join(homedir(), ".listmonk-ops", "transactional.json");
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
		createDefault: () => ({ version: 1, records: Object.create(null) }),
		parse: parseStoredTransactionalDocument,
		lock: { timeoutMs: TRANSACTIONAL_STORE_LOCK_TIMEOUT_MS },
	};
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
 * Drop expired records under the lock. Live records are NEVER evicted to
 * make room — when the survivor count would exceed the cap the caller
 * rejects the new claim instead (see `claimTransactionalSend`).
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
		if (new Date(record.expiresAt).getTime() >= nowMs) {
			survivors[key] = record;
		} else {
			changed = true;
		}
	}
	return {
		document: changed ? { version: 1, records: survivors } : document,
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
				`Transactional idempotency store is at capacity (${TRANSACTIONAL_STORE_MAX_RECORDS} unexpired records). Increase the TTL sweep cadence, raise TRANSACTIONAL_STORE_MAX_RECORDS, or use a partitioned store.`,
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
			{ version: 1, records: nextRecords },
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
				{ version: 1, records: nextRecords },
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
				{ version: 1, records: nextRecords },
				undefined,
			);
		},
	);
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
		load: () => readJsonFileStore(createTransactionalStore(storePath)),
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
	return readJsonFileStore(createTransactionalStore(storePath));
}

export async function validateStoredTransactionalStore(
	storePath = getTransactionalStorePath(),
): Promise<void> {
	await readJsonFileStore(createTransactionalStore(storePath));
}

// Re-export randomUUID consumers can use for idempotency keys if desired.
export { randomUUID as newTransactionalIdempotencyKey };
