import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	commitJsonFileStoreUpdate,
	JsonFileLockTimeoutError,
	JsonFileStoreReadError,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
	writeJsonFileStore,
} from "../src/json-file-store";

interface CounterStore {
	version: 1;
	count: number;
}

const temporaryDirectories: string[] = [];

function parseCounterStore(value: unknown): CounterStore {
	if (
		typeof value !== "object" ||
		value === null ||
		!("version" in value) ||
		value.version !== 1 ||
		!("count" in value) ||
		typeof value.count !== "number"
	) {
		throw new Error("Invalid counter store");
	}

	return value as CounterStore;
}

function createLockMetadata(pid: number, token: string) {
	return {
		token,
		pid,
		hostname: hostname(),
		createdAt: new Date().toISOString(),
	};
}

async function captureLockTimeout(
	store: JsonFileStore<CounterStore>,
): Promise<JsonFileLockTimeoutError> {
	try {
		await writeJsonFileStore(store, { version: 1, count: 1 });
	} catch (error) {
		if (error instanceof JsonFileLockTimeoutError) return error;
		throw error;
	}
	throw new Error("expected the lock wait to time out");
}

async function exitedProcessPid(): Promise<number> {
	const owner = Bun.spawn([process.execPath, "-e", "process.exit(0)"]);
	await owner.exited;
	return owner.pid;
}

/** Boot-relative start ticks of a Linux process, as the store records them. */
function linuxStartTicks(pid: number): number | undefined {
	if (process.platform !== "linux") return undefined;
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		const ticks = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19]);
		return Number.isFinite(ticks) ? ticks : undefined;
	} catch {
		return undefined;
	}
}

/** PID 1 belongs to init, owned by root: kill(1, 0) fails with EPERM for other users. */
const initStartTicks = linuxStartTicks(1);

async function createCounterStore(): Promise<JsonFileStore<CounterStore>> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-common-"));
	temporaryDirectories.push(directory);

	return {
		path: join(directory, "counter.json"),
		createDefault: () => ({ version: 1, count: 0 }),
		parse: parseCounterStore,
		lock: {
			timeoutMs: 5_000,
			retryDelayMs: 1,
		},
	};
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("JSON file store", () => {
	test("returns a fresh schema-versioned default for a missing file", async () => {
		const store = await createCounterStore();

		const first = await readJsonFileStore(store);
		first.count = 99;
		const second = await readJsonFileStore(store);

		expect(second).toEqual({ version: 1, count: 0 });
	});

	test("rejects an unsupported persisted schema", async () => {
		const store = await createCounterStore();
		await writeFile(store.path, '{"version":2,"count":1}\n', "utf8");

		await expect(readJsonFileStore(store)).rejects.toThrow(
			"Invalid counter store",
		);
	});

	test("names the store file in read, JSON, and validation errors", async () => {
		const store = await createCounterStore();
		const capture = async (): Promise<JsonFileStoreReadError> => {
			try {
				await readJsonFileStore(store);
			} catch (error) {
				if (error instanceof JsonFileStoreReadError) return error;
				throw error;
			}
			throw new Error("expected the store read to fail");
		};

		await writeFile(store.path, '{"version":1,"count":', "utf8");
		const corrupt = await capture();
		expect(corrupt.path).toBe(store.path);
		expect(corrupt.message).toStartWith(
			`JSON store ${store.path} is not valid JSON: `,
		);
		expect(corrupt.cause).toBeInstanceOf(SyntaxError);
		// A write under the lock surfaces the same error and keeps the file.
		await expect(
			updateJsonFileStore(store, (current) =>
				commitJsonFileStoreUpdate(current, undefined),
			),
		).rejects.toThrow(`JSON store ${store.path} is not valid JSON`);
		expect(await readFile(store.path, "utf8")).toBe('{"version":1,"count":');

		await writeFile(store.path, '{"version":2,"count":1}\n', "utf8");
		const invalid = await capture();
		expect(invalid.message).toBe(
			`JSON store ${store.path} failed validation: Invalid counter store`,
		);
		expect((invalid.cause as Error).message).toBe("Invalid counter store");

		await rm(store.path);
		await mkdir(store.path);
		const unreadable = await capture();
		expect(unreadable.message).toStartWith(
			`Unable to read JSON store ${store.path}: `,
		);
		expect(unreadable.cause).toMatchObject({ code: "EISDIR" });
	});

	test("serializes concurrent read-modify-write transactions", async () => {
		const store = await createCounterStore();

		const results = await Promise.all(
			Array.from({ length: 24 }, (_, index) =>
				updateJsonFileStore(store, async (current) => {
					await Bun.sleep(index % 3);
					const count = current.count + 1;
					return commitJsonFileStoreUpdate(
						{ version: 1, count },
						count,
					);
				}),
			),
		);

		expect(new Set(results).size).toBe(24);
		await expect(readJsonFileStore(store)).resolves.toEqual({
			version: 1,
			count: 24,
		});
		expect(await readdir(dirname(store.path))).toEqual(["counter.json"]);
	});

	test("does not revoke a lock owned by a live process", async () => {
		const store = await createCounterStore();
		store.lock = { timeoutMs: 10, retryDelayMs: 1 };
		const lockPath = `${store.path}.lock`;
		await writeFile(
			lockPath,
			`${JSON.stringify(createLockMetadata(process.pid, "live-owner"))}\n`,
			"utf8",
		);

		await expect(
			writeJsonFileStore(store, { version: 1, count: 1 }),
		).rejects.toThrow("waiting for JSON store lock");
		expect(JSON.parse(await readFile(lockPath, "utf8")).token).toBe(
			"live-owner",
		);
	});

	test("recovers a lock whose local owner has exited", async () => {
		const store = await createCounterStore();
		const owner = Bun.spawn([process.execPath, "-e", "process.exit(0)"]);
		const ownerPid = owner.pid;
		await owner.exited;
		await writeFile(
			`${store.path}.lock`,
			`${JSON.stringify(createLockMetadata(ownerPid, "exited-owner"))}\n`,
			"utf8",
		);

		await writeJsonFileStore(store, { version: 1, count: 9 });

		await expect(readJsonFileStore(store)).resolves.toEqual({
			version: 1,
			count: 9,
		});
		expect(await readdir(dirname(store.path))).toEqual(["counter.json"]);
	});

	test("recovers a stale recovery sentinel whose local owner has exited", async () => {
		const store = await createCounterStore();
		const owner = Bun.spawn([process.execPath, "-e", "process.exit(0)"]);
		const ownerPid = owner.pid;
		await owner.exited;
		await writeFile(
			`${store.path}.lock`,
			`${JSON.stringify(createLockMetadata(ownerPid, "exited-owner"))}\n`,
			"utf8",
		);
		await writeFile(
			`${store.path}.lock.recovery`,
			`${JSON.stringify(createLockMetadata(ownerPid, "exited-recovery"))}\n`,
			"utf8",
		);

		await writeJsonFileStore(store, { version: 1, count: 11 });

		await expect(readJsonFileStore(store)).resolves.toEqual({
			version: 1,
			count: 11,
		});
		expect(await readdir(dirname(store.path))).toEqual(["counter.json"]);
	});

	test("enforces the deadline after removing an abandoned lock", async () => {
		const store = await createCounterStore();
		store.lock = { timeoutMs: 0, retryDelayMs: 1 };
		const owner = Bun.spawn([process.execPath, "-e", "process.exit(0)"]);
		const ownerPid = owner.pid;
		await owner.exited;
		await writeFile(
			`${store.path}.lock`,
			`${JSON.stringify(createLockMetadata(ownerPid, "expired-owner"))}\n`,
			"utf8",
		);

		await expect(
			writeJsonFileStore(store, { version: 1, count: 1 }),
		).rejects.toThrow("Timed out after 0ms");
		expect(await readdir(dirname(store.path))).toEqual([]);
	});

	test("names the lock file, its owner, and the manual fix when a live lock times out", async () => {
		const store = await createCounterStore();
		store.lock = { timeoutMs: 10, retryDelayMs: 1 };
		const lockPath = `${store.path}.lock`;
		const createdAt = new Date(Date.now() - 90_000).toISOString();
		await writeFile(
			lockPath,
			`${JSON.stringify({ ...createLockMetadata(process.pid, "secret-lock-token"), createdAt })}\n`,
			"utf8",
		);

		const error = await captureLockTimeout(store);

		expect(error.name).toBe("JsonFileLockTimeoutError");
		expect(error.storePath).toBe(store.path);
		expect(error.lockPath).toBe(lockPath);
		expect(error.holder).toEqual({
			status: "held",
			pid: process.pid,
			hostname: hostname(),
			createdAt,
		});
		expect(error.message).toContain(
			`Lock file ${lockPath} is held by pid ${process.pid} on this host (${JSON.stringify(hostname())}) since ${createdAt}`,
		);
		expect(error.message).toMatch(/\(1m 3\ds ago\)/);
		expect(error.message).toContain(
			`If that process is gone, delete ${lockPath} and retry.`,
		);
		// The lock token is ownership state, not diagnostics.
		expect(error.message).not.toContain("secret-lock-token");
		expect(JSON.stringify(error.holder)).not.toContain("secret-lock-token");
	});

	test("explains that a lock owned by another host is never recovered automatically", async () => {
		const store = await createCounterStore();
		store.lock = { timeoutMs: 10, retryDelayMs: 1 };
		const lockPath = `${store.path}.lock`;
		// Even a pid that is dead here cannot be judged for another host.
		const ownerPid = await exitedProcessPid();
		const foreignLock = `${JSON.stringify({
			...createLockMetadata(ownerPid, "foreign-owner"),
			hostname: "retired-container-host",
		})}\n`;
		await writeFile(lockPath, foreignLock, "utf8");

		const error = await captureLockTimeout(store);

		expect(error.message).toContain(
			`is held by pid ${ownerPid} on host "retired-container-host"`,
		);
		expect(error.message).toContain(
			"cannot check a process on another host, so that lock is never recovered automatically",
		);
		expect(error.message).toContain(
			`If that process is gone, delete ${lockPath} and retry.`,
		);
		// Diagnostics never change lock-stealing semantics.
		expect(await readFile(lockPath, "utf8")).toBe(foreignLock);
	});

	test("reports unreadable lock metadata and a blocking recovery marker", async () => {
		const store = await createCounterStore();
		store.lock = { timeoutMs: 10, retryDelayMs: 1 };
		const lockPath = `${store.path}.lock`;
		await writeFile(lockPath, "not lock metadata\n", "utf8");
		await writeFile(
			`${lockPath}.recovery`,
			`${JSON.stringify({ ...createLockMetadata(4242, "recovery-token"), hostname: "old-laptop.local" })}\n`,
			"utf8",
		);

		const error = await captureLockTimeout(store);

		expect(error.holder).toEqual({ status: "unreadable" });
		expect(error.message).toContain(
			`Lock file ${lockPath} has no readable owner metadata. If no listmonk-ops process is using this store, delete ${lockPath} and retry.`,
		);
		expect(error.recoveryMarker).toMatchObject({
			status: "held",
			pid: 4242,
			hostname: "old-laptop.local",
		});
		expect(error.message).toContain(
			`Lock-recovery marker ${lockPath}.recovery (pid 4242 on host "old-laptop.local" since`,
		);
		expect(error.message).toContain("also blocks automatic recovery");
		expect(error.message).not.toContain("recovery-token");
	});

	test("formats lock ages and falls back to a generic hint without diagnostics", () => {
		const error = new JsonFileLockTimeoutError("/state/store.json", 30_000, {
			holder: {
				status: "held",
				pid: 42,
				hostname: "old-host",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
			now: new Date("2026-01-01T03:02:09.000Z"),
		});
		expect(error.lockPath).toBe("/state/store.json.lock");
		expect(error.message).toBe(
			[
				"Timed out after 30000ms waiting for JSON store lock: /state/store.json.",
				'Lock file /state/store.json.lock is held by pid 42 on host "old-host" since 2026-01-01T00:00:00.000Z (3h 2m ago).',
				`This process runs on host ${JSON.stringify(hostname())} and cannot check a process on another host, so that lock is never recovered automatically (for example after a container is recreated or the hostname changes).`,
				"If that process is gone, delete /state/store.json.lock and retry.",
			].join(" "),
		);
		expect(
			new JsonFileLockTimeoutError("/state/store.json", 5).message,
		).toBe(
			"Timed out after 5ms waiting for JSON store lock: /state/store.json. If the process holding /state/store.json.lock is gone, delete that lock file and retry.",
		);
		expect(
			new JsonFileLockTimeoutError("/s.json", 5, {
				holder: { status: "absent" },
			}).message,
		).toContain("was released as the wait ended; retry the operation.");
	});

	test("treats a same-host owner that only answers EPERM as live without a start identity", async () => {
		// Another user's pid cannot be signalled; with nothing to compare, it
		// must stay protected.
		const store = await createCounterStore();
		store.lock = { timeoutMs: 10, retryDelayMs: 1 };
		const lockPath = `${store.path}.lock`;
		await writeFile(
			lockPath,
			`${JSON.stringify(createLockMetadata(1, "init-owner"))}\n`,
			"utf8",
		);

		await expect(
			writeJsonFileStore(store, { version: 1, count: 1 }),
		).rejects.toThrow("waiting for JSON store lock");
		expect(JSON.parse(await readFile(lockPath, "utf8")).token).toBe(
			"init-owner",
		);
	});

	test.skipIf(initStartTicks === undefined)(
		"compares Linux start ticks when kill(pid, 0) answers EPERM",
		async () => {
			const store = await createCounterStore();
			store.lock = { timeoutMs: 10, retryDelayMs: 1 };
			const lockPath = `${store.path}.lock`;
			const ticks = initStartTicks ?? 0;
			// Same start ticks: the recorded owner is still that process.
			await writeFile(
				lockPath,
				`${JSON.stringify({ ...createLockMetadata(1, "live-init"), bootTicks: ticks })}\n`,
				"utf8",
			);
			await expect(
				writeJsonFileStore(store, { version: 1, count: 1 }),
			).rejects.toThrow("waiting for JSON store lock");

			// Different start ticks: pid 1 was reused, so the lock is abandoned.
			await writeFile(
				lockPath,
				`${JSON.stringify({ ...createLockMetadata(1, "reused-init"), bootTicks: ticks + 1 })}\n`,
				"utf8",
			);
			store.lock = { timeoutMs: 5_000, retryDelayMs: 1 };
			await writeJsonFileStore(store, { version: 1, count: 2 });
			await expect(readJsonFileStore(store)).resolves.toEqual({
				version: 1,
				count: 2,
			});
			expect(await readdir(dirname(store.path))).toEqual(["counter.json"]);
		},
	);

	test("rejects an invalid JSON representation before overwriting state", async () => {
		const store = await createCounterStore();
		await writeJsonFileStore(store, { version: 1, count: 7 });
		const before = await readFile(store.path, "utf8");

		await expect(
			updateJsonFileStore(store, () =>
				commitJsonFileStoreUpdate(
					{ version: 1, count: Number.NaN },
					undefined,
				),
			),
		).rejects.toThrow("Invalid counter store");
		expect(await readFile(store.path, "utf8")).toBe(before);
	});

	test("replaces a store with complete JSON and cleans temporary files", async () => {
		const store = await createCounterStore();

		await writeJsonFileStore(store, { version: 1, count: 7 });

		expect(JSON.parse(await readFile(store.path, "utf8"))).toEqual({
			version: 1,
			count: 7,
		});
		expect(await readdir(dirname(store.path))).toEqual(["counter.json"]);
	});

	test("skips the atomic rewrite when an update returns the value unchanged", async () => {
		const base = await createCounterStore();
		// Opt-in stores whose callbacks never mutate in place may skip the
		// rewrite; the default behavior always writes.
		const store: JsonFileStore<CounterStore> = {
			...base,
			skipUnchangedWrites: true,
		};
		await writeJsonFileStore(store, { version: 1, count: 7 });
		// Let the filesystem clock advance so a real rewrite is detectable.
		await new Promise((resolvePause) => setTimeout(resolvePause, 10));

		const before = await stat(store.path);
		const observed = await updateJsonFileStore(store, (current) =>
			// Read-only outcome: return the same document by reference, the
			// way a lost claim race does.
			commitJsonFileStoreUpdate(current, current.count),
		);
		expect(observed).toBe(7);
		// No rewrite: the modification time is untouched.
		expect((await stat(store.path)).mtimeMs).toBe(before.mtimeMs);

		// Without the opt-in, an unchanged reference still rewrites the file.
		await writeJsonFileStore(base, { version: 1, count: 7 });
		await new Promise((resolvePause) => setTimeout(resolvePause, 10));
		const beforeDefault = await stat(base.path);
		await updateJsonFileStore(base, (current) =>
			commitJsonFileStoreUpdate(current, current.count),
		);
		expect((await stat(base.path)).mtimeMs).not.toBe(beforeDefault.mtimeMs);

		// A real change on the opt-in store rewrites too.
		await new Promise((resolvePause) => setTimeout(resolvePause, 10));
		const beforeWrite = await stat(store.path);
		await updateJsonFileStore(store, (current) =>
			commitJsonFileStoreUpdate({ ...current, count: current.count + 1 }, undefined),
		);
		expect((await stat(store.path)).mtimeMs).not.toBe(beforeWrite.mtimeMs);
		expect(JSON.parse(await readFile(store.path, "utf8"))).toEqual({
			version: 1,
			count: 8,
		});
	});
});
