import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_RETRY_DELAY_MS = 25;
const LOCK_HOSTNAME = hostname();

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

async function unlinkIfExists(path: string): Promise<void> {
	try {
		await unlink(path);
	} catch (error) {
		if (!isErrnoException(error, "ENOENT")) {
			throw error;
		}
	}
}

async function createLockFile(
	lockPath: string,
	metadata: LockMetadata,
): Promise<boolean> {
	const temporaryPath = `${lockPath}.${metadata.token}.tmp`;
	let lockLinked = false;

	try {
		const temporaryHandle = await open(temporaryPath, "wx", 0o600);
		try {
			await temporaryHandle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
			await temporaryHandle.sync();
		} finally {
			await temporaryHandle.close();
		}

		try {
			await link(temporaryPath, lockPath);
			lockLinked = true;
			return true;
		} catch (error) {
			if (isErrnoException(error, "EEXIST")) {
				return false;
			}
			throw error;
		}
	} finally {
		try {
			await unlinkIfExists(temporaryPath);
		} catch (error) {
			if (lockLinked) {
				await unlinkIfExists(lockPath);
			}
			throw error;
		}
	}
}

async function removeAbandonedLock(lockPath: string): Promise<boolean> {
	const recoveryPath = `${lockPath}.recovery`;
	let recoveryHandle: Awaited<ReturnType<typeof open>>;
	try {
		recoveryHandle = await open(recoveryPath, "wx", 0o600);
	} catch (error) {
		if (isErrnoException(error, "EEXIST")) {
			return false;
		}
		throw error;
	}

	try {
		let metadata: LockMetadata | undefined;
		try {
			metadata = parseLockMetadata(await readFile(lockPath, "utf8"));
		} catch (error) {
			if (isErrnoException(error, "ENOENT")) {
				return true;
			}
			throw error;
		}

		if (
			!metadata ||
			metadata.hostname !== LOCK_HOSTNAME ||
			isProcessAlive(metadata.pid)
		) {
			return false;
		}

		const currentMetadata = parseLockMetadata(await readFile(lockPath, "utf8"));
		if (currentMetadata?.token !== metadata.token) {
			return false;
		}

		await unlink(lockPath);
		return true;
	} finally {
		try {
			await recoveryHandle.close();
		} finally {
			await unlinkIfExists(recoveryPath);
		}
	}
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
		const token = randomUUID();
		const metadata: LockMetadata = {
			token,
			pid: process.pid,
			hostname: LOCK_HOSTNAME,
			createdAt: new Date().toISOString(),
		};
		if (await createLockFile(lockPath, metadata)) {
			return { lockPath, token };
		}

		if (await removeAbandonedLock(lockPath)) {
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

async function withJsonFileLock<Result>(
	path: string,
	options: JsonFileLockOptions | undefined,
	action: () => Promise<Result>,
): Promise<Result> {
	const { lockPath, token } = await acquireLock(path, options);
	try {
		return await action();
	} finally {
		await releaseLock(lockPath, token);
	}
}

async function writeJsonFileAtomic(path: string, value: unknown): Promise<void> {
	const directory = dirname(path);
	const serializedValue = JSON.stringify(value, null, 2);
	if (serializedValue === undefined) {
		throw new TypeError("JSON store value must be serializable");
	}
	const temporaryPath = join(
		directory,
		`.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
	);
	let temporaryFileCreated = false;

	await mkdir(directory, { recursive: true });

	try {
		const temporaryHandle = await open(temporaryPath, "wx", 0o600);
		temporaryFileCreated = true;
		try {
			await temporaryHandle.writeFile(`${serializedValue}\n`, "utf8");
			await temporaryHandle.sync();
		} finally {
			await temporaryHandle.close();
		}

		await rename(temporaryPath, path);
		temporaryFileCreated = false;
	} finally {
		if (temporaryFileCreated) {
			await unlink(temporaryPath).catch((error: unknown) => {
				if (!isErrnoException(error, "ENOENT")) {
					throw error;
				}
			});
		}
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
	await withJsonFileLock(path, store.lock, async () => {
		await writeJsonFileAtomic(path, value);
	});
}

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
		await writeJsonFileAtomic(path, next.value);
		return next.result;
	});
}
