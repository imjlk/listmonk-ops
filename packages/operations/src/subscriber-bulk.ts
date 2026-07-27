/**
 * Options shared by every subscriber bulk operation. They intentionally
 * mirror the shape of {@link runSubscriberHygiene} so callers can reuse the
 * same mental model: dry-run gate, hard cap on processed subscribers, and
 * per-item error tolerance.
 */
export interface BulkExecutorOptions {
	/**
	 * When true, no Listmonk API call is made. The executor still walks the
	 * subscriber list (respecting {@link maxItems}) and reports how many
	 * items would have been processed.
	 */
	dry_run: boolean;
	/**
	 * Maximum number of subscriber IDs to process. IDs beyond this cap are
	 * silently ignored; the result's `processed` reflects only the capped
	 * slice. Defaults to a high ceiling so callers can opt in explicitly.
	 */
	max_items: number;
	/**
	 * When true, a failed chunk is recorded in {@link BulkExecutorResult.errors}
	 * and execution continues with the next chunk. When false (default),
	 * the first chunk failure throws and aborts the bulk run, matching the
	 * fail-fast contract used by `addSubscribersToListBulk` in the abtest
	 * package.
	 */
	continue_on_error: boolean;
}

export interface BulkExecutorResult {
	/** Number of subscriber IDs considered (after applying maxItems). */
	processed: number;
	/** Number of subscriber IDs that were applied successfully. */
	succeeded: number;
	/** Number of subscriber IDs whose chunk failed. */
	failed: number;
	/** Per-chunk error messages, only populated when continue_on_error is true. */
	errors: string[];
}

/**
 * Default chunk size for Listmonk `manageLists` / `manageBlocklist`. The
 * abtest `addSubscribersToListBulk` helper settled on 500 and we keep the
 * same ceiling so behaviour stays consistent across packages.
 */
export const DEFAULT_SUBSCRIBER_BULK_CHUNK_SIZE = 500;

/**
 * Run a subscriber bulk operation by chunking `subscriberIds` and invoking
 * `action` once per chunk. The action receives the slice of IDs to send to
 * Listmonk and may resolve to anything; the executor only checks for
 * rejection. Chunks run sequentially so progress is resumable on retry,
 * matching the abtest precedent.
 *
 * The executor never interprets action results — `succeeded` counts IDs in
 * chunks that resolved, `failed` counts IDs in chunks that rejected. This
 * keeps the contract simple and predictable across the four callers (add
 * to lists, remove from lists, blocklist, unblocklist).
 *
 * Note: the executor does not take a client context. Each operation passes
 * a chunk `action` that closes over its own client slice, which keeps the
 * executor runtime-neutral and avoids dragging Listmonk-specific types
 * into the bulk loop.
 */
export async function executeSubscriberBulk(
	params: {
		subscriberIds: readonly number[];
		chunkSize?: number;
		action: (chunk: number[]) => Promise<unknown>;
	},
	options: BulkExecutorOptions,
): Promise<BulkExecutorResult> {
	const chunkSize =
		params.chunkSize ?? DEFAULT_SUBSCRIBER_BULK_CHUNK_SIZE;
	if (
		!Number.isFinite(chunkSize) ||
		!Number.isInteger(chunkSize) ||
		chunkSize <= 0
	) {
		throw new Error(
			`chunkSize must be a positive finite integer, received ${chunkSize}`,
		);
	}
	if (
		!Number.isFinite(options.max_items) ||
		!Number.isInteger(options.max_items) ||
		options.max_items <= 0
	) {
		throw new Error(
			`max_items must be a positive finite integer, received ${options.max_items}`,
		);
	}

	const capped = params.subscriberIds.slice(0, options.max_items);
	const result: BulkExecutorResult = {
		processed: capped.length,
		succeeded: 0,
		failed: 0,
		errors: [],
	};

	if (capped.length === 0 || options.dry_run) {
		return result;
	}

	for (let offset = 0; offset < capped.length; offset += chunkSize) {
		const chunk = capped.slice(offset, offset + chunkSize);
		try {
			await params.action(chunk);
			result.succeeded += chunk.length;
		} catch (error) {
			const message = `Chunk at offset ${offset} (${chunk.length} subscribers): ${error instanceof Error ? error.message : String(error)}`;
			if (!options.continue_on_error) {
				// Fail-fast: do not record bookkeeping on `result` because it
				// is never returned. Surface a clear error wrapping the
				// underlying cause instead.
				throw new Error(
					`Subscriber bulk operation failed at offset ${offset}. ${message}`,
					{ cause: error },
				);
			}
			result.failed += chunk.length;
			result.errors.push(message);
		}
	}
	return result;
}
