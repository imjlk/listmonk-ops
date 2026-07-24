import type { AbTest } from "./types";

/**
 * Storage adapter interface for A/B test persistence.
 *
 * Stage 5 introduces a pluggable store abstraction so the persistence
 * layer can be swapped between JSON file (default), InMemory (testing),
 * and Postgres (multi-node production) without changing domain code.
 *
 * The transaction method provides atomic read-modify-write semantics:
 * the adapter guarantees no concurrent writer can interleave between
 * the read and the commit. For JSON file this is a file lock; for
 * Postgres it will be a SELECT ... FOR UPDATE row lock.
 *
 * `next: null` deletes the test; returning the same `current` without
 * mutation is a no-op. The adapter handles serialization, locking, and
 * atomic commit.
 */

export interface AbTestStoreAdapter {
	/** Read a single test by id, or null if not found. */
	get(id: string): Promise<AbTest | null>;

	/** List tests, optionally filtered by status or cursor. */
	list(query?: AbTestStoreQuery): Promise<AbTest[]>;

	/**
	 * Atomically read-modify-write a single test.
	 *
	 * The callback receives the current test (or null if not found) and
	 * returns `{ next, result }`. If `next` is null, the test is deleted.
	 * If `next` equals `current` (same reference), the write is skipped.
	 * The adapter guarantees the write is atomic and no concurrent writer
	 * can interleave.
	 */
	transaction<T>(
		id: string,
		fn: (
			current: AbTest | null,
		) => Promise<{ next: AbTest | null; result: T }>,
	): Promise<T>;

	/**
	 * Atomically read-modify-write the entire document. Used by the
	 * existing withStoredAbTestExecutors path that needs to snapshot
	 * all tests at once.
	 */
	transactionAll<T>(
		fn: (
			tests: AbTest[],
		) => Promise<{ next: AbTest[]; result: T }>,
	): Promise<T>;
}

export interface AbTestStoreQuery {
	status?: AbTest["status"];
}

/**
 * Bump the revision counter for optimistic concurrency. Called by the
 * adapter (or the domain layer) before committing a mutation so that
 * concurrent writers can detect stale updates.
 */
export function bumpRevision(test: AbTest): void {
	test.revision = (test.revision ?? 0) + 1;
	test.updatedAt = new Date();
}
