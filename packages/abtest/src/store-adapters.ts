import type { AbTest } from "./types";
import {
	bumpRevision,
	type AbTestStoreAdapter,
	type AbTestStoreQuery,
} from "./store-adapter";

/**
 * In-memory store for testing. No persistence; resets on process exit.
 * Uses a simple Map and serialized transaction semantics (a mutex
 * prevents concurrent transaction callbacks from interleaving).
 */
export class InMemoryAbTestStore implements AbTestStoreAdapter {
	private readonly tests = new Map<string, AbTest>();
	private txQueue: Promise<unknown> = Promise.resolve();

	constructor(initial: AbTest[] = []) {
		for (const test of initial) {
			this.tests.set(test.id, structuredClone(test));
		}
	}

	async get(id: string): Promise<AbTest | null> {
		const test = this.tests.get(id);
		return test ? structuredClone(test) : null;
	}

	async list(query?: AbTestStoreQuery): Promise<AbTest[]> {
		const all = Array.from(this.tests.values()).map((t) =>
			structuredClone(t),
		);
		if (query?.status) {
			return all.filter((t) => t.status === query.status);
		}
		return all;
	}

	async transaction<T>(
		id: string,
		fn: (
			current: AbTest | null,
		) => Promise<{ next: AbTest | null; result: T }>,
	): Promise<T> {
		return this.serialize(async () => {
			const current = this.tests.get(id);
			const currentCopy = current ? structuredClone(current) : null;
			const preSnapshot = currentCopy
				? JSON.stringify(currentCopy)
				: null;
			const { next, result } = await fn(currentCopy);
			if (next === null) {
				this.tests.delete(id);
			} else {
				if (next.id !== id) {
					throw new Error(
						`transaction id mismatch: expected ${id}, got ${next.id}`,
					);
				}
				const postSnapshot = JSON.stringify(next);
				if (postSnapshot !== preSnapshot) {
					bumpRevision(next);
					this.tests.set(id, structuredClone(next));
				}
			}
			return result;
		});
	}

	async transactionAll<T>(
		fn: (
			tests: AbTest[],
		) => Promise<{ next: AbTest[]; result: T }>,
	): Promise<T> {
		return this.serialize(async () => {
			const current = Array.from(this.tests.values()).map((t) =>
				structuredClone(t),
			);
			const preSnapshots = new Map(
				current.map((t) => [t.id, JSON.stringify(t)]),
			);
			const { next, result } = await fn(current);
			for (const test of next) {
				const pre = preSnapshots.get(test.id);
				const post = JSON.stringify(test);
				if (pre !== post) {
					bumpRevision(test);
				}
			}
			this.tests.clear();
			for (const test of next) {
				this.tests.set(test.id, structuredClone(test));
			}
			return result;
		});
	}

	private serialize<T>(fn: () => Promise<T>): Promise<T> {
		const result = this.txQueue.then(fn, fn);
		this.txQueue = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}

/**
 * JSON file-backed store. Wraps a single locked update callback that
 * reads, mutates, and writes the document atomically under one file
 * lock. The caller provides updateAll which must hold the lock across
 * the entire read-modify-write cycle (like updateJsonFileStore).
 *
 * For backward compatibility, a separate read/write constructor is
 * also available, but it does NOT provide atomicity — callers using
 * it must ensure no concurrent writes (e.g., single-process test only).
 */
export class JsonFileAbTestStore implements AbTestStoreAdapter {
	private readonly updateAll?: <T>(
		fn: (tests: AbTest[]) => Promise<{ next: AbTest[]; result: T }>,
	) => Promise<T>;
	private readonly readAllFn?: () => Promise<AbTest[]>;
	private readonly writeAllFn?: (tests: AbTest[]) => Promise<void>;

	/**
	 * Preferred constructor: provides a single locked update callback.
	 * Use this when wiring to updateJsonFileStore for cross-process
	 * atomicity.
	 */
	static withLockedUpdate(
		updateAll: <T>(
			fn: (tests: AbTest[]) => Promise<{ next: AbTest[]; result: T }>,
		) => Promise<T>,
	): JsonFileAbTestStore {
		const store = Object.create(JsonFileAbTestStore.prototype);
		store.updateAll = updateAll;
		return store;
	}

	/**
	 * Legacy constructor: separate read/write. Does NOT provide atomicity
	 * between the read and write. Only safe for single-process scenarios
	 * (e.g., tests). Production callers should use withLockedUpdate().
	 */
	constructor(
		readAll: () => Promise<AbTest[]>,
		writeAll: (tests: AbTest[]) => Promise<void>,
	) {
		this.readAllFn = readAll;
		this.writeAllFn = writeAll;
	}

	async get(id: string): Promise<AbTest | null> {
		const tests = await this.readOnly();
		return tests.find((t) => t.id === id) ?? null;
	}

	async list(query?: AbTestStoreQuery): Promise<AbTest[]> {
		const tests = await this.readOnly();
		if (query?.status) {
			return tests.filter((t) => t.status === query.status);
		}
		return tests;
	}

	async transaction<T>(
		id: string,
		fn: (
			current: AbTest | null,
		) => Promise<{ next: AbTest | null; result: T }>,
	): Promise<T> {
		return this.transactionAll(async (tests) => {
			const current = tests.find((t) => t.id === id) ?? null;
			const preSnapshot = current ? JSON.stringify(current) : null;
			const { next, result } = await fn(current);
			let updated: AbTest[];
			if (next === null) {
				updated = tests.filter((t) => t.id !== id);
			} else {
				if (next.id !== id) {
					throw new Error(
						`transaction id mismatch: expected ${id}, got ${next.id}`,
					);
				}
				const postSnapshot = JSON.stringify(next);
				if (postSnapshot !== preSnapshot) {
					// bumpRevision is called by the enclosing transactionAll,
					// so do NOT double-bump here.
					updated = tests.map((t) =>
						t.id === next.id ? next : t,
					);
					if (!updated.some((t) => t.id === next.id)) {
						updated.push(next);
					}
				} else {
					updated = tests;
				}
			}
			return { next: updated, result };
		});
	}

	async transactionAll<T>(
		fn: (
			tests: AbTest[],
		) => Promise<{ next: AbTest[]; result: T }>,
	): Promise<T> {
		if (this.updateAll) {
			// Atomic path: the updateAll callback holds the file lock.
			return this.updateAll(async (tests) => {
				const preSnapshots = new Map(
					tests.map((t) => [t.id, JSON.stringify(t)]),
				);
				const { next, result } = await fn(tests);
				for (const test of next) {
					const pre = preSnapshots.get(test.id);
					const post = JSON.stringify(test);
					if (pre !== post) {
						bumpRevision(test);
					}
				}
				return { next, result };
			});
		}
		// Legacy path: separate read/write, no lock.
		const current = await this.readOnly();
		const preSnapshots = new Map(current.map((t) => [t.id, JSON.stringify(t)]));
		const { next, result } = await fn(current);
		for (const test of next) {
			const pre = preSnapshots.get(test.id);
			const post = JSON.stringify(test);
			if (pre !== post) {
				bumpRevision(test);
			}
		}
		await this.writeAllFn!(next);
		return result;
	}

	private async readOnly(): Promise<AbTest[]> {
		if (this.updateAll) {
			// Use the locked update path with a no-op mutation.
			return this.updateAll(async (tests) => ({
				next: tests,
				result: tests,
			}));
		}
		return this.readAllFn!();
	}
}
