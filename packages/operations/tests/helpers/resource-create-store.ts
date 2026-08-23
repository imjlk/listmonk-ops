import type {
	ResourceCreateIdempotencyStore,
	StoredResourceCreateRecord,
} from "@listmonk-ops/common";

/**
 * In-memory mirror of the file-backed claim/commit/release semantics with a
 * promise-chain mutex so concurrent claims serialize like the real store.
 * Owner liveness is not modeled: only an explicitly marked-unknown claim
 * goes stale here (surfaced as `unresolved`).
 */
export function createInMemoryResourceCreateStore() {
	const records = new Map<string, StoredResourceCreateRecord>();
	let chain: Promise<unknown> = Promise.resolve();
	function serialized<Result>(action: () => Result): Promise<Result> {
		const run = chain.then(action, action);
		chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
	const store: ResourceCreateIdempotencyStore = {
		claim: (options) =>
			serialized(() => {
				const existing = records.get(options.key);
				if (existing !== undefined) {
					if (
						existing.payloadHash !== options.payloadHash ||
						existing.targetHash !== options.targetHash ||
						existing.resourceKind !== options.resourceKind
					) {
						const reason =
							existing.targetHash !== options.targetHash
								? ("target" as const)
								: existing.payloadHash !== options.payloadHash
									? ("payload" as const)
									: ("resourceKind" as const);
						return { kind: "conflict" as const, reason, existing };
					}
					if (existing.status === "created") {
						return { kind: "replay" as const, record: existing };
					}
					if (existing.status === "unknown") {
						return { kind: "unresolved" as const, record: existing };
					}
					return { kind: "pending" as const, record: existing };
				}
				const now = new Date().toISOString();
				const record: StoredResourceCreateRecord = {
					key: options.key,
					payloadHash: options.payloadHash,
					targetHash: options.targetHash,
					resourceKind: options.resourceKind,
					status: "pending",
					claimToken: `token-${records.size + 1}-${Math.random()}`,
					owner: { pid: process.pid, hostname: "test", startedAt: now },
					firstClaimedAt: now,
					createdAt: now,
					updatedAt: now,
				};
				records.set(options.key, record);
				return {
					kind: "new" as const,
					claimToken: record.claimToken,
					record,
				};
			}),
		commit: (options) =>
			serialized(() => {
				const existing = records.get(options.key);
				if (
					existing !== undefined &&
					existing.claimToken === options.claimToken &&
					existing.status === "pending"
				) {
					records.set(options.key, {
						...existing,
						status: "created",
						resourceId: options.resourceId,
						updatedAt: new Date().toISOString(),
					});
				}
			}),
		markUnknown: (options) =>
			serialized(() => {
				const existing = records.get(options.key);
				if (
					existing !== undefined &&
					existing.claimToken === options.claimToken &&
					existing.status === "pending"
				) {
					records.set(options.key, {
						...existing,
						status: "unknown",
						updatedAt: new Date().toISOString(),
					});
				}
			}),
		release: (options) =>
			serialized(() => {
				const existing = records.get(options.key);
				if (
					existing !== undefined &&
					existing.claimToken === options.claimToken &&
					existing.status === "pending"
				) {
					records.delete(options.key);
				}
			}),
	};
	return { store, records };
}
