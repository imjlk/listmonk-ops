import { randomUUID } from "node:crypto";
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
}

export interface JsonFileStoreUpdate<T, Result> {
	value: T;
	result: Result;
}

interface LockMetadata {
	token: string;
	pid: number;
	hostname: string;
	createdAt: string;
}

export class JsonFileLockTimeoutError extends Error {
	constructor(path: string, timeoutMs: number) {
		super(
			`Timed out after ${timeoutMs}ms waiting for JSON store lock: ${path}`,
		);
		this.name = "JsonFileLockTimeoutError";
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

		return parsed as LockMetadata;
	} catch {
		return undefined;
	}
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return !isErrnoException(error, "ESRCH");
	}
}

function createLockMetadata(token = randomUUID()): LockMetadata {
	return {
		token,
		pid: process.pid,
		hostname: LOCK_HOSTNAME,
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
	if (!isKnownAbandoned && isProcessAlive(metadata.pid)) {
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
				throw new JsonFileLockTimeoutError(path, timeoutMs);
			}
			continue;
		}

		if (Date.now() >= deadline) {
			throw new JsonFileLockTimeoutError(path, timeoutMs);
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

export async function readJsonFileStore<T>(
	store: JsonFileStore<T>,
): Promise<T> {
	try {
		const raw = await readFile(resolve(store.path), "utf8");
		return store.parse(JSON.parse(raw));
	} catch (error) {
		if (isErrnoException(error, "ENOENT")) {
			return store.createDefault();
		}
		throw error;
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
 * failure cannot automatically roll the remote action back.
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
		const serializedValue = serializeJsonFileStoreValue(store, next.value);
		await writeJsonFileAtomic(path, serializedValue);
		return next.result;
	});
}
