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
	const re =
		/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;
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
	const startMs = launchMs - exclusionWindowHours * 3600 * 1000;
	const endBase = endsAt ? new Date(endsAt).getTime() : launchMs;
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

function deepCopyParticipation(p: ExperimentParticipation): ExperimentParticipation {
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
		if (!isCollisionTimestamp(input.reservedAt)) {
			throw new CollisionConfigurationError(
				`reservedAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(input.reservedAt)}`,
			);
		}
		if (!isCollisionTimestamp(input.windowStartsAt)) {
			throw new CollisionConfigurationError(
				`windowStartsAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(input.windowStartsAt)}`,
			);
		}
		if (!isCollisionTimestamp(input.windowEndsAt)) {
			throw new CollisionConfigurationError(
				`windowEndsAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(input.windowEndsAt)}`,
			);
		}
		return this.serialized(() => {
			// Remove existing reservations for this testId so a retry is not
			// blocked by its own prior reservation.
			this.participations = this.participations.filter(
				(p) => p.testId !== input.testId,
			);

			const candidates: ExperimentParticipation[] = [];
			for (const subjectKey of input.subjectKeys) {
				if (typeof subjectKey !== "string" || subjectKey.length === 0) {
					throw new CollisionConfigurationError(
						"subjectKeys must be non-empty strings",
					);
				}
				candidates.push({
					testId: input.testId,
					subjectKey,
					channel: input.channel,
					experimentFamilyKey: input.experimentFamilyKey,
					state: "reserved",
					windowStartsAt: input.windowStartsAt,
					windowEndsAt: input.windowEndsAt,
					reservedAt: input.reservedAt,
				});
			}

			// Check each candidate against existing reservations (excluding
			// same-testId, which we already removed above).
			const conflictingTestIds: string[] = [];
			let conflictCount = 0;
			for (const candidate of candidates) {
				const conflicting = this.participations.filter((existing) =>
					participationsCollide(existing, candidate),
				);
				if (conflicting.length > 0) {
					conflictCount += 1;
					for (const c of conflicting) {
						conflictingTestIds.push(c.testId);
					}
				}
			}

			// Enforce maximumConcurrentExperiments: count distinct active
			// tests in the same family whose windows overlap.
			const uniqueConflictingTests = [...new Set(conflictingTestIds)];
			if (
				uniqueConflictingTests.length >=
				input.policy.maximumConcurrentExperiments
			) {
				if (input.policy.mode === "block") {
					throw new CollisionConflictError(
						conflictCount,
						conflictingTestIds,
					);
				}
			} else if (conflictCount > 0 && input.policy.mode === "block") {
				throw new CollisionConflictError(conflictCount, conflictingTestIds);
			}

			// In exclude mode, only reserve non-conflicting subjects.
			const toReserve =
				input.policy.mode === "exclude"
					? candidates.filter(
							(p) =>
								!this.participations.some((existing) =>
									participationsCollide(existing, p),
								),
						)
					: candidates;

			// Store deep copies.
			this.participations.push(...toReserve.map(deepCopyParticipation));

			const result: CollisionReservationResult = {
				reserved: toReserve.map(deepCopyParticipation),
			};
			if (conflictCount > 0) {
				result.conflicts = {
					count: conflictCount,
					conflictingTestIds: uniqueConflictingTests.sort(),
				};
			}
			if (input.policy.mode === "warn" && conflictCount > 0) {
				result.warning = `Collision guard warning: ${conflictCount} subject(s) conflict with ${uniqueConflictingTests.length} test(s)`;
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
			this.participations = this.participations.filter((p) => {
				const windowEndMs = new Date(p.windowEndsAt).getTime();
				// Release any non-released participation whose window has ended.
				if (p.state !== "released" && windowEndMs <= nowMs) {
					count += 1;
					return false;
				}
				return true;
			});
			return count;
		});
	}

	async listByTest(testId: string): Promise<ExperimentParticipation[]> {
		return this.serialized(() =>
			this.participations
				.filter((p) => p.testId === testId)
				.map(deepCopyParticipation),
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
			let count = 0;
			for (const p of this.participations) {
				if (p.testId === testId && p.state !== "released") {
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
		return this.participations.map(deepCopyParticipation);
	}
}
