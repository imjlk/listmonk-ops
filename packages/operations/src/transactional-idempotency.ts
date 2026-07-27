import { OperationExecutionError } from "./operation";

/**
 * Default time-to-live for an idempotency record. After this window the
 * record is considered stale and a new send with the same key is treated
 * as a fresh request (the operator is expected to have reconciled by then).
 */
export const DEFAULT_TRANSACTIONAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Soft cap on the number of unexpired records the store retains. Adapters
 * that hit this cap must reject new claims rather than evicting a live
 * record, so a high-volume installation cannot silently break the
 * idempotency guarantee for an in-flight key.
 */
export const TRANSACTIONAL_STORE_MAX_RECORDS = 10_000;

export type TransactionalSendStatus = "pending" | "accepted" | "failed" | "unknown";

/**
 * Persisted idempotency record for a single transactional send.
 *
 * Status semantics:
 *   pending   — claimed by a request, dispatch in progress
 *   accepted  — Listmonk returned a positive acknowledgement (`sent: true`)
 *   failed    — Listmonk returned a definitive negative acknowledgement
 *               (`sent: false`). Thrown dispatch errors are NOT recorded as
 *               `failed`; they release the claim so a retry can dispatch.
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

export type TransactionalClaimResult =
	| { kind: "new"; record: TransactionalSendRecord }
	| { kind: "replay"; record: TransactionalSendRecord }
	| { kind: "conflict"; existing: TransactionalSendRecord };

/**
 * Persistence boundary for the transactional idempotency wrapper.
 *
 * Implementations MUST be atomic read-modify-write over the full document
 * (typically via an exclusive lock) so concurrent claims for different keys
 * cannot lose records, and so a stale post-TTL commit cannot complete into
 * a replacement record. The operations package depends only on this
 * interface; the file-backed implementation lives in a Node-compatible
 * package and is injected by the CLI/MCP adapters.
 */
export interface TransactionalIdempotencyStore {
	/**
	 * Atomically claim (or replay) an idempotency slot. Implementations
	 * should also sweep expired records on each locked update, and reject
	 * new claims once `TRANSACTIONAL_STORE_MAX_RECORDS` unexpired records
	 * are retained.
	 */
	claim(options: {
		key: string;
		payloadHash: string;
		targetHash: string;
		ttlMs?: number;
		now?: () => Date;
	}): Promise<TransactionalClaimResult>;

	/**
	 * Transition a claimed record to a terminal state. `claimToken` binds
	 * the commit to the originating claim; a mismatched token is a no-op.
	 *
	 * `status: "unknown"` is reserved for ambiguous transport failures.
	 * Definitive thrown errors MUST NOT be committed as `failed`; the
	 * adapter calls `release` instead so a retry can dispatch.
	 */
	commit(options: {
		key: string;
		claimToken: string;
		status: "accepted" | "failed" | "unknown";
		sent?: boolean;
		errorMessage?: string;
		now?: () => Date;
	}): Promise<void>;

	/**
	 * Release (delete) a claim whose dispatch threw a definitive error —
	 * the request never reached Listmonk or was rejected before delivery,
	 * so a retry must be allowed to dispatch again. `claimToken` binds the
	 * release to the originating claim; a mismatched token is a no-op.
	 */
	release(options: {
		key: string;
		claimToken: string;
		now?: () => Date;
	}): Promise<void>;

	/** Read the full document (for diagnostics/validation). */
	load(): Promise<StoredTransactionalDocument>;
}

/**
 * Raised when an idempotent transactional send cannot be safely retried
 * automatically (record in `pending`/`unknown` state, or a target
 * mismatch). Surfaces enough context for an operator to reconcile.
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

const TRANSACTIONAL_STATUSES = new Set<TransactionalSendStatus>([
	"pending",
	"accepted",
	"failed",
	"unknown",
]);

/**
 * Status-discriminated invariant check used by both write and read paths.
 * `accepted` requires a positive acknowledgement (`sent: true`); a manually
 * reconciled or malformed record that claims `accepted` without it must
 * fail closed.
 */
export function isValidTransactionalSendRecord(
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
	// Status-discriminated invariants: accepted ⇒ sent:true, failed ⇒
	// sent !== true. Mirrors the file-backed validator so manually
	// reconciled or malformed state fails closed at every boundary.
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

/**
 * Validate a raw document into the schema-versioned shape. Adapters call
 * this at the persistence boundary so corrupt state is rejected before it
 * reaches domain code. The operations package keeps this pure (no file I/O)
 * to stay runtime-neutral.
 */
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
		if (!isValidTransactionalSendRecord(record)) {
			throw new Error(
				`Invalid transactional store: record '${key}' failed schema validation`,
			);
		}
		const typed = record as TransactionalSendRecord;
		if (typed.key !== key) {
			throw new Error(
				`Invalid transactional store: record key '${typed.key}' does not match map key '${key}'`,
			);
		}
	}
	return {
		version: 1,
		records: value.records as Record<string, TransactionalSendRecord>,
	};
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
 * Derive a stable hash for the Listmonk target (API base URL + auth identity).
 * Including this in both the record and the payload hash prevents a key reused
 * across staging and production from replaying the wrong instance's result.
 *
 * Both inputs are optional: when unset the hash degrades to a constant so
 * single-instance deployments keep working. Adapters must pass the resolved
 * baseUrl + username so cross-instance isolation actually takes effect.
 *
 * Pure (no `node:crypto`) so the operations package stays runtime-neutral.
 */
export function computeTransactionalTargetHash(options: {
	baseUrl?: string;
	username?: string;
}): string {
	const normalized = `${(options.baseUrl ?? "").trim()}\u0000${(options.username ?? "").trim()}`;
	// Two independent FNV-1a 32-bit passes (different seeds) combined into
	// a 64-bit hex string. A single 32-bit pass was trivially collidable;
	// 64 bits raises the cost of a deliberate cross-instance collision
	// (staging vs production replay) far above practical reach. Stays
	// pure-JavaScript so the operations package remains runtime-neutral;
	// the SHA-256 payload hash computed by the adapter carries the strong
	// guarantee for payload equality.
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

/**
 * Canonical serialized form of the send payload, ready for the adapter to
 * hash with whatever primitive its runtime provides. The operations package
 * stays runtime-neutral by not depending on `node:crypto`.
 */
export function serializeTransactionalPayload(input: {
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
	return stableSerializeJson(normalized);
}

/**
 * Deterministic JSON serialization that mirrors the transport's semantics:
 * keys sorted at every depth, arrays kept in original order (array order is
 * semantically meaningful for headers), `undefined` normalized to `null`,
 * and `Date` instances serialized as ISO strings — matching what
 * `JSON.stringify` would actually send on the wire.
 *
 * Pure (no node: imports) so the operations package stays runtime-neutral.
 * A `WeakSet` visited-guard rejects cyclic structures before they overflow
 * the stack.
 */

/**
 * Apply toJSON() at the object-property level. JSON.stringify calls
 * toJSON(key) — passing the property name as the argument — and, if the
 * result is undefined, omits the property entirely (rather than
 * serializing null). Returning undefined here lets the caller's filter
 * drop the property, preserving the wire payload's shape.
 *
 * The key is forwarded so a value whose toJSON depends on its property
 * name (rare but valid) hashes the same way JSON.stringify serializes it.
 */
function resolvePropertyValue(value: unknown, key: string): unknown {
	if (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		!(value instanceof Date) &&
		!(value instanceof Number) &&
		!(value instanceof Boolean) &&
		!(value instanceof String)
	) {
		const toJSON = (value as { toJSON?: unknown }).toJSON;
		if (typeof toJSON === "function") {
			return (value as { toJSON: (key: string) => unknown }).toJSON(key);
		}
	}
	return value;
}

export function stableSerializeJson(
	value: unknown,
	seen: WeakSet<object> = new WeakSet(),
): string {
	if (value === undefined) return "null";
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null
	) {
		return JSON.stringify(value);
	}
	if (value instanceof Date) {
		// JSON.stringify serializes an invalid Date (NaN time) as null.
		// value.toISOString() would throw RangeError on such a date,
		// rejecting a payload the ordinary send path accepts.
		const time = value.getTime();
		return Number.isNaN(time) ? "null" : JSON.stringify(value.toISOString());
	}
	if (Array.isArray(value)) {
		// Honor a custom toJSON on the array itself before iterating
		// elements: JSON.stringify calls array.toJSON() when present,
		// replacing the whole array with the result.
		const arrayToJSON = (value as unknown as { toJSON?: unknown }).toJSON;
		if (typeof arrayToJSON === "function") {
			const replaced = (arrayToJSON as () => unknown)();
			return stableSerializeJson(replaced, seen);
		}
		if (seen.has(value)) {
			throw new Error("Circular reference detected in transactional payload");
		}
		seen.add(value);
		// Iterate by index, not Array.prototype.map, so sparse-array holes
		// are serialized as null — matching what JSON.stringify (and thus
		// the wire transport) produces. `map` skips holes, which would
		// hash `new Array(1)` like `[]` while the body sends `[null]`.
		// Array indices are forwarded to toJSON as strings ("0", "1", …)
		// to match JSON.stringify's behavior for array elements.
		const parts: string[] = [];
		for (let i = 0; i < value.length; i++) {
			const entry = i in value ? value[i] : undefined;
			const resolved = resolvePropertyValue(entry, String(i));
			parts.push(stableSerializeJson(resolved, seen));
		}
		const result = `[${parts.join(",")}]`;
		seen.delete(value);
		return result;
	}
	if (typeof value === "object" && value !== null && !Array.isArray(value)) {
		// Boxed primitives (new Number(1), new Boolean(false), new String("x"))
		// are objects but JSON.stringify unboxes them. Handle them the same
		// way before falling into the generic object-enumeration path, which
		// would otherwise hash every boxed Number as "{}".
		if (value instanceof Number) {
			return stableSerializeJson(value.valueOf(), seen);
		}
		if (value instanceof Boolean) {
			return stableSerializeJson(value.valueOf(), seen);
		}
		if (value instanceof String) {
			return stableSerializeJson(value.valueOf(), seen);
		}
		if (seen.has(value)) {
			throw new Error("Circular reference detected in transactional payload");
		}
		seen.add(value);
		// Honor toJSON before enumerating properties: JSON.stringify calls
		// toJSON() when present (e.g. URL → string, Date is handled above),
		// so hashing must agree or two distinct wire payloads (different
		// URLs, both enumerable-empty) would collide.
		const toJSONResult = (value as { toJSON?: unknown }).toJSON;
		if (typeof toJSONResult === "function") {
			const replaced = (value as { toJSON: () => unknown }).toJSON();
			const result = stableSerializeJson(replaced, seen);
			seen.delete(value);
			return result;
		}
		const entries = Object.entries(value)
			// Mirror JSON.stringify: omit function/symbol-valued properties
			// entirely (not null), so { cb: () => {} } and {} hash alike.
			// Also apply toJSON() at the property level: if a value's toJSON
			// returns undefined, JSON.stringify omits the property (rather
			// than serializing null), so we must too or the hash diverges.
			.map(([k, v]) => [k, resolvePropertyValue(v, k)] as const)
			.filter(
				([, v]) =>
					v !== undefined &&
					typeof v !== "function" &&
					typeof v !== "symbol",
			)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		const result = `{${entries
			.map(
				([k, v]) => `${JSON.stringify(k)}:${stableSerializeJson(v, seen)}`,
			)
			.join(",")}}`;
		seen.delete(value);
		return result;
	}
	// Functions and symbols serialize as undefined under JSON.stringify.
	// The transport coerces them to null inside arrays (so [() => {}] and
	// [null] hash alike) but omits them as object properties (handled above).
	if (typeof value === "function" || typeof value === "symbol") {
		return "null";
	}
	// Bigints are serialized as decimal strings by the OpenAPI client's
	// jsonBodySerializer (not null), so distinct bigints must hash distinctly.
	if (typeof value === "bigint") {
		return JSON.stringify(value.toString());
	}
	const fallback = JSON.stringify(value);
	return fallback === undefined ? "null" : fallback;
}

/**
 * Heuristic: does this dispatch failure look like an ambiguous transport
 * outcome (timeout, connection reset, socket hang)? Such outcomes must be
 * recorded as `unknown` rather than `failed`, because Listmonk may still
 * have delivered the message and an automatic retry would duplicate it.
 *
 * Kept specific on purpose. Direct `ECONNREFUSED` (nothing is listening)
 * and `ENOTFOUND` (DNS failure) are definitive: the request never reached
 * Listmonk, so a retry is safe.
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

/**
 * Heuristic: does this dispatch failure prove the request never reached
 * Listmonk? Only such pre-dispatch failures are safe to release (so a
 * retry can dispatch again). Anything else — including response parse
 * errors, application exceptions, or unrecognized transport failures —
 * must stay as `unknown` because Listmonk may have processed the message
 * before the error surfaced.
 *
 * Kept deliberately narrow. Node/undici surface these as `ECONNREFUSED`
 * (nothing listening) and `ENOTFOUND` (DNS failure), typically inside
 * `error.message` and/or `error.code`/`error.cause.code`. Bun's fetch
 * reports the same outcomes as `error.code === "ConnectionRefused"` /
 * `"ConnectionRefused"` and `"GetAddrInfoFailed"` / `"HostNotFoundError"`
 * in `error.code` (not in `error.message`), so a message-only check would
 * miss them and wrongly classify a definitive outage as `unknown`,
 * blocking the key for the full TTL.
 *
 * `fetch failed` is intentionally NOT included here because undici wraps
 * both pre- and post-connection failures under that message.
 */
export function isDefinitivePreDispatchError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	// When the error carries an HTTP status, that status is authoritative:
	// the request reached Listmonk (or a proxy) and was answered. 4xx is a
	// definitive pre-dispatch rejection (safe to release); anything else
	// with a status (5xx, 3xx, etc.) is NOT pre-dispatch because the server
	// may have partially processed the message. This check runs BEFORE the
	// transport-message heuristics so a 5xx body that happens to contain
	// "ECONNREFUSED" cannot override the server's authoritative answer.
	const httpStatus = (error as { httpStatus?: unknown }).httpStatus;
	if (typeof httpStatus === "number") {
		return httpStatus >= 400 && httpStatus < 500;
	}
	const message = error.message.toLowerCase();
	const messageSignals = ["econnrefused", "enotfound"];
	if (messageSignals.some((signal) => message.includes(signal))) {
		return true;
	}
	// Structured codes: Node errno (ECONNREFUSED, ENOTFOUND) and Bun's
	// fetch error codes surface here rather than in the message.
	const codes = collectErrorCodes(error);
	const codeSignals = new Set([
		"ECONNREFUSED",
		"ENOTFOUND",
		// Bun fetch error codes (see bun-internal fetch errors).
		"ConnectionRefused",
		"GetAddrInfoFailed",
		"HostNotFoundError",
	]);
	return codes.some((code) => codeSignals.has(code));
}

function collectErrorCodes(error: Error): string[] {
	const codes: string[] = [];
	function pushCode(value: unknown): void {
		if (typeof value === "string" && value.length > 0) codes.push(value);
	}
	pushCode((error as { code?: unknown }).code);
	const cause = (error as { cause?: unknown }).cause;
	if (cause instanceof Error) {
		pushCode((cause as { code?: unknown }).code);
		// Some fetch implementations nest twice (TypeError → SystemError).
		const nestedCause = (cause as { cause?: unknown }).cause;
		if (nestedCause instanceof Error) {
			pushCode((nestedCause as { code?: unknown }).code);
		}
	}
	return codes;
}
