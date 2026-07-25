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
	if (metadata.expectedLift !== undefined) {
		if (!Number.isFinite(
			metadata.expectedLift.value,
		) || metadata.expectedLift.value <= 0) {
			throw new HypothesisValidationError(
				`expectedLift.value must be finite and positive, received ${metadata.expectedLift.value}`,
			);
		}
	}
	if (metadata.owner !== undefined) {
		if (!metadata.owner.id || metadata.owner.id.trim().length === 0) {
			throw new HypothesisValidationError(
				"owner.id must be a non-empty string",
			);
		}
	}
	if (metadata.experimentScope !== undefined) {
		const scope = metadata.experimentScope;
		if (scope.channel !== "email") {
			throw new HypothesisValidationError(
				`channel must be "email", received "${scope.channel}"`,
			);
		}
		if (!scope.experimentFamilyKey || scope.experimentFamilyKey.trim().length === 0) {
			throw new HypothesisValidationError(
				"experimentScope.experimentFamilyKey must be a non-empty string",
			);
		}
		if (!scope.experimentFamilyKey.match(/^[a-z0-9._-]+$/)) {
			throw new HypothesisValidationError(
				`experimentFamilyKey must match [a-z0-9._-]+, received "${scope.experimentFamilyKey}"`,
			);
		}
		if (
			!Number.isFinite(scope.attributionWindowHours) ||
			scope.attributionWindowHours <= 0
		) {
			throw new HypothesisValidationError(
				`attributionWindowHours must be finite and positive, received ${scope.attributionWindowHours}`,
			);
		}
		if (
			!Number.isFinite(scope.exclusionWindowHours) ||
			scope.exclusionWindowHours < 0
		) {
			throw new HypothesisValidationError(
				`exclusionWindowHours must be finite and non-negative, received ${scope.exclusionWindowHours}`,
			);
		}
	}
}

/**
 * Compute a canonical SHA-256 checksum for a HypothesisMetadata object.
 * The checksum excludes `lockedAt` and `checksum` themselves so the
 * same content always produces the same hash.
 */
export function computeHypothesisChecksum(
	metadata: HypothesisMetadata,
): string {
	const canonical = {
		objective: metadata.objective,
		hypothesis: metadata.hypothesis,
		primaryMetric: metadata.primaryMetric,
		expectedLift: metadata.expectedLift,
		owner: { id: metadata.owner.id, displayName: metadata.owner.displayName },
		experimentScope: metadata.experimentScope,
		createdAt: metadata.createdAt,
	};
	const json = JSON.stringify(canonical, Object.keys(canonical).sort());
	return createHash("sha256").update(json, "utf8").digest("hex");
}

/**
 * Lock a hypothesis by computing its checksum and setting lockedAt.
 * Returns a new object with checksum and lockedAt populated.
 * Throws if the hypothesis is already locked.
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
	validateHypothesisMetadata(metadata, true);
	const checksum = computeHypothesisChecksum(metadata);
	return { ...metadata, lockedAt, checksum };
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
