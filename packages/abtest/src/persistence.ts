import { homedir } from "node:os";
import { join } from "node:path";

import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	updateJsonFileStore,
	writeJsonFileStore,
} from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { AbTestNotFoundError } from "./errors";
import { createAbTestExecutors, type AbTestExecutors } from "./factory";
import { isStrictIsoTimestamp, verifyHypothesisChecksum } from "./hypothesis";
import type { AbTest } from "./types";

export { AbTestNotFoundError } from "./errors";

const ABTEST_STORE_LOCK_TIMEOUT_MS = 120_000;
const ABTEST_STATUSES = new Set<AbTest["status"]>([
	"draft",
	"testing",
	"scheduled",
	"running",
	"analyzing",
	"deploying",
	"cancelling",
	"completed",
	"inconclusive",
	"cancelled",
	"failed",
]);
const METRIC_TYPES = new Set([
	"open_rate",
	"click_rate",
	"conversion",
	"revenue",
	"custom",
]);

/**
 * On-disk document shape for the persisted A/B test store.
 *
 * Version 1 is the original shape (no deterministic-provisioning fields).
 * Version 2 adds the optional provisioning fields on AbTest
 * (assignmentSeed, audienceSnapshot, assignmentManifest, revision) and is
 * written by every new write. A version 1 document is read transparently:
 * the v1 tests are re-validated and the next successful write upgrades the
 * document to version 2 without re-splitting any audience.
 */
export interface StoredAbTestDocument {
	version: 2;
	tests: AbTest[];
}

/**
 * Backward-compatible alias for the persisted document shape. Callers that
 * imported `AbTestStore` continue to compile; the canonical name is now
 * `StoredAbTestDocument`.
 */
export type AbTestStore = StoredAbTestDocument;

export interface StoredAbTestAccessOptions {
	mode: "read" | "write";
	storePath?: string;
}

export class AbTestWriteTransactionError extends Error {
	constructor(message: string, cause: unknown) {
		super(message, { cause });
		this.name = "AbTestWriteTransactionError";
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidTimestamp(value: unknown): boolean {
	return (
		typeof value === "string" && !Number.isNaN(new Date(value).getTime())
	);
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isPercentage(value: unknown): value is number {
	return isFiniteNumber(value) && value > 0 && value <= 100;
}

function isNonNegativeNumber(value: unknown): value is number {
	return isFiniteNumber(value) && value >= 0;
}

function isConfidenceThreshold(value: unknown): value is number {
	// Accept (0, 1] on read so legacy v1 stores that persisted exactly 1.0
	// remain loadable. The parse step normalizes 1.0 to 0.99 so analysis-time
	// validation (which requires (0, 1)) never sees the invalid value. New
	// writes come from CreateAbTestCommand which defaults to 0.95.
	return isFiniteNumber(value) && value > 0 && value <= 1;
}

function isStoredVariant(value: unknown): boolean {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.name !== "string" ||
		!isPercentage(value.percentage) ||
		!isRecord(value.contentOverrides)
	) {
		return false;
	}

	const overrides = value.contentOverrides;
	return (
		(overrides.subject === undefined || typeof overrides.subject === "string") &&
		(overrides.body === undefined || typeof overrides.body === "string") &&
		(overrides.sendTime === undefined || isValidTimestamp(
			overrides.sendTime,
		)) &&
		(overrides.senderName === undefined ||
			typeof overrides.senderName === "string") &&
		(overrides.senderEmail === undefined ||
			typeof overrides.senderEmail === "string")
	);
}

function areStoredVariantsValid(value: unknown): boolean {
	if (
		!Array.isArray(value) ||
		value.length < 2 ||
		value.length > 3 ||
		!value.every(isStoredVariant)
	) {
		return false;
	}

	const variants = value as Array<{ id: string; percentage: number }>;
	const uniqueIds = new Set(variants.map((variant) => variant.id));
	const totalPercentage = variants.reduce(
		(sum, variant) => sum + variant.percentage,
		0,
	);
	return (
		uniqueIds.size === variants.length &&
		Math.abs(totalPercentage - 100) <= 0.01
	);
}

function isStoredMetric(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		typeof value.type === "string" &&
		METRIC_TYPES.has(value.type) &&
		(value.config === undefined || isRecord(value.config))
	);
}

function isStoredBaseConfig(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.subject === "string" &&
		typeof value.body === "string" &&
		Array.isArray(value.lists) &&
		value.lists.every(isPositiveInteger) &&
		(value.template_id === undefined || isPositiveInteger(value.template_id))
	);
}

function isStoredCampaignMapping(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.variantId === "string" &&
		isPositiveInteger(value.campaignId)
	);
}

function isStoredListMapping(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.variantId === "string" &&
		isPositiveInteger(value.listId)
	);
}

function isStoredAbTest(value: unknown): boolean {
	return (
		isRecord(value) &&
		typeof value.id === "string" &&
		typeof value.name === "string" &&
		typeof value.campaignId === "string" &&
		typeof value.status === "string" &&
		ABTEST_STATUSES.has(value.status as AbTest["status"]) &&
		isValidTimestamp(value.createdAt) &&
		isValidTimestamp(value.updatedAt) &&
		areStoredVariantsValid(value.variants) &&
		Array.isArray(value.metrics) &&
		value.metrics.every(isStoredMetric) &&
		isStoredBaseConfig(value.baseConfig) &&
		(value.testingMode === "holdout" || value.testingMode === "full-split") &&
		isPercentage(value.testGroupPercentage) &&
		isNonNegativeNumber(value.testGroupSize) &&
		isNonNegativeNumber(value.holdoutGroupSize) &&
		isConfidenceThreshold(value.confidenceThreshold) &&
		typeof value.autoDeployWinner === "boolean" &&
		Array.isArray(value.campaignMappings) &&
		value.campaignMappings.every(isStoredCampaignMapping) &&
		Array.isArray(value.testListMappings) &&
		value.testListMappings.every(isStoredListMapping) &&
		(value.holdoutListId === undefined ||
			isPositiveInteger(value.holdoutListId)) &&
		(value.winnerCampaignId === undefined ||
			isPositiveInteger(value.winnerCampaignId)) &&
		(value.winnerVariantId === undefined ||
			typeof value.winnerVariantId === "string") &&
		// Stage 2 provisioning fields: optional, but validated when present.
		(value.assignmentSeed === undefined ||
			typeof value.assignmentSeed === "string") &&
		(value.audienceSnapshot === undefined ||
			isStoredAudienceSnapshot(value.audienceSnapshot)) &&
		(value.assignmentManifest === undefined ||
			isStoredAssignmentManifest(value.assignmentManifest)) &&
		(value.revision === undefined || isNonNegativeInteger(value.revision)) &&
		// Stage 3 orchestration fields: optional, validated when present.
		(value.durationHours === undefined ||
			(isFiniteNumber(value.durationHours) && value.durationHours > 0)) &&
		(value.launchAt === undefined || isValidTimestamp(value.launchAt)) &&
		(value.startedAt === undefined || isValidTimestamp(value.startedAt)) &&
		(value.endsAt === undefined || isValidTimestamp(value.endsAt)) &&
		(value.minimumTestSampleSize === undefined ||
			isPositiveInteger(value.minimumTestSampleSize)) &&
		(value.assignmentProvenance === undefined ||
			value.assignmentProvenance === "manifest_v1" ||
			value.assignmentProvenance === "legacy_unavailable") &&
		// Pre-registration hypothesis: optional, but the nested shape and the
		// locked-state checksum invariant are validated when present so that
		// loadStoredAbTests never hydrates malformed or tampered metadata.
		(value.hypothesis === undefined || isStoredHypothesis(value.hypothesis)) &&
		// When BOTH a manifest and a hypothesis are present, the hypothesis
		// must be locked. This enforces the pre-registration guarantee for new
		// records without retroactively rejecting legacy v2 records that carry
		// a manifest but predate hypothesis pre-registration.
		(value.assignmentManifest === undefined ||
			value.hypothesis === undefined ||
			(isRecord(value.hypothesis) &&
				value.hypothesis.lockedAt !== undefined &&
				isStoredHypothesis(value.hypothesis))) &&
		// Stratification quota matrix: optional, structurally validated when
		// present so corrupt state (negative quotas, malformed cells) is
		// rejected at the file boundary.
		(value.stratification === undefined ||
			isStoredStratification(value.stratification))
	);
}

/**
 * Validate a persisted stratification quota matrix. Requires non-negative
 * quotas and ideals, and that every cell references a known stratum/group.
 */
function isStoredStratification(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	const quotas = value.quotas;
	const cells = value.cells;
	const stratumSizes = value.stratumSizes;
	if (!isRecord(quotas) || !Array.isArray(cells) || !isRecord(stratumSizes)) {
		return false;
	}
	// Every quota row must map group keys to non-negative finite numbers.
	for (const row of Object.values(quotas)) {
		if (!isRecord(row)) return false;
		for (const n of Object.values(row)) {
			if (
				typeof n !== "number" ||
				!Number.isFinite(n) ||
				n < 0 ||
				!Number.isInteger(n)
			) {
				return false;
			}
		}
	}
	// stratumSizes must be non-negative integers.
	for (const n of Object.values(stratumSizes)) {
		if (
			typeof n !== "number" ||
			!Number.isFinite(n) ||
			n < 0 ||
			!Number.isInteger(n)
		) {
			return false;
		}
	}
	// Each cell must have the required shape with non-negative values, and
	// must reference a known stratum/group and agree with the quotas matrix.
	const seenCells = new Set<string>();
	for (const cell of cells) {
		if (
			!isRecord(cell) ||
			typeof cell.stratumKey !== "string" ||
			typeof cell.groupKey !== "string" ||
			typeof cell.quota !== "number" ||
			!Number.isFinite(cell.quota) ||
			cell.quota < 0 ||
			!Number.isInteger(cell.quota) ||
			typeof cell.ideal !== "number" ||
			!Number.isFinite(cell.ideal) ||
			cell.ideal < 0
		) {
			return false;
		}
		// Reject cells referencing unknown strata/groups.
		if (
			!(cell.stratumKey in quotas) ||
			!(cell.stratumKey in stratumSizes)
		) {
			return false;
		}
		const row = quotas[cell.stratumKey];
		if (!isRecord(row) || !(cell.groupKey in row)) {
			return false;
		}
		// Reject cells whose quota disagrees with the quotas matrix.
		if (row[cell.groupKey] !== cell.quota) {
			return false;
		}
		// Reject duplicate cells.
		const cellKey = `${cell.stratumKey}:${cell.groupKey}`;
		if (seenCells.has(cellKey)) return false;
		seenCells.add(cellKey);
	}
	// Every quota row must sum to its stratum size.
	for (const [sk, row] of Object.entries(quotas)) {
		if (!isRecord(row)) return false;
		const rowSum = Object.values(row).reduce<number>(
			(sum, n) => sum + (typeof n === "number" ? n : 0),
			0,
		);
		const expected = stratumSizes[sk];
		if (typeof expected !== "number" || rowSum !== expected) {
			return false;
		}
	}
	// Every stratum in stratumSizes must have a corresponding quota row.
	for (const sk of Object.keys(stratumSizes)) {
		if (!(sk in quotas)) return false;
	}
	// Every quota matrix entry must have a matching cell (no truncated cells).
	for (const [sk, row] of Object.entries(quotas)) {
		if (!isRecord(row)) return false;
		for (const gk of Object.keys(row)) {
			if (!seenCells.has(`${sk}:${gk}`)) return false;
		}
	}
	return true;
}

const HYPOTHESIS_METRIC_TYPES = new Set([
	"click_rate",
	"conversion_rate",
	"revenue_per_recipient",
]);
const HYPOTHESIS_DIRECTIONS = new Set(["maximize", "minimize"]);
const HYPOTHESIS_ABSOLUTE_UNITS = new Set([
	"percentage_point",
	"currency_per_recipient",
]);

/**
 * Validate a persisted hypothesis record. Mirrors the runtime validation in
 * hypothesis.ts but as a structural guard so loadStoredAbTests rejects
 * malformed or tampered metadata before it reaches launch/report code.
 * When lockedAt is present, checksum must also be present and match the
 * recomputed canonical checksum.
 */
function isStoredHypothesis(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	if (typeof value.objective !== "string" || value.objective.trim() === "") {
		return false;
	}
	if (typeof value.hypothesis !== "string" || value.hypothesis.trim() === "") {
		return false;
	}
	if (!isStrictIsoTimestamp(value.createdAt)) {
		return false;
	}
	// primaryMetric
	const pm = value.primaryMetric;
	if (
		!isRecord(pm) ||
		typeof pm.type !== "string" ||
		!HYPOTHESIS_METRIC_TYPES.has(pm.type) ||
		typeof pm.direction !== "string" ||
		!HYPOTHESIS_DIRECTIONS.has(pm.direction)
	) {
		return false;
	}
	// expectedLift discriminated union
	const lift = value.expectedLift;
	if (!isRecord(lift)) {
		return false;
	}
	if (lift.kind === "relative") {
		if (
			typeof lift.value !== "number" ||
			!Number.isFinite(lift.value) ||
			lift.value <= 0
		) {
			return false;
		}
	} else if (lift.kind === "absolute") {
		if (
			typeof lift.value !== "number" ||
			!Number.isFinite(lift.value) ||
			lift.value <= 0 ||
			typeof lift.unit !== "string" ||
			!HYPOTHESIS_ABSOLUTE_UNITS.has(lift.unit)
		) {
			return false;
		}
	} else {
		return false;
	}
	// metric/unit coupling for absolute lifts
	if (
		lift.kind === "absolute" &&
		typeof lift.unit === "string" &&
		typeof pm.type === "string"
	) {
		if (pm.type === "revenue_per_recipient" && lift.unit !== "currency_per_recipient") {
			return false;
		}
		if (
			(pm.type === "click_rate" || pm.type === "conversion_rate") &&
			lift.unit !== "percentage_point"
		) {
			return false;
		}
	}
	// owner
	const owner = value.owner;
	if (
		!isRecord(owner) ||
		typeof owner.id !== "string" ||
		owner.id.trim() === "" ||
		(owner.displayName !== undefined && typeof owner.displayName !== "string")
	) {
		return false;
	}
	// experimentScope
	const scope = value.experimentScope;
	if (
		!isRecord(scope) ||
		scope.channel !== "email" ||
		typeof scope.experimentFamilyKey !== "string" ||
		// Mirror the runtime segment rules so load-time validation is at least
		// as strict as creation-time validation.
		!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(scope.experimentFamilyKey) ||
		typeof scope.attributionWindowHours !== "number" ||
		!Number.isFinite(scope.attributionWindowHours) ||
		scope.attributionWindowHours <= 0 ||
		typeof scope.exclusionWindowHours !== "number" ||
		!Number.isFinite(scope.exclusionWindowHours) ||
		scope.exclusionWindowHours < 0
	) {
		return false;
	}
	// locked-state invariant: when lockedAt is present the checksum must be a
	// 64-character hex string AND must cryptographically match the recomputed
	// canonical checksum, so tampered records are rejected at load time.
	if (value.lockedAt !== undefined) {
		if (!isStrictIsoTimestamp(value.lockedAt)) {
			return false;
		}
		if (
			typeof value.checksum !== "string" ||
			value.checksum.length !== 64 ||
			// The record has been structurally validated above; verify the
			// checksum cryptographically rejects tampered locked hypotheses.
			!verifyHypothesisChecksum(
				value as unknown as Parameters<typeof verifyHypothesisChecksum>[0],
			)
		) {
			return false;
		}
	}
	return true;
}

function isNonNegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStoredAudienceSnapshot(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	return (
		typeof value.capturedAt === "string" &&
		Array.isArray(value.sourceListIds) &&
		value.sourceListIds.every(
			(id): id is number => typeof id === "number" && Number.isInteger(id),
		) &&
		typeof value.subscriberCount === "number" &&
		Number.isInteger(value.subscriberCount) &&
		value.subscriberCount >= 0 &&
		typeof value.subscriberChecksum === "string" &&
		value.eligibilityPolicyVersion === 1
	);
}

function isStoredAssignmentManifest(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	return (
		value.algorithm === "sha256-order-largest-remainder-v1" &&
		typeof value.seed === "string" &&
		typeof value.audienceChecksum === "string" &&
		Array.isArray(value.groups) &&
		value.groups.every(isStoredAssignmentGroup) &&
		typeof value.assignedCount === "number" &&
		Number.isInteger(value.assignedCount) &&
		value.assignedCount >= 0
	);
}

function isStoredAssignmentGroup(value: unknown): boolean {
	if (!isRecord(value)) {
		return false;
	}
	return (
		(value.kind === "variant" || value.kind === "holdout") &&
		(value.variantId === undefined || typeof value.variantId === "string") &&
		typeof value.expectedCount === "number" &&
		Number.isInteger(value.expectedCount) &&
		value.expectedCount >= 0 &&
		typeof value.subscriberChecksum === "string"
	);
}

function parseAbTestStore(value: unknown): StoredAbTestDocument {
	if (!isRecord(value)) {
		throw new Error("Invalid A/B test store: expected an object");
	}
	// Accept version 1 (legacy) and version 2 (current). v1 is transparently
	// upgraded: the optional provisioning fields stay undefined, and the next
	// successful write persists version 2. An unknown future version is
	// rejected so a newer writer does not silently overwrite an older
	// reader's data.
	if (value.version !== 1 && value.version !== 2) {
		throw new Error(
			`Invalid A/B test store: unsupported schema version ${String(
				value.version,
			)} (expected 1 or 2)`,
		);
	}
	if (!Array.isArray(value.tests)) {
		throw new Error("Invalid A/B test store: tests must be an array");
	}
	for (const [index, test] of value.tests.entries()) {
		if (!isStoredAbTest(test)) {
			throw new Error(
				`Invalid A/B test store: test ${index} failed schema validation`,
			);
		}
	}

	return {
		// Always upgrade to version 2 on read; the next write persists it.
		version: 2,
		tests: (value.tests as unknown as AbTest[]).map((test) => ({
			...test,
			// Normalize a legacy confidenceThreshold of exactly 1.0 (which
			// analyzeStatisticalSignificance rejects) to 0.99 so the read
			// remains backward-compatible with v1 stores that allowed it.
			confidenceThreshold:
				test.confidenceThreshold >= 1
					? 0.99
					: test.confidenceThreshold,
			createdAt: new Date(test.createdAt),
			updatedAt: new Date(test.updatedAt),
			variants: test.variants.map((variant) => ({
				...variant,
				contentOverrides: {
					...variant.contentOverrides,
					sendTime: variant.contentOverrides.sendTime
						? new Date(variant.contentOverrides.sendTime)
						: undefined,
				},
			})),
		})),
	};
}

export function getAbTestStorePath(): string {
	const overriddenPath = process.env.LISTMONK_OPS_ABTEST_STORE?.trim();
	return (
		overriddenPath ||
		join(homedir(), ".listmonk-ops", "abtests.json")
	);
}

function createAbTestStore(
	storePath = getAbTestStorePath(),
): JsonFileStore<StoredAbTestDocument> {
	return {
		path: storePath,
		createDefault: () => ({ version: 2, tests: [] }),
		parse: parseAbTestStore,
		lock: { timeoutMs: ABTEST_STORE_LOCK_TIMEOUT_MS },
	};
}

export async function loadStoredAbTests(
	storePath = getAbTestStorePath(),
): Promise<AbTest[]> {
	return (await readJsonFileStore(createAbTestStore(storePath))).tests;
}

export async function validateStoredAbTestStore(
	storePath = getAbTestStorePath(),
): Promise<void> {
	await readJsonFileStore(createAbTestStore(storePath));
}

export async function saveStoredAbTests(
	tests: AbTest[],
	storePath = getAbTestStorePath(),
): Promise<void> {
	await writeJsonFileStore(createAbTestStore(storePath), {
		version: 2,
		tests,
	});
}

function createHydratedExecutors(
	client: ListmonkClient,
	tests: AbTest[],
): AbTestExecutors {
	const executors = createAbTestExecutors(client);
	executors.abTestService.hydrateTests(tests);
	return executors;
}

export async function withStoredAbTestExecutors<Result>(
	client: ListmonkClient,
	options: StoredAbTestAccessOptions,
	action: (executors: AbTestExecutors) => Promise<Result> | Result,
): Promise<Result> {
	const store = createAbTestStore(options.storePath);
	if (options.mode === "read") {
		const persisted = await readJsonFileStore(store);
		return action(createHydratedExecutors(client, persisted.tests));
	}

	let actionStarted = false;
	let actionCompleted = false;
	try {
		return await updateJsonFileStore(store, async (persisted) => {
			const executors = createHydratedExecutors(client, persisted.tests);
			actionStarted = true;
			const result = await action(executors);
			actionCompleted = true;
			return commitJsonFileStoreUpdate(
				{
					version: 2,
					tests: executors.abTestService.snapshotTests(),
				},
				result,
			);
		});
	} catch (error) {
		if (error instanceof AbTestNotFoundError) {
			throw error;
		}
		if (!actionStarted) {
			throw error;
		}

		const causeMessage = error instanceof Error ? error.message : String(error);
		const guidance = actionCompleted
			? "The A/B test operation completed, but its local state could not be confirmed. Inspect Listmonk and the state file before retrying."
			: "The A/B test operation failed before local state was committed. Listmonk may contain partial changes; inspect remote resources before retrying.";
		throw new AbTestWriteTransactionError(
			`${guidance} Cause: ${causeMessage}`,
			error,
		);
	}
}
