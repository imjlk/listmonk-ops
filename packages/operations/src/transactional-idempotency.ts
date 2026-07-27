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

export type TransactionalSendStatus = "pending" | "accepted" | "failed" | "unknown";

/**
 * Persisted idempotency record for a single transactional send.
 *
 * The lifecycle is:
 *   pending   — claimed by a request, dispatch in progress
 *   accepted  — Listmonk returned a positive acknowledgement (`sent: true`)
 *   failed    — Listmonk returned a negative acknowledgement (`sent: false`)
 *   unknown   — the dispatch did not complete cleanly (timeout, connection
 *               reset). Automatic retry is blocked; an operator must inspect
 *               Listmonk and decide whether to reconcile.
 */
export interface TransactionalSendRecord {
	key: string;
	payloadHash: string;
	status: TransactionalSendStatus;
	/** Result captured when the record reaches a terminal `accepted`/`failed` state. */
	sent?: boolean;
	/** Free-form error message captured on `failed`/`unknown` for reconcile context. */
	errorMessage?: string;
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
 * Raised when an idempotent transactional send cannot be safely retried
 * automatically because the prior record is in a non-`accepted` state
 * (`pending`, `unknown`, or `failed`). Extends `OperationExecutionError` so
 * the invoker boundary preserves the typed `key`/`status` metadata rather
 * than re-wrapping it into a generic execution error.
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

function isIsoTimestamp(value: unknown): value is string {
	return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function isTransactionalSendRecord(value: unknown): value is TransactionalSendRecord {
	if (!isRecord(value)) return false;
	if (typeof value.key !== "string" || value.key.length === 0) return false;
	if (typeof value.payloadHash !== "string" || value.payloadHash.length === 0)
		return false;
	if (typeof value.status !== "string" || !TRANSACTIONAL_STATUSES.has(
		value.status as TransactionalSendStatus,
	))
		return false;
	if (value.sent !== undefined && typeof value.sent !== "boolean") return false;
	if (value.errorMessage !== undefined && typeof value.errorMessage !== "string")
		return false;
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
	}
	return {
		version: 1,
		records: value.records as Record<string, TransactionalSendRecord>,
	};
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
		createDefault: () => ({ version: 1, records: {} }),
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
 * Canonical, stable SHA-256 over the normalized send payload. The hash is
 * the replay-equality contract: two requests with the same `idempotency_key`
 * must hash identically, or `claimTransactionalSend` returns a conflict.
 *
 * Normalization intentionally excludes `idempotency_key` itself (it is the
 * map key, not part of the payload) and uses sorted keys so callers cannot
 * trivially produce a hash mismatch by reordering object fields.
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
 * Deterministic JSON serialization: keys sorted at every depth, arrays kept
 * in original order (array order is semantically meaningful for headers).
 * Uses a custom serializer rather than `JSON.stringify` because the native
 * serializer does not guarantee key ordering across engines.
 */
function stableSerializeJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableSerializeJson).join(",")}]`;
	}
	if (isRecord(value)) {
		const entries = Object.entries(value)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries
			.map(([k, v]) => `${JSON.stringify(k)}:${stableSerializeJson(v)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

export type TransactionalClaimResult =
	| { kind: "new"; record: TransactionalSendRecord }
	| { kind: "replay"; record: TransactionalSendRecord }
	| { kind: "conflict"; existing: TransactionalSendRecord };

/**
 * Atomically claim (or replay) an idempotency slot for the given key.
 *
 * Semantics:
 *   - No prior record (or prior record has expired) → write `pending`,
 *     return `{ kind: "new" }`. The caller must dispatch and then call
 *     `commitTransactionalSend` to reach a terminal state.
 *   - Prior record with identical payloadHash and a terminal status →
 *     `{ kind: "replay" }`. The caller returns the stored result without
 *     calling Listmonk.
 *   - Prior record with identical payloadHash and status `pending`/`unknown`/
 *     `failed` → `{ kind: "replay" }` so the caller surfaces the
 *     reconcile-required error rather than silently re-dispatching.
 *   - Prior record with a different payloadHash → `{ kind: "conflict" }`.
 *     The caller rejects with `OperationInputError`.
 */
export async function claimTransactionalSend(options: {
	storePath?: string;
	key: string;
	payloadHash: string;
	ttlMs?: number;
	now?: () => Date;
}): Promise<TransactionalClaimResult> {
	const store = createTransactionalStore(options.storePath);
	const now = (options.now ?? (() => new Date()))();
	const ttlMs = options.ttlMs ?? DEFAULT_TRANSACTIONAL_TTL_MS;
	const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

	return updateJsonFileStore<StoredTransactionalDocument, TransactionalClaimResult>(store, (document) => {
		const existing = document.records[options.key];
		const isExpired =
			existing !== undefined && new Date(existing.expiresAt).getTime() < now.getTime();

		if (existing === undefined || isExpired) {
			const record: TransactionalSendRecord = {
				key: options.key,
				payloadHash: options.payloadHash,
				status: "pending",
				createdAt: now.toISOString(),
				updatedAt: now.toISOString(),
				expiresAt,
			};
			const records = { ...document.records, [options.key]: record };
			return commitJsonFileStoreUpdate(
				{ version: 1, records },
				{ kind: "new", record },
			);
		}

		if (existing.payloadHash !== options.payloadHash) {
			return commitJsonFileStoreUpdate(document, {
				kind: "conflict",
				existing,
			});
		}

		return commitJsonFileStoreUpdate(document, { kind: "replay", record: existing });
	});
}

/**
 * Transition a claimed record to a terminal state. Called exactly once after
 * the Listmonk dispatch settles (success, negative acknowledgement, or an
 * unknown outcome such as a connection reset).
 *
 * If the record was concurrently removed or expired, the update is a no-op;
 * the caller has already observed the dispatch result and there is nothing
 * useful to persist.
 */
export async function commitTransactionalSend(options: {
	storePath?: string;
	key: string;
	status: "accepted" | "failed" | "unknown";
	sent?: boolean;
	errorMessage?: string;
	now?: () => Date;
}): Promise<void> {
	const store = createTransactionalStore(options.storePath);
	const now = (options.now ?? (() => new Date()))();

	await updateJsonFileStore<StoredTransactionalDocument, undefined>(store, (document) => {
		const existing = document.records[options.key];
		if (existing === undefined) {
			// Record vanished (concurrent expiry or manual cleanup). Nothing to
			// commit; surface no error so the dispatch result is the source of
			// truth.
			return commitJsonFileStoreUpdate(document, undefined);
		}
		const updated: TransactionalSendRecord = {
			...existing,
			status: options.status,
			sent: options.sent,
			errorMessage: options.errorMessage,
			updatedAt: now.toISOString(),
		};
		return commitJsonFileStoreUpdate(
			{ version: 1, records: { ...document.records, [options.key]: updated } },
			undefined,
		);
	});
}

/**
 * Heuristic: does this dispatch failure look like an ambiguous transport
 * outcome (timeout, connection reset, socket hang)? Such outcomes must be
 * recorded as `unknown` rather than `failed`, because Listmonk may still
 * have delivered the message and an automatic retry would duplicate it.
 */
export function isAmbiguousTransportError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	const message = error.message.toLowerCase();
	// Common substrings emitted by fetch/undici/Node for transport failures.
	// Match conservatively — anything ambiguous should be treated as unknown.
	const ambiguousSignals = [
		"timeout",
		"timed out",
		"socket hang up",
		"socket hangup",
		"econnreset",
		"econnrefused",
		"enotfound",
		"epipe",
		"fetch failed",
		"network",
		"aborted",
		"terminated",
	];
	return ambiguousSignals.some((signal) => message.includes(signal));
}
