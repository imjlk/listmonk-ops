import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	ConversionEventValidationError,
	getAbTestAttributionDeadline,
	SqliteConversionEventStore,
	resolveConversionStorePath,
	validateConversionEvent,
	type ConversionEventInput,
} from "./conversion-events";
import { withStoredAbTestExecutors } from "./persistence";
import type { AbTest } from "./types";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const ASSIGNMENT_LOOKUP_TIMEOUT_MS = 30_000;
export const SUBSCRIBER_UUID_PATTERN = /^[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;

async function verifyVariantAssignment(
	client: ListmonkClient,
	listId: number,
	subscriberUuid: string,
): Promise<boolean> {
	if (!SUBSCRIBER_UUID_PATTERN.test(subscriberUuid)) {
		throw new ConversionEventValidationError("subscriberUuid must be a UUID");
	}
	// Listmonk 6.2 accepts a SQL expression alongside list_id. The UUID
	// pattern limits this expression to hexadecimal digits and hyphens.
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(),
		ASSIGNMENT_LOOKUP_TIMEOUT_MS,
	);
	let response: Awaited<ReturnType<typeof client.subscriber.list>>;
	try {
		response = await client.subscriber.list({
			query: {
				list_id: [listId],
				query: `uuid = '${subscriberUuid}'`,
				page: 1,
				per_page: 2,
			},
			signal: controller.signal,
		} as Parameters<typeof client.subscriber.list>[0] & { signal: AbortSignal });
	} catch (error) {
		throw new ConversionEventValidationError(
			`Cannot verify variant assignment: ${error instanceof Error ? error.message : String(error)}`,
		);
	} finally {
		clearTimeout(timeout);
	}
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
	return subscribers.some((subscriber) =>
		typeof subscriber.uuid === "string" &&
		subscriber.uuid.toLowerCase() === subscriberUuid,
	);
}

function assertAttributionWindow(test: AbTest, occurredAt: string): void {
	const start = test.launchAt ?? test.startedAt;
	if (
		!start ||
		!test.startedAt ||
		test.status === "draft" ||
		test.status === "testing" ||
		test.status === "failed"
	) {
		throw new ConversionEventValidationError(
			`A/B test ${test.id} has not launched`,
		);
	}
	const startMs = new Date(start).getTime();
	const endMs = getAbTestAttributionDeadline(test);
	const occurredMs = new Date(occurredAt).getTime();
	if (endMs !== undefined && Date.now() > endMs) {
		throw new ConversionEventValidationError(
			"A/B test attribution window has closed for new conversions",
		);
	}
	if (occurredMs > Date.now() + MAX_CLOCK_SKEW_MS) {
		throw new ConversionEventValidationError(
			"event occurrence time is in the future",
		);
	}
	if (
		!Number.isFinite(startMs) ||
		endMs === undefined ||
		!Number.isFinite(endMs) ||
		occurredMs < startMs ||
		occurredMs > endMs
	) {
		throw new ConversionEventValidationError(
			"event occurred outside the attribution window",
		);
	}
}

/** Resolve a test's recorded variant list without trusting caller attribution. */
export async function recordAbTestConversion(
	client: ListmonkClient,
	input: ConversionEventInput,
	storePath?: string,
): Promise<"created" | "duplicate"> {
	const normalizedInput = {
		...input,
		event: typeof input.event === "string" ? input.event.trim() : input.event,
		subscriberUuid: typeof input.subscriberUuid === "string"
			? input.subscriberUuid.toLowerCase()
			: input.subscriberUuid,
	};
	validateConversionEvent(normalizedInput);
	const conversionStore = new SqliteConversionEventStore(
		resolveConversionStorePath(storePath),
	);
	if (await conversionStore.hasEventId(normalizedInput.eventId)) {
		return conversionStore.record(normalizedInput);
	}
	// The A/B lock fences delete and lifecycle transitions while the remote
	// point lookup and conversion append run. Lock order is A/B then conversion.
	return withStoredAbTestExecutors(
		client,
		{ mode: "write", storePath },
		async (executors) => {
			if (await conversionStore.hasEventId(normalizedInput.eventId)) {
				return conversionStore.record(normalizedInput);
			}
			const test = await executors.abTestService.getTest(normalizedInput.testId);
			if (!test || test.pendingCreate) {
				throw new ConversionEventValidationError(
					`A/B test ${normalizedInput.testId} is not provisioned`,
				);
			}
			const mapping = test.testListMappings.find(
				(candidate) => candidate.variantId === normalizedInput.variantId,
			);
			if (!mapping) {
				throw new ConversionEventValidationError(
					`variant ${normalizedInput.variantId} has no assignment list in test ${normalizedInput.testId}`,
				);
			}
			assertAttributionWindow(test, normalizedInput.occurredAt);
			if (!await verifyVariantAssignment(client, mapping.listId, normalizedInput.subscriberUuid)) {
				throw new ConversionEventValidationError(
					`subscriber ${normalizedInput.subscriberUuid} is not assigned to variant ${normalizedInput.variantId}`,
				);
			}
			assertAttributionWindow(test, normalizedInput.occurredAt);
			return conversionStore.record(normalizedInput);
		},
	);
}
