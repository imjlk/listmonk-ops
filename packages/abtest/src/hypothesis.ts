import { createHash } from "node:crypto";

/**
 * Hypothesis metadata for A/B test pre-registration.
 *
 * Implements the advanced experimentation followup's Change Set A: a test
 * can carry a structured hypothesis (objective, primary metric, expected
 * lift, owner, experiment scope) that is locked (checksummed) before
 * assignment manifest creation. After locking, the hypothesis cannot be
 * changed without discarding the existing manifest and provisioning.
 *
 * This prevents post-hoc hypothesis adjustment (p-hacking) and provides
 * a stable reference for experiment reports.
 */

export type ExpectedLift =
	| {
			kind: "relative";
			/** 0.10 = 10% relative lift over baseline. */
			value: number;
	  }
	| {
			kind: "absolute";
			value: number;
			unit: "percentage_point" | "currency_per_recipient";
	  };

export interface ExperimentOwner {
	/** Stable handle/ID within the organization. */
	id: string;
	displayName?: string;
}

export interface ExperimentScope {
	channel: "email";
	/**
	 * Dotted key identifying the experiment family, e.g.
	 * `onboarding.activation.day1`. Tests with the same family key
	 * and overlapping active windows are considered collisions.
	 */
	experimentFamilyKey: string;
	/** Hours after exposure during which conversions are attributed. */
	attributionWindowHours: number;
	/** Hours before/after the active window during which a subscriber
	 * is excluded from other experiments in the same family. */
	exclusionWindowHours: number;
}

export interface HypothesisMetadata {
	objective: string;
	hypothesis: string;
	primaryMetric: {
		type: "click_rate" | "conversion_rate" | "revenue_per_recipient";
		direction: "maximize" | "minimize";
	};
	expectedLift: ExpectedLift;
	owner: ExperimentOwner;
	experimentScope: ExperimentScope;
	createdAt: string;
	/** Set when the hypothesis is locked (pre-assignment). */
	lockedAt?: string;
	/** Canonical SHA-256 checksum computed at lock time. */
	checksum?: string;
}

export class HypothesisValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "HypothesisValidationError";
	}
}

/**
 * Strict ISO 8601 validation that rejects values `Date.parse` would silently
 * accept, including the year-zero string "0", localized formats like
 * "01/02/03", and overflowed calendar dates like "2026-02-30". The date
 * components are reconstructed and compared so overflow rolls over are caught.
 * Exported so the persistence boundary can reuse the same strict check.
 */
export function isStrictIsoTimestamp(value: unknown): boolean {
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
	// If a time component is present, ensure it parses (catches bad hours/minutes).
	if (parts.length > 1) {
		if (Number.isNaN(Date.parse(value))) return false;
	}
	return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate hypothesis metadata. When `strict` is true (launch/pre-registration),
 * all fields are required. When false (draft), missing fields are allowed.
 */
export function validateHypothesisMetadata(
	metadata: Partial<HypothesisMetadata>,
	strict: boolean = false,
): void {
	const require = (field: string, value: unknown): void => {
		if (strict && (value === undefined || value === null || value === "")) {
			throw new HypothesisValidationError(`${field} is required for launch`);
		}
	};

	require("objective", metadata.objective);
	require("hypothesis", metadata.hypothesis);
	require("primaryMetric", metadata.primaryMetric);
	require("expectedLift", metadata.expectedLift);
	require("owner", metadata.owner);
	require("experimentScope", metadata.experimentScope);
	require("createdAt", metadata.createdAt);

	if (metadata.objective !== undefined) {
		if (typeof metadata.objective !== "string" || metadata.objective.trim().length === 0) {
			throw new HypothesisValidationError(
				"objective must be a non-empty string",
			);
		}
	}
	if (metadata.hypothesis !== undefined) {
		if (typeof metadata.hypothesis !== "string" || metadata.hypothesis.trim().length === 0) {
			throw new HypothesisValidationError(
				"hypothesis must be a non-empty string",
			);
		}
	}
	if (metadata.createdAt !== undefined) {
		if (!isStrictIsoTimestamp(metadata.createdAt)) {
			throw new HypothesisValidationError(
				`createdAt must be a valid ISO 8601 timestamp, received ${JSON.stringify(metadata.createdAt)}`,
			);
		}
	}
	if (metadata.primaryMetric !== undefined) {
		const pm = metadata.primaryMetric;
		if (!isPlainObject(pm)) {
			throw new HypothesisValidationError(
				`primaryMetric must be an object, received ${JSON.stringify(pm)}`,
			);
		}
		const validTypes = [
			"click_rate",
			"conversion_rate",
			"revenue_per_recipient",
		];
		if (!validTypes.includes(pm.type)) {
			throw new HypothesisValidationError(
				`primaryMetric.type must be one of ${validTypes.join(", ")}, received ${JSON.stringify(pm.type)}`,
			);
		}
		if (pm.direction !== "maximize" && pm.direction !== "minimize") {
			throw new HypothesisValidationError(
				`primaryMetric.direction must be "maximize" or "minimize", received ${JSON.stringify(pm.direction)}`,
			);
		}
	}
	if (metadata.expectedLift !== undefined) {
		const lift = metadata.expectedLift;
		if (!isPlainObject(lift)) {
			throw new HypothesisValidationError(
				`expectedLift must be an object, received ${JSON.stringify(lift)}`,
			);
		}
		const rawKind = (lift as { kind?: unknown }).kind;
		if (rawKind !== "relative" && rawKind !== "absolute") {
			throw new HypothesisValidationError(
				`expectedLift.kind must be "relative" or "absolute", received ${JSON.stringify(rawKind)}`,
			);
		}
		if (typeof lift.value !== "number" || !Number.isFinite(
			lift.value,
		) || lift.value <= 0) {
			throw new HypothesisValidationError(
				`expectedLift.value must be finite and positive, received ${JSON.stringify(lift.value)}`,
			);
		}
		if (rawKind === "absolute") {
			const validUnits = ["percentage_point", "currency_per_recipient"];
			const unit = (lift as { unit?: unknown }).unit;
			if (typeof unit !== "string" || !validUnits.includes(unit)) {
				throw new HypothesisValidationError(
					`expectedLift.unit must be one of ${validUnits.join(", ")} for absolute lift, received ${JSON.stringify(unit)}`,
				);
			}
		}
	}
	// Couple absolute-lift units to the primary metric so the pre-registered
	// lift has an interpretable meaning. A click_rate / conversion_rate metric
	// may use percentage_point lift; a revenue_per_recipient metric must use
	// currency_per_recipient. Relative lift is unit-agnostic.
	if (
		metadata.primaryMetric !== undefined &&
		metadata.expectedLift !== undefined &&
		isPlainObject(metadata.expectedLift) &&
		(metadata.expectedLift as { kind?: unknown }).kind === "absolute"
	) {
		const metricType = metadata.primaryMetric.type;
		const unit = (metadata.expectedLift as { unit?: unknown }).unit;
		if (
			metricType === "revenue_per_recipient" &&
			unit !== "currency_per_recipient"
		) {
			throw new HypothesisValidationError(
				`revenue_per_recipient metric requires currency_per_recipient absolute lift, received ${JSON.stringify(unit)}`,
			);
		}
		if (
			(metricType === "click_rate" || metricType === "conversion_rate") &&
			unit !== "percentage_point"
		) {
			throw new HypothesisValidationError(
				`${metricType} metric requires percentage_point absolute lift, received ${JSON.stringify(unit)}`,
			);
		}
	}
	if (metadata.owner !== undefined) {
		const owner = metadata.owner;
		if (!isPlainObject(owner)) {
			throw new HypothesisValidationError(
				`owner must be an object, received ${JSON.stringify(owner)}`,
			);
		}
		if (typeof owner.id !== "string" || owner.id.trim().length === 0) {
			throw new HypothesisValidationError(
				"owner.id must be a non-empty string",
			);
		}
		if (
			owner.displayName !== undefined &&
			typeof owner.displayName !== "string"
		) {
			throw new HypothesisValidationError(
				`owner.displayName must be a string when present, received ${JSON.stringify(owner.displayName)}`,
			);
		}
	}
	if (metadata.experimentScope !== undefined) {
		const scope = metadata.experimentScope;
		if (!isPlainObject(scope)) {
			throw new HypothesisValidationError(
				`experimentScope must be an object, received ${JSON.stringify(scope)}`,
			);
		}
		if (scope.channel !== "email") {
			throw new HypothesisValidationError(
				`channel must be "email", received "${scope.channel}"`,
			);
		}
		if (typeof scope.experimentFamilyKey !== "string" || scope.experimentFamilyKey.trim().length === 0) {
			throw new HypothesisValidationError(
				"experimentScope.experimentFamilyKey must be a non-empty string",
			);
		}
		// Reject delimiter-only and empty-segment keys (".", "foo.", "foo..bar")
		// by requiring one or more alphanumeric segments joined by single
		// separators from [._-].
		if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(scope.experimentFamilyKey)) {
			throw new HypothesisValidationError(
				`experimentFamilyKey must be lowercase alphanumeric segments joined by [._-] separators (e.g. "onboarding.activation"), received "${scope.experimentFamilyKey}"`,
			);
		}
		if (
			typeof scope.attributionWindowHours !== "number" ||
			!Number.isFinite(scope.attributionWindowHours) ||
			scope.attributionWindowHours <= 0
		) {
			throw new HypothesisValidationError(
				`attributionWindowHours must be finite and positive, received ${JSON.stringify(scope.attributionWindowHours)}`,
			);
		}
		if (
			typeof scope.exclusionWindowHours !== "number" ||
			!Number.isFinite(scope.exclusionWindowHours) ||
			scope.exclusionWindowHours < 0
		) {
			throw new HypothesisValidationError(
				`exclusionWindowHours must be finite and non-negative, received ${JSON.stringify(scope.exclusionWindowHours)}`,
			);
		}
	}
}

/**
 * Recursively canonicalize a value for stable serialization:
 * - Plain objects have their keys sorted alphabetically.
 * - Arrays are preserved in order with each element canonicalized.
 * - Primitives are returned as-is.
 * This guarantees that two objects with the same content (in any key
 * order) produce identical JSON, which a flat `Object.keys(...).sort()`
 * array replacer cannot do because JSON.stringify applies the replacer
 * recursively and would drop nested keys not present in the top-level
 * allowlist.
 */
function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(canonicalize);
	}
	if (value !== null && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(obj).sort()) {
			sorted[key] = canonicalize(obj[key]);
		}
		return sorted;
	}
	return value;
}

/**
 * Compute a canonical SHA-256 checksum for a HypothesisMetadata object.
 * The checksum excludes `lockedAt` and `checksum` themselves so the
 * same content always produces the same hash. Nested fields
 * (primaryMetric, expectedLift, owner, experimentScope) are recursively
 * canonicalized so any change to them invalidates the checksum.
 */
export function computeHypothesisChecksum(
	metadata: HypothesisMetadata,
): string {
	const canonical = canonicalize({
		objective: metadata.objective,
		hypothesis: metadata.hypothesis,
		primaryMetric: metadata.primaryMetric,
		expectedLift: metadata.expectedLift,
		owner: { id: metadata.owner.id, displayName: metadata.owner.displayName },
		experimentScope: metadata.experimentScope,
		createdAt: metadata.createdAt,
	}) as Record<string, unknown>;
	const json = JSON.stringify(canonical);
	return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * Lock a hypothesis by computing its checksum and setting lockedAt.
 * Returns a new object with checksum and lockedAt populated.
 * Throws if the hypothesis is already locked or if the supplied lock
 * timestamp override is not a valid ISO 8601 string.
 */
export function lockHypothesis(
	metadata: HypothesisMetadata,
	lockedAt: string = new Date().toISOString(),
): HypothesisMetadata {
	if (metadata.lockedAt) {
		throw new HypothesisValidationError(
			"Hypothesis is already locked; create a new test revision to change it",
		);
	}
	// Validate the primary metadata first so domain errors surface before
	// the timestamp override check; the lockedAt override is secondary input.
	validateHypothesisMetadata(metadata, true);
	if (!isStrictIsoTimestamp(lockedAt)) {
		throw new HypothesisValidationError(
			`lockedAt override must be a valid ISO 8601 timestamp, received ${JSON.stringify(lockedAt)}`,
		);
	}
	const checksum = computeHypothesisChecksum(metadata);
	// Deep-clone so nested objects (primaryMetric, expectedLift, owner,
	// experimentScope) are detached from the caller's references. This
	// prevents post-lock mutation of the caller's object from silently
	// invalidating the stored checksum.
	return structuredClone({ ...metadata, lockedAt, checksum });
}

/**
 * Verify that a locked hypothesis has not been tampered with.
 * Returns true if the stored checksum matches the recomputed checksum.
 */
export function verifyHypothesisChecksum(metadata: HypothesisMetadata): boolean {
	if (!metadata.checksum || !metadata.lockedAt) {
		return false;
	}
	const recomputed = computeHypothesisChecksum(metadata);
	return recomputed === metadata.checksum;
}
