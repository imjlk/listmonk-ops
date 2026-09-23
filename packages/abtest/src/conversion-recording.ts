import { dirname, join } from "node:path";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	ConversionEventValidationError,
	JsonFileConversionEventStore,
	validateConversionEvent,
	type ConversionEventInput,
} from "./conversion-events";
import { loadStoredAbTests } from "./persistence";

const DEFAULT_ATTRIBUTION_WINDOW_HOURS = 72;
const ASSIGNMENT_PAGE_SIZE = 500;
const MAX_ASSIGNMENT_PAGES = 10_000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Resolve a test's recorded variant list without trusting caller attribution. */
export async function recordAbTestConversion(
	client: ListmonkClient,
	input: ConversionEventInput,
	storePath?: string,
): Promise<"created" | "duplicate"> {
	validateConversionEvent(input);
	const conversionPath = storePath === undefined
		? undefined
		: join(dirname(storePath), "abtest-conversions.json");
	const conversionStore = new JsonFileConversionEventStore(conversionPath);
	if (await conversionStore.hasEventId(input.eventId)) {
		return conversionStore.record(input);
	}
	const tests = await loadStoredAbTests(storePath);
	const test = tests.find((candidate) => candidate.id === input.testId);
	if (!test || test.pendingCreate || !test.provisionedAt) {
		throw new ConversionEventValidationError(
			`A/B test ${input.testId} is not provisioned`,
		);
	}
	const mapping = test.testListMappings.find(
		(candidate) => candidate.variantId === input.variantId,
	);
	if (!mapping) {
		throw new ConversionEventValidationError(
			`variant ${input.variantId} has no assignment list in test ${input.testId}`,
		);
	}
	const start = test.launchAt ?? test.startedAt;
	if (!start || !test.startedAt) {
		throw new ConversionEventValidationError(
			`A/B test ${input.testId} has not launched`,
		);
	}
	const startMs = new Date(start).getTime();
	const windowHours = test.hypothesis?.experimentScope.attributionWindowHours;
	let endMs: number;
	if (windowHours !== undefined) {
		endMs = startMs + windowHours * 3_600_000;
	} else if (test.endsAt !== undefined) {
		endMs = new Date(test.endsAt).getTime();
	} else {
		endMs = startMs + DEFAULT_ATTRIBUTION_WINDOW_HOURS * 3_600_000;
	}
	const occurredMs = new Date(input.occurredAt).getTime();
	if (occurredMs > Date.now() + MAX_CLOCK_SKEW_MS) {
		throw new ConversionEventValidationError(
			"event occurrence time is in the future",
		);
	}
	if (
		!Number.isFinite(startMs) ||
		!Number.isFinite(endMs) ||
		occurredMs < startMs ||
		occurredMs > endMs
	) {
		throw new ConversionEventValidationError(
			`event occurred outside the attribution window`,
		);
	}

	// Listmonk supports filtering subscriber pages by list ID. Check the actual
	// provisioned variant list, including disabled subscribers who may convert
	// after unsubscribing. An API failure must never be interpreted as absence.
	let assigned = false;
	for (let page = 1; page <= MAX_ASSIGNMENT_PAGES; page += 1) {
		const response = await client.subscriber.list({
			query: { list_id: [mapping.listId], page, per_page: ASSIGNMENT_PAGE_SIZE },
		});
		if ("error" in response && response.error !== undefined) {
			throw new ConversionEventValidationError(
				`Cannot verify variant assignment: ${String(response.error)}`,
			);
		}
		const subscribers = response.data?.results;
		if (!subscribers) {
			throw new ConversionEventValidationError(
				"Cannot verify variant assignment: missing subscriber results",
			);
		}
		if (subscribers.some(
			(subscriber) => subscriber.uuid === input.subscriberUuid,
		)) {
			assigned = true;
			break;
		}
		if (subscribers.length < ASSIGNMENT_PAGE_SIZE) break;
	}
	if (!assigned) {
		throw new ConversionEventValidationError(
			`subscriber ${input.subscriberUuid} is not assigned to variant ${input.variantId}`,
		);
	}

	return conversionStore.record(input);
}
