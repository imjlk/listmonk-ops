import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 25;
const LOCK_HOSTNAME = hostname();
const knownAbandonedLockTokens = new Map<string, string>();

export interface JsonFileLockOptions {
	timeoutMs?: number;
	retryDelayMs?: number;
}

export interface JsonFileStore<T> {
	path: string;
	createDefault: () => T;
	parse: (value: unknown) => T;
	lock?: JsonFileLockOptions;
	/**
	 * Opt-in: when an update returns the current document by reference, skip
	 * the serialize/rename/fsync cycle entirely. Only safe for stores whose
	 * mutating callbacks NEVER modify the current document in place — they
	 * must build and return a new document. Stores with in-place mutating
	 * callbacks (for example the template registry) must not enable this,
	 * because their unchanged reference would silently skip the write.
	 */
	skipUnchangedWrites?: boolean;
}

export interface JsonFileStoreUpdate<T, Result> {
	value: T;
	result: Result;
}

interface LockMetadata {
	token: string;
	pid: number;
	hostname: string;
	startedAt?: string;
	bootTicks?: number;
	createdAt: string;
}

function readLinuxStartTicks(pid: number): number | undefined {
	if (process.platform !== "linux") return undefined;
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const closing = stat.lastIndexOf(")");
		const fields = stat.slice(closing + 2).split(" ");
		// Field 22 overall; after "comm)" the remaining fields start at 3.
		const ticks = Number(fields[19]);
		return Number.isFinite(ticks) ? ticks : undefined;
	} catch {
		return undefined;
	}
}

/** Wall-clock estimate of this process's start, captured once. */
export const PROCESS_STARTED_AT = new Date(
	Math.round(Date.now() - performance.now()),
).toISOString();

/**
 * Boot-relative start of this process from /proc/<pid>/stat (clock ticks
 * since boot), captured once. Unlike the wall-clock estimate it is immune
 * to wall-clock steps (VM resume, NTP corrections), so Linux identity
 * comparisons never misjudge a live owner. Undefined elsewhere.
 */
export const PROCESS_BOOT_TICKS = readLinuxStartTicks(process.pid);

/** How far apart two process-start estimates may be and still match. */
const PROCESS_START_TOLERANCE_MS = 5_000;

/**
 * True when a recorded owner is this same live process. A recycled PID
 * (for example a container restarting into PID 1) is a different process.
 * On Linux the boot-relative /proc start ticks decide — clock-stable —
 * with the wall-clock estimate as the fallback on other platforms, where
 * unverifiable foreign PIDs are assumed alive. Shared by the store locks
 * and the resource-create claim records.
 */
export function isSameLiveProcess(owner: {
	pid: number;
	startedAt?: string;
	bootTicks?: number;
}): boolean {
	try {
		process.kill(owner.pid, 0);
	} catch (error) {
		if (isErrnoException(error, "ESRCH")) return false;
		// EPERM: the pid exists but belongs to another user, which can be a
		// reused pid. Keep checking the recorded start identity, which Linux
		// can still read from /proc; elsewhere the owner stays assumed alive.
		if (!isErrnoException(error, "EPERM")) return true;
	}
	if (owner.bootTicks !== undefined && process.platform === "linux") {
		const currentTicks = readLinuxStartTicks(owner.pid);
		if (currentTicks !== undefined) {
			return currentTicks === owner.bootTicks;
		}
	}
	if (owner.startedAt === undefined) {
		// Legacy lock/claim metadata without a start identity: fall back to
		// pid liveness alone.
		return true;
	}
	if (owner.pid === process.pid) {
		return timestampsMatch(owner.startedAt, PROCESS_STARTED_AT);
	}
	const procStartedAt = readLinuxProcessStart(owner.pid);
	if (procStartedAt !== undefined) {
		return timestampsMatch(owner.startedAt, procStartedAt);
	}
	return true;
}

function timestampsMatch(a: string, b: string): boolean {
	return (
		Math.abs(new Date(a).getTime() - new Date(b).getTime()) <=
		PROCESS_START_TOLERANCE_MS
	);
}

/**
 * Best-effort Linux-only start time for another process, from
 * /proc/<pid>/stat field 22 (clock ticks since boot) plus /proc/uptime.
 * Returns undefined anywhere else or when unreadable.
 */
function readLinuxProcessStart(pid: number): string | undefined {
	if (process.platform !== "linux") return undefined;
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const closing = stat.lastIndexOf(")");
		const fields = stat.slice(closing + 2).split(" ");
		// Field 22 overall; after "comm)" the remaining fields start at 3.
		const starttimeTicks = Number(fields[19]);
		const uptimeSeconds = Number(
			readFileSync("/proc/uptime", "utf8").split(" ")[0],
		);
		if (!Number.isFinite(starttimeTicks) || !Number.isFinite(uptimeSeconds)) {
			return undefined;
		}
		const startedSecondsAgo = uptimeSeconds - starttimeTicks / 100; /* USER_HZ */
		return new Date(Math.round(Date.now() - startedSecondsAgo * 1000)).toISOString();
	} catch {
		return undefined;
	}
}

/**
 * What a lock file showed when a wait timed out. Deliberately omits the
 * lock token and process start identity; only operator-useful facts remain.
 */
export type JsonFileLockHolder =
	| { status: "held"; pid: number; hostname: string; createdAt: string }
	| { status: "unreadable" }
	| { status: "absent" };

export interface JsonFileLockTimeoutDiagnostics {
	lockPath?: string;
	/** The store lock's recorded owner at the time of the timeout. */
	holder?: JsonFileLockHolder;
	/** A lock-recovery marker that blocks automatic recovery, if present. */
	recoveryMarker?: JsonFileLockHolder;
	/** Reference time for the reported lock age. Defaults to now. */
	now?: Date;
}

const MAX_REPORTED_HOSTNAME_LENGTH = 255;

function quoteHostname(value: string): string {
	return JSON.stringify(value.slice(0, MAX_REPORTED_HOSTNAME_LENGTH));
}

function formatLockAge(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h ${minutes % 60}m`;
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function describeLockOwner(
	holder: Extract<JsonFileLockHolder, { status: "held" }>,
	now: Date,
): string {
	const host =
		holder.hostname === LOCK_HOSTNAME
			? `this host (${quoteHostname(holder.hostname)})`
			: `host ${quoteHostname(holder.hostname)}`;
	const createdAt = Date.parse(holder.createdAt);
	if (Number.isNaN(createdAt)) return `pid ${holder.pid} on ${host}`;
	const age = now.getTime() - createdAt;
	return `pid ${holder.pid} on ${host} since ${new Date(createdAt).toISOString()}${
		age >= 0 ? ` (${formatLockAge(age)} ago)` : ""
	}`;
}

function describeLockTimeout(
	path: string,
	timeoutMs: number,
	lockPath: string,
	diagnostics: JsonFileLockTimeoutDiagnostics,
): string {
	const sentences = [
		`Timed out after ${timeoutMs}ms waiting for JSON store lock: ${path}.`,
	];
	const holder = diagnostics.holder;
	if (holder === undefined) {
		sentences.push(
			`If the process holding ${lockPath} is gone, delete that lock file and retry.`,
		);
	} else if (holder.status === "absent") {
		sentences.push(
			`Lock file ${lockPath} was released as the wait ended; retry the operation.`,
		);
	} else if (holder.status === "unreadable") {
		sentences.push(
			`Lock file ${lockPath} has no readable owner metadata. If no listmonk-ops process is using this store, delete ${lockPath} and retry.`,
		);
	} else {
		sentences.push(
			`Lock file ${lockPath} is held by ${describeLockOwner(holder, diagnostics.now ?? new Date())}.`,
		);
		if (holder.hostname !== LOCK_HOSTNAME) {
			sentences.push(
				`This process runs on host ${quoteHostname(LOCK_HOSTNAME)} and cannot check a process on another host, so that lock is never recovered automatically (for example after a container is recreated or the hostname changes).`,
			);
		}
		sentences.push(`If that process is gone, delete ${lockPath} and retry.`);
	}
	const marker = diagnostics.recoveryMarker;
	if (marker !== undefined && marker.status !== "absent") {
		const recoveryPath = `${lockPath}.recovery`;
		sentences.push(
			marker.status === "held"
				? `Lock-recovery marker ${recoveryPath} (${describeLockOwner(marker, diagnostics.now ?? new Date())}) also blocks automatic recovery; delete it as well if that process is gone.`
				: `Lock-recovery marker ${recoveryPath} has no readable owner metadata and blocks automatic recovery; delete it as well if no listmonk-ops process is recovering this lock.`,
		);
	}
	return sentences.join(" ");
}

export class JsonFileLockTimeoutError extends Error {
	readonly storePath: string;
	readonly lockPath: string;
	readonly timeoutMs: number;
	readonly holder?: JsonFileLockHolder;
	readonly recoveryMarker?: JsonFileLockHolder;

	constructor(
		path: string,
		timeoutMs: number,
		diagnostics: JsonFileLockTimeoutDiagnostics = {},
	) {
		const lockPath = diagnostics.lockPath ?? `${path}.lock`;
		super(describeLockTimeout(path, timeoutMs, lockPath, diagnostics));
		this.name = "JsonFileLockTimeoutError";
		this.storePath = path;
		this.lockPath = lockPath;
		this.timeoutMs = timeoutMs;
		this.holder = diagnostics.holder;
		this.recoveryMarker = diagnostics.recoveryMarker;
	}
}

export function commitJsonFileStoreUpdate<T, Result>(
	value: T,
	result: Result,
): JsonFileStoreUpdate<T, Result> {
	return { value, result };
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

function parseLockMetadata(value: string): LockMetadata | undefined {
	try {
		const parsed = JSON.parse(value) as Partial<LockMetadata>;
		if (
			typeof parsed.token !== "string" ||
			typeof parsed.pid !== "number" ||
			!Number.isInteger(parsed.pid) ||
			parsed.pid <= 0 ||
			typeof parsed.hostname !== "string" ||
			typeof parsed.createdAt !== "string"
		) {
			return undefined;
		}
		if (
			(parsed.startedAt !== undefined && typeof parsed.startedAt !== "string") ||
			(parsed.bootTicks !== undefined &&
				(typeof parsed.bootTicks !== "number" || !Number.isFinite(
					parsed.bootTicks,
				)))
		) {
			return undefined;
		}

		return parsed as LockMetadata;
	} catch {
		return undefined;
	}
}

function createLockMetadata(token = randomUUID()): LockMetadata {
	return {
		token,
		pid: process.pid,
		hostname: LOCK_HOSTNAME,
		startedAt: PROCESS_STARTED_AT,
		bootTicks: PROCESS_BOOT_TICKS,
		createdAt: new Date().toISOString(),
	};
}

async function unlinkIfExists(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (!isErrnoException(error, "ENOENT")) {
			throw error;
		}
	}
}

async function writeAndCloseFile(
	handle: Awaited<ReturnType<typeof open>>,
	action: () => Promise<void>,
): Promise<void> {
	let actionFailed = false;
	let actionError: unknown;
	try {
		await action();
	} catch (error) {
		actionFailed = true;
		actionError = error;
	}

	let closeFailed = false;
	let closeError: unknown;
	try {
		await handle.close();
	} catch (error) {
		closeFailed = true;
		closeError = error;
	}

	if (actionFailed) {
		if (closeFailed) {
			console.warn(
				"Failed to close file handle after action failure",
				closeError,
			);
		}
		throw actionError;
	}
	if (closeFailed) {
		throw closeError;
	}
}

async function createLockFile(
	lockPath: string,
	metadata: LockMetadata,
): Promise<boolean> {
	const temporaryPath = `${lockPath}.${metadata.token}.tmp`;
	let lockCreated = false;
	let operationFailed = false;
	let operationError: unknown;
	try {
		const temporaryHandle = await open(temporaryPath, "wx", 0o600);
		await writeAndCloseFile(temporaryHandle, async () => {
			await temporaryHandle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
			await temporaryHandle.sync();
		});

		try {
			await link(temporaryPath, lockPath);
			lockCreated = true;
		} catch (error) {
			if (!isErrnoException(error, "EEXIST")) {
				throw error;
			}
		}
	} catch (error) {
		operationFailed = true;
		operationError = error;
	}

	let cleanupFailed = false;
	let cleanupError: unknown;
	try {
		await unlinkIfExists(temporaryPath);
	} catch (error) {
		cleanupFailed = true;
		cleanupError = error;
	}

	if (operationFailed) {
		if (cleanupFailed) {
			console.warn(
				`Failed to clean temporary lock file ${temporaryPath}`,
				cleanupError,
			);
		}
		throw operationError;
	}
	if (cleanupFailed) {
		if (lockCreated) {
			// The hard link is already a complete lock. Keep ownership instead of
			// risking a self-deadlock if rolling the lock back also fails.
			console.warn(
				`Failed to clean temporary lock file ${temporaryPath}`,
				cleanupError,
			);
			knownAbandonedLockTokens.delete(lockPath);
			return true;
		}
		throw cleanupError;
	}
	if (lockCreated) {
		knownAbandonedLockTokens.delete(lockPath);
	}
	return lockCreated;
}

async function removeDeadOwnerFile(path: string): Promise<boolean> {
	let metadata: LockMetadata | undefined;
	try {
		metadata = parseLockMetadata(await readFile(path, "utf8"));
	} catch (error) {
		if (isErrnoException(error, "ENOENT")) {
			return true;
		}
		throw error;
	}

	if (!metadata || metadata.hostname !== LOCK_HOSTNAME) {
		return false;
	}

	const knownAbandonedToken = knownAbandonedLockTokens.get(path);
	const isKnownAbandoned = knownAbandonedToken === metadata.token;
	// A live pid is not enough: a killed container can restart into the
	// same pid, so verify the recorded process actually is still running.
	if (!isKnownAbandoned && isSameLiveProcess(metadata)) {
		return false;
	}

	let currentMetadata: LockMetadata | undefined;
	try {
		currentMetadata = parseLockMetadata(await readFile(path, "utf8"));
	} catch (error) {
		if (isErrnoException(error, "ENOENT")) {
			return true;
		}
		throw error;
	}
	if (currentMetadata?.token !== metadata.token) {
		if (isKnownAbandoned) {
			knownAbandonedLockTokens.delete(path);
		}
		return false;
	}

	try {
		await unlink(path);
	} catch (error) {
		if (!isErrnoException(error, "ENOENT")) {
			throw error;
		}
	}
	if (isKnownAbandoned) {
		knownAbandonedLockTokens.delete(path);
	}
	return true;
}

async function removeAbandonedLock(lockPath: string): Promise<boolean> {
	const recoveryPath = `${lockPath}.recovery`;
	const recoveryMetadata = createLockMetadata();
	if (!(await createLockFile(recoveryPath, recoveryMetadata))) {
		// A recovery owner can crash too. Remove only a same-host sentinel whose
		// PID is confirmed dead; live and foreign-host recoveries remain intact.
		await removeDeadOwnerFile(recoveryPath);
		return false;
	}

	return runWithOwnedLock(recoveryPath, recoveryMetadata.token, () =>
		removeDeadOwnerFile(lockPath),
	);
}

/** Best-effort read of a lock file's owner for diagnostics; never throws. */
async function inspectLockHolder(path: string): Promise<JsonFileLockHolder> {
	let metadata: LockMetadata | undefined;
	try {
		metadata = parseLockMetadata(await readFile(path, "utf8"));
	} catch (error) {
		return isErrnoException(error, "ENOENT")
			? { status: "absent" }
			: { status: "unreadable" };
	}
	return metadata === undefined
		? { status: "unreadable" }
		: {
				status: "held",
				pid: metadata.pid,
				hostname: metadata.hostname,
				createdAt: metadata.createdAt,
			};
}

async function createLockTimeoutError(
	path: string,
	lockPath: string,
	timeoutMs: number,
): Promise<JsonFileLockTimeoutError> {
	const [holder, recoveryMarker] = await Promise.all([
		inspectLockHolder(lockPath),
		inspectLockHolder(`${lockPath}.recovery`),
	]);
	return new JsonFileLockTimeoutError(path, timeoutMs, {
		lockPath,
		holder,
		...(recoveryMarker.status === "absent" ? {} : { recoveryMarker }),
	});
}

async function acquireLock(
	path: string,
	options: JsonFileLockOptions = {},
): Promise<{ lockPath: string; token: string }> {
	const timeoutMs = Math.max(0, options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS);
	const retryDelayMs = Math.max(
		1,
		options.retryDelayMs ?? DEFAULT_LOCK_RETRY_DELAY_MS,
	);
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + timeoutMs;

	await mkdir(dirname(path), { recursive: true });

	while (true) {
		const metadata = createLockMetadata();
		if (await createLockFile(lockPath, metadata)) {
			return { lockPath, token: metadata.token };
		}

		if (await removeAbandonedLock(lockPath)) {
			if (Date.now() >= deadline) {
				throw await createLockTimeoutError(path, lockPath, timeoutMs);
			}
			continue;
		}

		if (Date.now() >= deadline) {
			throw await createLockTimeoutError(path, lockPath, timeoutMs);
		}

		await delay(Math.min(retryDelayMs, Math.max(1, deadline - Date.now())));
	}
}

async function releaseLock(lockPath: string, token: string): Promise<void> {
	let metadata: LockMetadata | undefined;
	try {
		metadata = parseLockMetadata(await readFile(lockPath, "utf8"));
	} catch (error) {
		if (isErrnoException(error, "ENOENT")) {
			return;
		}
		throw error;
	}

	if (metadata?.token !== token) {
		return;
	}

	try {
		await unlink(lockPath);
	} catch (error) {
		if (!isErrnoException(error, "ENOENT")) {
			throw error;
		}
	}
}

async function runWithOwnedLock<Result>(
	lockPath: string,
	token: string,
	action: () => Promise<Result>,
): Promise<Result> {
	let outcome:
		| { completed: true; result: Result }
		| { completed: false; error: unknown };
	try {
		outcome = { completed: true, result: await action() };
	} catch (error) {
		outcome = { completed: false, error };
	}

	let releaseFailed = false;
	let releaseError: unknown;
	try {
		await releaseLock(lockPath, token);
		if (knownAbandonedLockTokens.get(lockPath) === token) {
			knownAbandonedLockTokens.delete(lockPath);
		}
	} catch (error) {
		releaseFailed = true;
		releaseError = error;
		knownAbandonedLockTokens.set(lockPath, token);
	}

	if (!outcome.completed) {
		if (releaseFailed) {
			console.warn(
				`Failed to release lock ${lockPath} after action failure`,
				releaseError,
			);
		}
		throw outcome.error;
	}
	if (releaseFailed) {
		throw releaseError;
	}
	return outcome.result;
}

async function withJsonFileLock<Result>(
	path: string,
	options: JsonFileLockOptions | undefined,
	action: () => Promise<Result>,
): Promise<Result> {
	const { lockPath, token } = await acquireLock(path, options);
	return runWithOwnedLock(lockPath, token, action);
}

function serializeJsonFileStoreValue<T>(
	store: JsonFileStore<T>,
	value: T,
): string {
	let serializedValue: string | undefined;
	try {
		serializedValue = JSON.stringify(value, null, 2);
	} catch (error) {
		throw new TypeError("JSON store value must be serializable", {
			cause: error,
		});
	}
	if (serializedValue === undefined) {
		throw new TypeError("JSON store value must be serializable");
	}

	// Validate the persisted JSON representation. A parser may intentionally
	// hydrate JSON strings into richer in-memory values such as Date objects.
	try {
		store.parse(JSON.parse(serializedValue));
	} catch (error) {
		const causeMessage = error instanceof Error ? error.message : String(error);
		throw new TypeError(
			`JSON store value failed schema validation: ${causeMessage}`,
			{ cause: error },
		);
	}
	return serializedValue;
}

async function writeJsonFileAtomic(
	path: string,
	serializedValue: string,
): Promise<void> {
	const directory = dirname(path);
	const temporaryPath = join(
		directory,
		`.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
	);
	let temporaryFileCreated = false;
	let operationFailed = false;
	let operationError: unknown;

	await mkdir(directory, { recursive: true });

	try {
		const temporaryHandle = await open(temporaryPath, "wx", 0o600);
		temporaryFileCreated = true;
		await writeAndCloseFile(temporaryHandle, async () => {
			await temporaryHandle.writeFile(`${serializedValue}\n`, "utf8");
			await temporaryHandle.sync();
		});

		await rename(temporaryPath, path);
		temporaryFileCreated = false;
	} catch (error) {
		operationFailed = true;
		operationError = error;
	}

	let cleanupError: unknown;
	if (temporaryFileCreated) {
		try {
			await unlinkIfExists(temporaryPath);
		} catch (error) {
			cleanupError = error;
		}
	}

	if (operationFailed) {
		if (cleanupError !== undefined) {
			console.warn(
				`Failed to clean temporary JSON store file ${temporaryPath}`,
				cleanupError,
			);
		}
		throw operationError;
	}
	if (cleanupError !== undefined) {
		throw cleanupError;
	}
}

/**
 * A persisted store exists but could not be read, parsed as JSON, or
 * validated. The message and `path` name the file; the original error is the
 * `cause`.
 */
export class JsonFileStoreReadError extends Error {
	readonly path: string;

	constructor(message: string, path: string, cause: unknown) {
		super(message, { cause });
		this.name = "JsonFileStoreReadError";
		this.path = path;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export async function readJsonFileStore<T>(
	store: JsonFileStore<T>,
): Promise<T> {
	const path = resolve(store.path);
	let raw: string;
	try {
		raw = await readFile(path, "utf8");
	} catch (error) {
		if (isErrnoException(error, "ENOENT")) {
			return store.createDefault();
		}
		throw new JsonFileStoreReadError(
			`Unable to read JSON store ${path}: ${errorMessage(error)}`,
			path,
			error,
		);
	}
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch (error) {
		throw new JsonFileStoreReadError(
			`JSON store ${path} is not valid JSON: ${errorMessage(error)}`,
			path,
			error,
		);
	}
	try {
		return store.parse(value);
	} catch (error) {
		throw new JsonFileStoreReadError(
			`JSON store ${path} failed validation: ${errorMessage(error)}`,
			path,
			error,
		);
	}
}

export async function writeJsonFileStore<T>(
	store: JsonFileStore<T>,
	value: T,
): Promise<void> {
	const path = resolve(store.path);
	const serializedValue = serializeJsonFileStoreValue(store, value);
	await withJsonFileLock(path, store.lock, async () => {
		await writeJsonFileAtomic(path, serializedValue);
	});
}

/**
 * Runs a read/modify/write callback while holding the store's exclusive lock.
 * Keep callback work bounded. If it performs remote side effects, callers must
 * surface reconciliation guidance because a later local write or lock-release
 * failure cannot automatically roll the remote action back. For stores that
 * opt into `skipUnchangedWrites` and never mutate the current document in
 * place, an update returning the current value by reference skips the write
 * entirely, so read-only outcomes under the lock cost no fsync or rename.
 */
export async function updateJsonFileStore<T, Result>(
	store: JsonFileStore<T>,
	update: (
		value: T,
	) => Promise<JsonFileStoreUpdate<T, Result>> | JsonFileStoreUpdate<T, Result>,
): Promise<Result> {
	const path = resolve(store.path);
	return withJsonFileLock(path, store.lock, async () => {
		const currentValue = await readJsonFileStore({ ...store, path });
		const next = await update(currentValue);
		if (next.value !== currentValue || !store.skipUnchangedWrites) {
			const serializedValue = serializeJsonFileStoreValue(store, next.value);
			await writeJsonFileAtomic(path, serializedValue);
		}
		return next.result;
	});
}
