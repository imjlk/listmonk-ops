/**
 * Experiment collision guard for A/B tests.
 *
 * Implements the advanced experimentation followup's Change Set C:
 * prevents overlapping experiments in the same family from exposing the
 * same subscribers. Uses an installation-level HMAC key to derive stable
 * cross-test subject keys, an atomic check-and-reserve participation
 * store, and active-window overlap detection.
 *
 * The collision key is a shared secret across all CLI/MCP nodes. Subject
 * keys are HMAC-SHA-256 digests; raw emails and UUIDs are never stored in
 * the participation state or surfaced in collision errors.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The domain tag mixed into the HMAC input so subject keys are scoped to
 * this application and cannot collide with HMACs derived for other uses.
 */
export const COLLISION_KEY_CONTEXT = "listmonk-ops/abtest-collision/v1";

/**
 * Strict ISO 8601 timestamp validation (reused from hypothesis.ts logic).
 * Rejects values Date.parse would silently accept, including the year-zero
 * string "0", localized formats like "01/02/03", and overflowed calendar
 * dates like "2026-02-30".
 */
export function isCollisionTimestamp(value: unknown): boolean {
	if (typeof value !== "string") return false;
	// Require a full datetime with an explicit timezone (Z or ±HH:MM) so
	// timestamps are unambiguous instants, not local-time-dependent values.
	const re =
		/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
	if (!re.test(value)) return false;
	const parts = value.split(/([T ])/);
	const datePart = parts[0];
	if (!datePart) return false;
	const dateNums = datePart.split("-").map(Number);
	const y = dateNums[0];
	const m = dateNums[1];
	const day = dateNums[2];
	if (y === undefined || m === undefined || day === undefined) return false;
	const d = new Date(Date.UTC(y, m - 1, day));
	if (
		d.getUTCFullYear() !== y ||
		d.getUTCMonth() !== m - 1 ||
		d.getUTCDate() !== day
	) {
		return false;
	}
	if (parts.length > 1) {
		if (Number.isNaN(Date.parse(value))) return false;
	}
	return true;
}

/**
 * Compute a stable, installation-scoped subject key from a subscriber UUID.
 * The same UUID + installation key always produces the same key, but the
 * key cannot be reversed to recover the UUID or email.
 *
 * Throws CollisionConfigurationError if the installation key is missing —
 * a multi-node deployment must not silently pass collision checks without
 * a configured key.
 */
export function computeSubjectKey(
	installationCollisionKey: string,
	normalizedSubscriberUuid: string,
): string {
	if (
		typeof installationCollisionKey !== "string" ||
		installationCollisionKey.length === 0
	) {
		throw new CollisionConfigurationError(
			"installationCollisionKey is required for collision guard; refusing to operate without a configured key",
		);
	}
	if (
		typeof normalizedSubscriberUuid !== "string" ||
		normalizedSubscriberUuid.length === 0
	) {
		throw new CollisionConfigurationError(
			"normalizedSubscriberUuid must be a non-empty string",
		);
	}
	// NUL-separated context + uuid prevents concatenation ambiguity.
	const input = `${COLLISION_KEY_CONTEXT}\0${normalizedSubscriberUuid}`;
	return createHmac("sha256", installationCollisionKey)
		.update(input, "utf8")
		.digest("hex");
}

/**
 * Normalize a subscriber UUID for consistent key derivation: trim, lowercase,
 * strip surrounding braces.
 */
export function normalizeSubscriberUuid(raw: string): string {
	let v = raw.trim().toLowerCase();
	if (v.startsWith("{") && v.endsWith("}")) {
		v = v.slice(1, -1);
	}
	return v;
}

/**
 * Determine whether two installations share the same collision key by
 * comparing subject keys derived from a probe UUID. Used to detect
 * configuration drift across nodes.
 */
export function installationKeysMatch(
	keyA: string,
	keyB: string,
	probeUuid: string,
): boolean {
	const sigA = computeSubjectKey(keyA, normalizeSubscriberUuid(probeUuid));
	const sigB = computeSubjectKey(keyB, normalizeSubscriberUuid(probeUuid));
	if (sigA.length !== sigB.length) return false;
	return timingSafeEqual(Buffer.from(sigA), Buffer.from(sigB));
}

export interface ExperimentParticipation {
	testId: string;
	subjectKey: string;
	channel: "email";
	experimentFamilyKey: string;
	state: "reserved" | "exposed" | "released";
	windowStartsAt: string;
	windowEndsAt: string;
	reservedAt: string;
	exposedAt?: string;
	releasedAt?: string;
}

export interface CollisionPolicy {
	mode: "block" | "exclude" | "warn";
	maximumConcurrentExperiments: number;
}

export const DEFAULT_COLLISION_POLICY: CollisionPolicy = {
	mode: "block",
	maximumConcurrentExperiments: 1,
};

/**
 * Compute the active window for an experiment, expanding the test's
 * launch/ends times by the exclusion and attribution windows from the
 * scope so overlapping exposure is detected even when sends happen near
 * the edges.
 *
 * Throws if launchAt is not a valid ISO 8601 timestamp or if window
 * parameters are non-finite/non-positive where required.
 */
export function computeActiveWindow(params: {
	launchAt: string;
	endsAt?: string;
	attributionWindowHours: number;
	exclusionWindowHours: number;
}): { windowStartsAt: string; windowEndsAt: string } {
	const { launchAt, endsAt, attributionWindowHours, exclusionWindowHours } =
		params;
	if (!isCollisionTimestamp(launchAt)) {
		throw new CollisionConfigurationError(
			`launchAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(launchAt)}`,
		);
	}
	if (
		typeof attributionWindowHours !== "number" ||
		!Number.isFinite(attributionWindowHours) ||
		attributionWindowHours < 0
	) {
		throw new CollisionConfigurationError(
			`attributionWindowHours must be finite and non-negative, received ${JSON.stringify(attributionWindowHours)}`,
		);
	}
	if (
		typeof exclusionWindowHours !== "number" ||
		!Number.isFinite(exclusionWindowHours) ||
		exclusionWindowHours < 0
	) {
		throw new CollisionConfigurationError(
			`exclusionWindowHours must be finite and non-negative, received ${JSON.stringify(exclusionWindowHours)}`,
		);
	}
	if (endsAt !== undefined && !isCollisionTimestamp(endsAt)) {
		throw new CollisionConfigurationError(
			`endsAt must be a valid ISO 8601 timestamp when present, received ${JSON.stringify(endsAt)}`,
		);
	}
	const launchMs = new Date(launchAt).getTime();
	const endBase = endsAt ? new Date(endsAt).getTime() : launchMs;
	if (endsAt !== undefined && endBase < launchMs) {
		throw new CollisionConfigurationError(
			`endsAt must not precede launchAt, received endsAt=${JSON.stringify(endsAt)} launchAt=${JSON.stringify(launchAt)}`,
		);
	}
	const startMs = launchMs - exclusionWindowHours * 3600 * 1000;
	const endMs =
		endBase + (attributionWindowHours + exclusionWindowHours) * 3600 * 1000;
	return {
		windowStartsAt: new Date(startMs).toISOString(),
		windowEndsAt: new Date(endMs).toISOString(),
	};
}

/**
 * Check whether two ISO timestamp windows overlap (inclusive).
 */
export function windowsOverlap(
	a: { windowStartsAt: string; windowEndsAt: string },
	b: { windowStartsAt: string; windowEndsAt: string },
): boolean {
	const aStart = new Date(a.windowStartsAt).getTime();
	const aEnd = new Date(a.windowEndsAt).getTime();
	const bStart = new Date(b.windowStartsAt).getTime();
	const bEnd = new Date(b.windowEndsAt).getTime();
	return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Two participations collide when they share the same subject key and
 * experiment family, and their active windows overlap. Different families
 * never collide even for the same subject. Released participations no
 * longer occupy the window.
 */
export function participationsCollide(
	a: ExperimentParticipation,
	b: ExperimentParticipation,
): boolean {
	if (a.subjectKey !== b.subjectKey) return false;
	if (a.experimentFamilyKey !== b.experimentFamilyKey) return false;
	if (a.state === "released" || b.state === "released") return false;
	return windowsOverlap(a, b);
}

export class CollisionConfigurationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CollisionConfigurationError";
	}
}

/**
 * Raised when the collision policy is "block" and at least one subject
 * conflicts with an existing reservation. The error intentionally carries
 * only aggregate counts and conflicting test IDs — never subject keys,
 * emails, or UUIDs — so collision diagnostics do not leak PII.
 */
export class CollisionConflictError extends Error {
	/** Number of subjects that conflict with existing reservations. */
	readonly conflictCount: number;
	/** Test IDs whose reservations conflict (no subject-level data). */
	readonly conflictingTestIds: string[];

	constructor(conflictCount: number, conflictingTestIds: string[]) {
		super(
			`Collision guard blocked launch: ${conflictCount} subject(s) conflict with ${conflictingTestIds.length} existing test(s)`,
		);
		this.name = "CollisionConflictError";
		this.conflictCount = conflictCount;
		this.conflictingTestIds = [...new Set(conflictingTestIds)].sort();
	}
}

export interface CollisionReservationResult {
	reserved: ExperimentParticipation[];
	/** Present only in exclude/warn mode when conflicts were found. */
	conflicts?: {
		count: number;
		conflictingTestIds: string[];
	};
	/** Present only in warn mode. */
	warning?: string;
}

/**
 * Participation store contract. The atomic checkAndReserve is the core
 * invariant: the check and the reservation must happen in a single
 * transaction so two concurrent launches cannot both pass.
 */
export interface ExperimentParticipationStore {
	checkAndReserve(input: {
		testId: string;
		channel: "email";
		experimentFamilyKey: string;
		windowStartsAt: string;
		windowEndsAt: string;
		subjectKeys: string[];
		policy: CollisionPolicy;
		reservedAt: string;
	}): Promise<CollisionReservationResult>;

	markExposed(testId: string, exposedAt: string): Promise<void>;
	releaseEligible(now: string): Promise<number>;
	listByTest(testId: string): Promise<ExperimentParticipation[]>;
	releaseByTest(testId: string, releasedAt: string): Promise<number>;
}

/**
 * Shallow-copy a participation record. All current fields are primitives,
 * so a shallow copy is sufficient to prevent callers from mutating
 * internal state. Named "shallow" to avoid implying deep-copy semantics
 * if nested fields are added in the future.
 */
function shallowCopyParticipation(
	p: ExperimentParticipation,
): ExperimentParticipation {
	return { ...p };
}

/**
 * In-memory participation store for testing and single-node deployments.
 * Uses a mutex-style serialize to approximate the atomic transaction so
 * concurrent checkAndReserve calls cannot interleave.
 *
 * The store removes existing reservations for the same testId before
 * checking conflicts, so a retry of the same test is not blocked by its
 * own prior reservation. All returned participations are deep-copied so
 * callers cannot mutate internal state.
 */
export class InMemoryExperimentParticipationStore
	implements ExperimentParticipationStore
{
	private participations: ExperimentParticipation[] = [];
	private chain: Promise<unknown> = Promise.resolve();

	private async serialized<T>(fn: () => T | Promise<T>): Promise<T> {
		const run = this.chain.then(fn, fn);
		this.chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run as Promise<T>;
	}

	async checkAndReserve(input: {
		testId: string;
		channel: "email";
		experimentFamilyKey: string;
		windowStartsAt: string;
		windowEndsAt: string;
		subjectKeys: string[];
		policy: CollisionPolicy;
		reservedAt: string;
	}): Promise<CollisionReservationResult> {
		// Validate testId, policy, and timestamps before entering the
		// serialized section, and snapshot the mutable input so later
		// mutation by the caller cannot affect the queued transaction.
		if (typeof input.testId !== "string" || input.testId.length === 0) {
			throw new CollisionConfigurationError(
				"testId must be a non-empty string",
			);
		}
		if (
			typeof input.policy.maximumConcurrentExperiments !== "number" ||
			!Number.isFinite(input.policy.maximumConcurrentExperiments) ||
			input.policy.maximumConcurrentExperiments < 1 ||
			!Number.isInteger(input.policy.maximumConcurrentExperiments)
		) {
			throw new CollisionConfigurationError(
				`maximumConcurrentExperiments must be a finite integer >= 1, received ${JSON.stringify(input.policy.maximumConcurrentExperiments)}`,
			);
		}
		const validModes = ["block", "exclude", "warn"];
		if (!validModes.includes(input.policy.mode)) {
			throw new CollisionConfigurationError(
				`policy.mode must be one of ${validModes.join(", ")}, received ${JSON.stringify(input.policy.mode)}`,
			);
		}
		if (!isCollisionTimestamp(input.reservedAt)) {
			throw new CollisionConfigurationError(
				`reservedAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(input.reservedAt)}`,
			);
		}
		const windowStartsAt = input.windowStartsAt;
		const windowEndsAt = input.windowEndsAt;
		const reservedAt = input.reservedAt;
		const testId = input.testId;
		const experimentFamilyKey = input.experimentFamilyKey;
		if (
			typeof experimentFamilyKey !== "string" ||
			!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(experimentFamilyKey)
		) {
			throw new CollisionConfigurationError(
				`experimentFamilyKey must be lowercase alphanumeric segments joined by [._-], received ${JSON.stringify(experimentFamilyKey)}`,
			);
		}
		const channel = input.channel;
		const subjectKeys = [...input.subjectKeys];
		const policy = { ...input.policy };
		if (!isCollisionTimestamp(windowStartsAt)) {
			throw new CollisionConfigurationError(
				`windowStartsAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(windowStartsAt)}`,
			);
		}
		if (!isCollisionTimestamp(windowEndsAt)) {
			throw new CollisionConfigurationError(
				`windowEndsAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(windowEndsAt)}`,
			);
		}
		// Reject reversed windows before entering the serialized section.
		if (
			new Date(windowStartsAt).getTime() >
			new Date(windowEndsAt).getTime()
		) {
			throw new CollisionConfigurationError(
				`windowStartsAt must not be later than windowEndsAt, received starts=${JSON.stringify(windowStartsAt)} ends=${JSON.stringify(windowEndsAt)}`,
			);
		}
		// Reject empty subject lists before mutating state.
		if (!Array.isArray(subjectKeys) || subjectKeys.length === 0) {
			throw new CollisionConfigurationError(
				"subjectKeys must be a non-empty array",
			);
		}
		// Validate all subject keys before mutating state so a validation
		// failure does not leave the store in a partially-cleared state.
		for (const sk of subjectKeys) {
			if (typeof sk !== "string" || sk.length === 0) {
				throw new CollisionConfigurationError(
					"subjectKeys must be non-empty strings",
				);
			}
			// Subject keys must be HMAC-SHA-256 hex digests (64 hex chars)
			// to prevent accidental use of raw UUIDs or emails.
			if (!/^[0-9a-f]{64}$/.test(sk)) {
				throw new CollisionConfigurationError(
					`subjectKeys must be 64-char hex HMAC digests (use computeSubjectKey), received a key of length ${sk.length}`,
				);
			}
		}
		return this.serialized(() => {
			// Save reserved participations for this testId so we can restore
			// them if the reservation fails (e.g. conflict in block mode).
			// Released participations are retained for audit history and must
			// not be discarded on retry.
			const savedReserved = this.participations.filter(
				(p) => p.testId === testId && p.state === "reserved",
			);
			this.participations = this.participations.filter(
				(p) => p.testId !== testId || p.state !== "reserved",
			);

			// Deduplicate subject keys so the same digest doesn't create
			// multiple participation records for one test.
			const uniqueSubjectKeys = [...new Set(subjectKeys)];

			const candidates: ExperimentParticipation[] = uniqueSubjectKeys.map(
				(subjectKey) => ({
					testId,
					subjectKey,
					channel,
					experimentFamilyKey,
					state: "reserved" as const,
					windowStartsAt,
					windowEndsAt,
					reservedAt,
				}),
			);

			// Build an index of active participations by subject+family for
			// efficient lookup against large audiences.
			const activeIndex = new Map<string, ExperimentParticipation[]>();
			for (const p of this.participations) {
				if (p.testId === testId || p.state === "released") continue;
				const key = `${p.subjectKey}:${p.experimentFamilyKey}`;
				const arr = activeIndex.get(key);
				if (arr) {
					arr.push(p);
				} else {
					activeIndex.set(key, [p]);
				}
			}

			// Check each candidate against indexed reservations from OTHER
			// tests. Same-testId participations must not block a retry.
			const conflictingTestIdSet = new Set<string>();
			let conflictCount = 0;
			// Per-subject blocking: a candidate is blocked if the number of
			// distinct conflicting tests for THAT subject reaches the limit.
			const blockedSubjects = new Set<string>();
			for (const candidate of candidates) {
				const key = `${candidate.subjectKey}:${candidate.experimentFamilyKey}`;
				const existing = activeIndex.get(key);
				if (!existing) continue;
				const conflicting = existing.filter((p) =>
					participationsCollide(p, candidate),
				);
				if (conflicting.length > 0) {
					conflictCount += 1;
					const perSubjectTests = new Set<string>();
					for (const c of conflicting) {
						conflictingTestIdSet.add(c.testId);
						perSubjectTests.add(c.testId);
					}
					// A subject is blocked when it already has
					// maximumConcurrentExperiments distinct overlapping tests
					// (the candidate would exceed the concurrency limit).
					// This applies to all modes: block throws, exclude removes,
					// warn reports.
					if (
						perSubjectTests.size >=
						policy.maximumConcurrentExperiments
					) {
						blockedSubjects.add(candidate.subjectKey);
					}
				}
			}

			const uniqueConflictingTests = [...conflictingTestIdSet];

			// In block mode, throw if any subject is blocked. The error count
			// reports the total number of conflicting subjects (conflictCount),
			// not just the blocked subset, so operators see the full impact.
			if (policy.mode === "block" && blockedSubjects.size > 0) {
				for (const p of savedReserved) {
					this.participations.push(p);
				}
				throw new CollisionConflictError(
					conflictCount,
					uniqueConflictingTests,
				);
			}

			// In exclude mode, exclude only concurrency-blocked subjects (those
			// that would exceed maximumConcurrentExperiments). When limit > 1,
			// subjects with fewer overlapping tests than the limit are still
			// reserved. In warn mode, reserve all but report blocked subjects.
			const toReserve =
				policy.mode === "exclude"
					? candidates.filter(
							(p) => !blockedSubjects.has(p.subjectKey),
						)
					: candidates;

			// Store shallow copies. Use a loop instead of spread to avoid
			// call stack limits with very large audiences.
			for (const p of toReserve) {
				this.participations.push(shallowCopyParticipation(p));
			}

			const result: CollisionReservationResult = {
				reserved: toReserve.map(shallowCopyParticipation),
			};
			if (conflictCount > 0) {
				result.conflicts = {
					count: conflictCount,
					conflictingTestIds: uniqueConflictingTests.sort(),
				};
			}
			// In warn mode, only warn when subjects actually exceed the
			// concurrency limit. Below-limit overlaps are allowed by design.
			if (policy.mode === "warn" && blockedSubjects.size > 0) {
				result.warning = `Collision guard warning: ${blockedSubjects.size} subject(s) exceed the concurrency limit of ${policy.maximumConcurrentExperiments}`;
			}
			return result;
		});
	}

	async markExposed(testId: string, exposedAt: string): Promise<void> {
		if (!isCollisionTimestamp(exposedAt)) {
			throw new CollisionConfigurationError(
				`exposedAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(exposedAt)}`,
			);
		}
		return this.serialized(() => {
			for (const p of this.participations) {
				if (p.testId === testId && p.state === "reserved") {
					p.state = "exposed";
					p.exposedAt = exposedAt;
				}
			}
		});
	}

	async releaseEligible(now: string): Promise<number> {
		if (!isCollisionTimestamp(now)) {
			throw new CollisionConfigurationError(
				`now must be a valid ISO 8601 timestamp, received ${JSON.stringify(now)}`,
			);
		}
		return this.serialized(() => {
			const nowMs = new Date(now).getTime();
			let count = 0;
			for (const p of this.participations) {
				if (p.state !== "released") {
					const windowEndMs = new Date(p.windowEndsAt).getTime();
					// Use strict < so boundary-ending participations remain
					// active, consistent with windowsOverlap's inclusive <=.
					if (windowEndMs < nowMs) {
						p.state = "released";
						p.releasedAt = now;
						count += 1;
					}
				}
			}
			return count;
		});
	}

	async listByTest(testId: string): Promise<ExperimentParticipation[]> {
		return this.serialized(() =>
			this.participations
				.filter((p) => p.testId === testId)
				.map(shallowCopyParticipation),
		);
	}

	async releaseByTest(
		testId: string,
		releasedAt: string,
	): Promise<number> {
		if (!isCollisionTimestamp(releasedAt)) {
			throw new CollisionConfigurationError(
				`releasedAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(releasedAt)}`,
			);
		}
		return this.serialized(() => {
			const releasedMs = new Date(releasedAt).getTime();
			let count = 0;
			for (const p of this.participations) {
				if (p.testId === testId && p.state !== "released") {
					// Exposed participations are retained until their window
					// ends so attribution is not lost on early cancel.
					if (p.state === "exposed") {
						const windowEndMs = new Date(p.windowEndsAt).getTime();
						// Use >= so the inclusive boundary keeps the exposed
						// participation active, matching windowsOverlap's
						// inclusive convention.
						if (windowEndMs >= releasedMs) continue;
					}
					p.state = "released";
					p.releasedAt = releasedAt;
					count += 1;
				}
			}
			return count;
		});
	}

	/** Test helper: returns a deep-copied snapshot of internal state. */
	snapshot(): ExperimentParticipation[] {
		return this.participations.map(shallowCopyParticipation);
	}
}
