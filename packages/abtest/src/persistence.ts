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
import { createAbTestExecutors, type AbTestExecutors } from "./factory";
import type { AbTest } from "./types";

const ABTEST_STATUSES = new Set<AbTest["status"]>([
	"draft",
	"testing",
	"running",
	"analyzing",
	"deploying",
	"completed",
	"cancelled",
]);
const METRIC_TYPES = new Set([
	"open_rate",
	"click_rate",
	"conversion",
	"revenue",
	"custom",
]);

export interface AbTestStore {
	version: 1;
	tests: AbTest[];
}

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

export class AbTestNotFoundError extends Error {
	constructor(testId: string) {
		super(`Test with ID ${testId} not found`);
		this.name = "AbTestNotFoundError";
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
			typeof value.winnerVariantId === "string")
	);
}

function parseAbTestStore(value: unknown): AbTestStore {
	if (!isRecord(value) || value.version !== 1) {
		throw new Error("Invalid A/B test store: expected schema version 1");
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

	return value as unknown as AbTestStore;
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
): JsonFileStore<AbTestStore> {
	return {
		path: storePath,
		createDefault: () => ({ version: 1, tests: [] }),
		parse: parseAbTestStore,
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
		version: 1,
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
					version: 1,
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
