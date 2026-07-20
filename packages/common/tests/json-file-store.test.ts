import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	commitJsonFileStoreUpdate,
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

	test("replaces a store with complete JSON and cleans temporary files", async () => {
		const store = await createCounterStore();

		await writeJsonFileStore(store, { version: 1, count: 7 });

		expect(JSON.parse(await readFile(store.path, "utf8"))).toEqual({
			version: 1,
			count: 7,
		});
		expect(await readdir(dirname(store.path))).toEqual(["counter.json"]);
	});
});
