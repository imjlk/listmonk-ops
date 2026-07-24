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
			// Snapshot the pre-call state as a JSON string so in-place
			// mutations of currentCopy are detected even if the callback
			// returns the same reference.
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
				// Detect changes by comparing the post-call serialized
				// state against the pre-call snapshot. This catches both
				// new-object returns and in-place mutations of currentCopy.
				const postSnapshot = JSON.stringify(next);
				if (postSnapshot !== preSnapshot) {
					bumpRevision(next);
					this.tests.set(
						id,
						structuredClone(next),
					);
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
			const currentMap = new Map(current.map((t) => [t.id, t]));
			const { next, result } = await fn(current);
			// Bump revision for tests that changed.
			for (const test of next) {
				const old = currentMap.get(test.id);
				if (old !== test) {
					bumpRevision(test);
				}
			}
			this.tests.clear();
			for (const test of next) {
				this.tests.set(test.id, test);
			}
			return result;
		});
	}

	/**
	 * Serialize transaction callbacks so concurrent transactions on the
	 * same or different tests cannot interleave while awaiting the
	 * callback. This is the single-threaded equivalent of a mutex.
	 */
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
 * JSON file-backed store. Wraps the existing @listmonk-ops/common
 * JsonFileStore primitives with the AbTestStoreAdapter interface.
 *
 * The file lock from JsonFileStore provides cross-process mutual
 * exclusion for single-host deployments. For multi-node, use
 * PostgresAbTestStore (planned).
 *
 * transactionAll delegates to the caller-provided read/write pair.
 * The caller is responsible for holding the file lock across both
 * operations. The existing withStoredAbTestExecutors does this via
 * updateJsonFileStore; a direct caller must use the same pattern or
 * provide a single locked read-write callback.
 */
export class JsonFileAbTestStore implements AbTestStoreAdapter {
	constructor(
		private readonly readAll: () => Promise<AbTest[]>,
		private readonly writeAll: (tests: AbTest[]) => Promise<void>,
	) {}

	async get(id: string): Promise<AbTest | null> {
		const tests = await this.readAll();
		return tests.find((t) => t.id === id) ?? null;
	}

	async list(query?: AbTestStoreQuery): Promise<AbTest[]> {
		const tests = await this.readAll();
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
					bumpRevision(next);
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
		const current = await this.readAll();
		const { next, result } = await fn(current);
		// Always write — defensive copies mean same-reference no-op does
		// not apply for the JSON adapter. The file store's own dedup
		// (if any) handles redundant writes.
		await this.writeAll(next);
		return result;
	}
}
