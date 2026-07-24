import type { AbTest } from "./types";
import {
	bumpRevision,
	type AbTestStoreAdapter,
	type AbTestStoreQuery,
} from "./store-adapter";

/**
 * In-memory store for testing. No persistence; resets on process exit.
 * Uses a simple Map and synchronous transaction semantics (no actual
 * locking needed since Node is single-threaded).
 */
export class InMemoryAbTestStore implements AbTestStoreAdapter {
	private readonly tests = new Map<string, AbTest>();

	constructor(initial: AbTest[] = []) {
		for (const test of initial) {
			this.tests.set(test.id, test);
		}
	}

	async get(id: string): Promise<AbTest | null> {
		return this.tests.get(id) ?? null;
	}

	async list(query?: AbTestStoreQuery): Promise<AbTest[]> {
		const all = Array.from(this.tests.values());
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
		const current = this.tests.get(id) ?? null;
		const { next, result } = await fn(current);
		if (next === null) {
			this.tests.delete(id);
		} else if (next !== current) {
			bumpRevision(next);
			this.tests.set(id, next);
		}
		return result;
	}

	async transactionAll<T>(
		fn: (
			tests: AbTest[],
		) => Promise<{ next: AbTest[]; result: T }>,
	): Promise<T> {
		const current = Array.from(this.tests.values());
		const { next, result } = await fn(current);
		this.tests.clear();
		for (const test of next) {
			this.tests.set(test.id, test);
		}
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
		// Delegate to transactionAll for the file-lock semantics.
		return this.transactionAll(async (tests) => {
			const current = tests.find((t) => t.id === id) ?? null;
			const { next, result } = await fn(current);
			let updated: AbTest[];
			if (next === null) {
				updated = tests.filter((t) => t.id !== id);
			} else if (next !== current) {
				bumpRevision(next);
				updated = tests.map((t) => (t.id === id ? next : t));
				if (!updated.some((t) => t.id === id)) {
					updated.push(next);
				}
			} else {
				updated = tests;
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
		if (next !== current) {
			await this.writeAll(next);
		}
		return result;
	}
}
