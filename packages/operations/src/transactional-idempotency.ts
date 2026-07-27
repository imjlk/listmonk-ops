import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
} from "@listmonk-ops/common";
import { OperationExecutionError } from "./operation";

/**
 * Default time-to-live for an idempotency record. After this window the
 * record is considered stale and a new send with the same key is treated
 * as a fresh request (the operator is expected to have reconciled by then).
 */
export const DEFAULT_TRANSACTIONAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Lock window for the transactional idempotency store. Shorter than the
 * abtest store because transactional sends should resolve in seconds, not
 * minutes; a long-held lock usually means a hung dispatch.
 */
const TRANSACTIONAL_STORE_LOCK_TIMEOUT_MS = 30_000;

/**
 * Maximum number of records the store retains after a sweep. Each locked
 * update sweeps expired records; this cap also bounds growth when the clock
 * is mocked or many records share a far-future expiry.
 */
const TRANSACTIONAL_STORE_MAX_RECORDS = 10_000;

export type TransactionalSendStatus = "pending" | "accepted" | "failed" | "unknown";

/**
 * Persisted idempotency record for a single transactional send.
 *
 * Status semantics:
 *   pending   — claimed by a request, dispatch in progress
 *   accepted  — Listmonk returned a positive acknowledgement (`sent: true`)
 *   failed    — Listmonk returned a definitive negative acknowledgement
 *               (`sent: false`) or a deterministic application error
 *   unknown   — the dispatch did not complete cleanly (timeout, connection
 *               reset). Automatic retry is blocked; an operator must inspect
 *               Listmonk and decide whether to reconcile.
 *
 * `claimToken` ties a terminal commit to the claim that started it: a
 * dispatch whose record expired and was replaced must not be able to commit
 * into the replacement record.
 */
export interface TransactionalSendRecord {
	key: string;
	payloadHash: string;
	targetHash: string;
	status: TransactionalSendStatus;
	/** Result captured when the record reaches a terminal `accepted`/`failed` state. */
	sent?: boolean;
	/** Free-form error message captured on `failed`/`unknown` for reconcile context. */
	errorMessage?: string;
	/** Opaque token a terminal commit must echo to prove it owns this record. */
	claimToken: string;
	createdAt: string;
	updatedAt: string;
	expiresAt: string;
}

/**
 * On-disk document shape for the transactional idempotency store.
 *
 * Version 1 is the initial shape. Records are keyed by `idempotency_key`
 * so a replay reads in O(1) without scanning history.
 */
export interface StoredTransactionalDocument {
	version: 1;
	records: Record<string, TransactionalSendRecord>;
}

const TRANSACTIONAL_STATUSES = new Set<TransactionalSendStatus>([
	"pending",
	"accepted",
	"failed",
	"unknown",
]);

/**
 * A caller supplied a target namespace that does not match the record's
 * persisted target. This is raised (as an operation input error) rather
 * than silently replaying cross-instance, so a key reused across staging
 * and production cannot mask a real send.
 */
export class TransactionalReconcileError extends OperationExecutionError {
	public readonly key: string;
	public readonly status: TransactionalSendStatus;

	public constructor(
		key: string,
		status: TransactionalSendStatus,
		message: string,
	) {
		super("transactional.send", new Error(message));
		this.name = "TransactionalReconcileError";
		this.key = key;
		this.status = status;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * ISO 8601 timestamp pattern. The store is schema-versioned for
 * interoperability, so `Date.parse` alone is too permissive — it accepts
 * locale strings like "July 4, 2024" and slash dates like "2024/01/15",
 * which would silently widen the on-disk contract.
 */
const ISO_8601_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: unknown): value is string {
	return (
		typeof value === "string" &&
		ISO_8601_TIMESTAMP_PATTERN.test(value) &&
		!Number.isNaN(new Date(value).getTime())
	);
}

function isUuid(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function isTransactionalSendRecord(value: unknown): value is TransactionalSendRecord {
	if (!isRecord(value)) return false;
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
	// Status-discriminated invariant: `accepted` requires a positive
	// acknowledgement. A manually reconciled or malformed record that claims
	// `accepted` without `sent: true` must fail closed at load time.
	if (value.status === "accepted" && value.sent !== true) return false;
	if (value.sent !== undefined && typeof value.sent !== "boolean") return false;
	if (value.errorMessage !== undefined && typeof value.errorMessage !== "string")
		return false;
	if (!isUuid(value.claimToken)) return false;
	if (!isIsoTimestamp(value.createdAt)) return false;
	if (!isIsoTimestamp(value.updatedAt)) return false;
	if (!isIsoTimestamp(value.expiresAt)) return false;
	return true;
}

function parseStoredTransactionalDocument(value: unknown): StoredTransactionalDocument {
	if (!isRecord(value)) {
		throw new Error("Invalid transactional store: expected an object");
	}
	if (value.version !== 1) {
		throw new Error(
			`Invalid transactional store: unsupported schema version ${String(value.version)} (expected 1)`,
		);
	}
	if (!isRecord(value.records)) {
		throw new Error("Invalid transactional store: records must be an object");
	}
	// Hydrate into a null-prototype map so subsequent own-property lookups
	// cannot be poisoned by `constructor`/`__proto__`/`toString` keys.
	const records: Record<string, TransactionalSendRecord> = Object.create(null);
	for (const [key, record] of Object.entries(value.records)) {
		if (!isTransactionalSendRecord(record)) {
			throw new Error(
				`Invalid transactional store: record '${key}' failed schema validation`,
			);
		}
		if (record.key !== key) {
			throw new Error(
				`Invalid transactional store: record key '${record.key}' does not match map key '${key}'`,
			);
		}
		records[key] = record;
	}
	return { version: 1, records };
}

export function getTransactionalStorePath(): string {
	const overridden = process.env.LISTMONK_OPS_TRANSACTIONAL_STORE?.trim();
	return overridden || join(homedir(), ".listmonk-ops", "transactional.json");
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

/**
 * Derive a stable hash for the Listmonk target (API base URL + auth identity).
 * Including this in both the record and the payload hash prevents a key reused
 * across staging and production from replaying the wrong instance's result.
 *
 * Both inputs are optional: when unset (typical for a single-instance
 * deployment) the hash degrades to a constant so existing behavior is
 * preserved.
 */
export function computeTransactionalTargetHash(options: {
	baseUrl?: string;
	username?: string;
}): string {
	const normalized = `${(options.baseUrl ?? "").trim()}\u0000${(options.username ?? "").trim()}`;
	return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Canonical, stable SHA-256 over the normalized send payload. The hash is
 * the replay-equality contract: two requests with the same `idempotency_key`
 * must hash identically, or `claimTransactionalSend` returns a conflict.
 *
 * Normalization intentionally excludes `idempotency_key` itself (it is the
 * map key, not part of the payload) and uses sorted keys so callers cannot
 * trivially produce a hash mismatch by reordering object fields. `undefined`
 * is normalized to `null` and `Date` instances to their ISO string so the
 * hash matches what the JSON transport actually sends.
 */
export function computeTransactionalPayloadHash(input: {
	template_id: number;
	subscriber_email?: string;
	subscriber_id?: number;
	from_email?: string;
	data?: Record<string, unknown>;
	headers?: Array<Record<string, string>>;
	content_type?: "html" | "markdown" | "plain";
}): string {
	const normalized = {
		template_id: input.template_id,
		subscriber_email: input.subscriber_email,
		subscriber_id: input.subscriber_id,
		from_email: input.from_email,
		data: input.data,
		headers: input.headers,
		content_type: input.content_type,
	};
	const serialized = stableSerializeJson(normalized);
	return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Deterministic JSON serialization that mirrors the transport's semantics:
 * keys sorted at every depth, arrays kept in original order (array order is
 * semantically meaningful for headers), `undefined` normalized to `null`,
 * and `Date` instances serialized as ISO strings — matching what
 * `JSON.stringify` would actually send on the wire.
 *
 * A `WeakSet` visited-guard rejects cyclic structures before they overflow
 * the stack. JSON-parsed input cannot form cycles, but `data` is typed as
 * `Record<string, unknown>` and a caller could hand in a live object graph;
 * failing loudly is safer than crashing the process.
 */
function stableSerializeJson(
	value: unknown,
	seen: WeakSet<object> = new WeakSet(),
): string {
	if (value === undefined) return "null";
	if (value instanceof Date) return JSON.stringify(value.toISOString());
	if (Array.isArray(value)) {
		if (seen.has(value)) {
			throw new Error("Circular reference detected in transactional payload");
		}
		seen.add(value);
		const result = `[${value
			.map((entry) => stableSerializeJson(entry, seen))
			.join(",")}]`;
		seen.delete(value);
		return result;
	}
	if (isRecord(value)) {
		if (seen.has(value)) {
			throw new Error("Circular reference detected in transactional payload");
		}
		seen.add(value);
		const entries = Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		const result = `{${entries
			.map(
				([k, v]) => `${JSON.stringify(k)}:${stableSerializeJson(v, seen)}`,
			)
			.join(",")}}`;
		seen.delete(value);
		return result;
	}
	return JSON.stringify(value);
}

export type TransactionalClaimResult =
	| { kind: "new"; record: TransactionalSendRecord }
	| { kind: "replay"; record: TransactionalSendRecord }
	| { kind: "conflict"; existing: TransactionalSendRecord };

function newClaimToken(): string {
	// 16 hex chars of entropy are more than enough to make a stale worker's
	// post-TTL commit vanishingly unlikely to collide with a fresh claim.
	return createHash("sha256")
		.update(`${Date.now()}-${Math.random()}-${process.pid}`)
		.digest("hex")
		.slice(0, 16);
}

/**
 * Drop expired records (and trim to a hard cap) under the lock so a sustained
 * send rate cannot grow the JSON document without bound. Returns the swept
 * document and the set of survivors.
 */
function sweepExpiredRecords(
	document: StoredTransactionalDocument,
	now: Date,
): StoredTransactionalDocument {
	const nowMs = now.getTime();
	const survivors: Record<string, TransactionalSendRecord> = Object.create(
		null,
	);
	let alive = 0;
	for (const [key, record] of Object.entries(document.records)) {
		if (new Date(record.expiresAt).getTime() >= nowMs) {
			survivors[key] = record;
			alive++;
		}
	}
	// Hard cap on store size as a backstop against pathological traffic.
	if (alive <= TRANSACTIONAL_STORE_MAX_RECORDS) {
		return alive === Object.keys(document.records).length
			? document
			: { version: 1, records: survivors };
	}
	// Evict oldest-expiring records first when over the cap.
	const sorted = Object.entries(survivors).sort(
		(a, b) =>
			new Date(a[1].expiresAt).getTime() -
			new Date(b[1].expiresAt).getTime(),
	);
	const trimmed: Record<string, TransactionalSendRecord> = Object.create(null);
	for (const [key, record] of sorted.slice(
		sorted.length - TRANSACTIONAL_STORE_MAX_RECORDS,
	)) {
		trimmed[key] = record;
	}
	return { version: 1, records: trimmed };
}

/**
 * Return the record at `key` only when it is an own property of `records`.
 * Used instead of `records[key]` directly so `__proto__`/`constructor`
 * inherited values cannot poison the lookup, and so the caller gets a
 * narrowed `TransactionalSendRecord` (not `T | undefined`).
 */
function getOwnRecord(
	records: Record<string, TransactionalSendRecord>,
	key: string,
): TransactionalSendRecord | undefined {
	if (!Object.prototype.hasOwnProperty.call(records, key)) return undefined;
	return records[key];
}

/**
 * Atomically claim (or replay) an idempotency slot for the given key.
 *
 * Semantics:
 *   - No prior record (or prior record has expired) → write `pending`,
 *     return `{ kind: "new" }`. The caller must dispatch and then call
 *     `commitTransactionalSend` with the returned `claimToken` to reach
 *     a terminal state.
 *   - Prior record with identical payloadHash AND targetHash, in a
 *     terminal state (`accepted` or `failed`) → `{ kind: "replay" }`.
 *     The caller returns the stored result without calling Listmonk.
 *   - Prior record in a non-terminal state (`pending`/`unknown`) →
 *     `{ kind: "replay" }` so the caller surfaces the reconcile-required
 *     error rather than silently re-dispatching.
 *   - Prior record with a different payloadHash or targetHash →
 *     `{ kind: "conflict" }`. The caller rejects with `OperationInputError`.
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
	const now = (options.now ?? (() => new Date()))();
	const ttlMs = options.ttlMs ?? DEFAULT_TRANSACTIONAL_TTL_MS;
	const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

	return updateJsonFileStore<StoredTransactionalDocument, TransactionalClaimResult>(store, (document) => {
		const swept = sweepExpiredRecords(document, now);
		const records = swept.records;
		const existing = getOwnRecord(records, options.key);

		if (existing !== undefined) {
			const samePayload =
				existing.payloadHash === options.payloadHash &&
				existing.targetHash === options.targetHash;
			if (!samePayload) {
				return commitJsonFileStoreUpdate(swept, {
					kind: "conflict",
					existing,
				});
			}
			return commitJsonFileStoreUpdate(swept, { kind: "replay", record: existing });
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
		const nextRecords: Record<string, TransactionalSendRecord> =
			Object.create(null);
		for (const [k, v] of Object.entries(records)) nextRecords[k] = v;
		nextRecords[options.key] = record;
		return commitJsonFileStoreUpdate(
			{ version: 1, records: nextRecords },
			{ kind: "new", record },
		);
	});
}

/**
 * Transition a claimed record to a terminal state. Called exactly once after
 * the Listmonk dispatch settles (success, negative acknowledgement, or an
 * unknown outcome such as a connection reset).
 *
 * `claimToken` binds the commit to the claim that started it: if the record
 * expired and was replaced between claim and commit, the token will not
 * match and the commit becomes a no-op (the dispatch result is still
 * surfaced to the caller).
 *
 * If the record has vanished (concurrent expiry or manual cleanup), the
 * update is a no-op; the caller has already observed the dispatch result
 * and there is nothing useful to persist.
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

	await updateJsonFileStore<StoredTransactionalDocument, undefined>(store, (document) => {
		const swept = sweepExpiredRecords(document, now);
		const existing = getOwnRecord(swept.records, options.key);
		if (existing === undefined) {
			return commitJsonFileStoreUpdate(swept, undefined);
		}
		// Stale-commit guard: a dispatch whose record expired and was
		// replaced must not be able to complete into the replacement.
		if (existing.claimToken !== options.claimToken) {
			return commitJsonFileStoreUpdate(swept, undefined);
		}
		// Enforce the accepted ⇒ sent:true invariant at write time so the
		// read-side validator never has to recover from bad state.
		const sent = options.status === "accepted" ? true : options.sent;
		const updated: TransactionalSendRecord = {
			...existing,
			status: options.status,
			sent,
			errorMessage: options.errorMessage,
			updatedAt: now.toISOString(),
		};
		const nextRecords: Record<string, TransactionalSendRecord> =
			Object.create(null);
		for (const [k, v] of Object.entries(swept.records)) nextRecords[k] = v;
		nextRecords[options.key] = updated;
		return commitJsonFileStoreUpdate({ version: 1, records: nextRecords }, undefined);
	});
}

/**
 * Heuristic: does this dispatch failure look like an ambiguous transport
 * outcome (timeout, connection reset, socket hang)? Such outcomes must be
 * recorded as `unknown` rather than `failed`, because Listmonk may still
 * have delivered the message and an automatic retry would duplicate it.
 *
 * Kept specific on purpose. Direct `ECONNREFUSED` (nothing is listening)
 * and `ENOTFOUND` (DNS failure) are definitive: the request never reached
 * Listmonk, so a retry is safe and classifying them as `unknown` would
 * needlessly block the caller for the full TTL window.
 */
export function isAmbiguousTransportError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	const ambiguousSignals = [
		"timeout",
		"timed out",
		"socket hang up",
		"socket hangup",
		"econnreset",
		"epipe",
		"enetunreach",
		"fetch failed",
		"network error",
		"network is unreachable",
		"aborted",
		"terminated",
	];
	return ambiguousSignals.some((signal) => message.includes(signal));
}
