import { getListmonkDataDirectory } from "@listmonk-ops/common";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	updateJsonFileStore,
	type JsonFileStore,
} from "@listmonk-ops/common";
import { dirname, join } from "node:path";

/**
 * Transport-neutral conversion event store for A/B test attribution.
 *
 * Records conversion events (purchases, signups, etc.) attributed to
 * specific variant assignments. PII (email, name) is never stored —
 * only subscriber UUID for attribution matching.
 *
 * The file store enforces event-ID idempotency and validates the event shape.
 * The shared recording operation verifies assignment and attribution window
 * before inserting a new event.
 */

export interface ConversionEventInput {
	/** Unique event identifier for idempotency. */
	eventId: string;
	testId: string;
	variantId: string;
	/** Subscriber UUID — checked against the provisioned variant list. */
	subscriberUuid: string;
	/** Event name (e.g., "purchase", "signup"). */
	event: string;
	/** Monetary value (optional, for revenue tracking). */
	value?: number;
	/** ISO 4217 currency code (required when value is set). */
	currency?: string;
	/** ISO timestamp of the event. */
	occurredAt: string;
}

export interface VariantConversionAggregate {
	variantId: string;
	totalEvents: number;
	uniqueSubscribers: number;
	totalValue: number;
	currency?: string;
}

export interface ConversionEventStore {
	record(input: ConversionEventInput): Promise<"created" | "duplicate">;
	aggregate(testId: string): Promise<VariantConversionAggregate[]>;
}

interface StoredConversionEvents {
	version: 1;
	events: ConversionEventInput[];
}

function parseStoredConversionEvents(value: unknown): StoredConversionEvents {
	if (
		typeof value !== "object" ||
		value === null ||
		!("version" in value) ||
		value.version !== 1 ||
		!("events" in value) ||
		!Array.isArray(value.events)
	) {
		throw new ConversionEventValidationError("Invalid conversion event store");
	}
	const events: ConversionEventInput[] = [];
	const eventIds = new Set<string>();
	for (const raw of value.events) {
		if (typeof raw !== "object" || raw === null) {
			throw new ConversionEventValidationError(
				"Invalid stored conversion event",
			);
		}
		const event = raw as ConversionEventInput;
		validateConversionEvent(event);
		if (eventIds.has(event.eventId)) {
			throw new ConversionEventValidationError(
				`Duplicate stored eventId: ${event.eventId}`,
			);
		}
		eventIds.add(event.eventId);
		events.push(sanitizeConversionEvent(event));
	}
	return { version: 1, events };
}

function sanitizeConversionEvent(input: ConversionEventInput): ConversionEventInput {
	return {
		eventId: input.eventId,
		testId: input.testId,
		variantId: input.variantId,
		subscriberUuid: input.subscriberUuid,
		event: input.event,
		...(input.value === undefined ? {} : { value: input.value }),
		...(input.currency === undefined ? {} : { currency: input.currency }),
		occurredAt: input.occurredAt,
	};
}

export function resolveConversionStorePath(testStorePath?: string): string {
	const overriddenPath = process.env.LISTMONK_OPS_ABTEST_CONVERSION_STORE?.trim();
	if (overriddenPath) return overriddenPath;
	return testStorePath === undefined
		? join(getListmonkDataDirectory(), "abtest-conversions.json")
		: join(dirname(testStorePath), "abtest-conversions.json");
}

export function getConversionEventStorePath(): string {
	return resolveConversionStorePath();
}

/** Atomic, locked event journal shared by CLI and MCP processes. */
export class JsonFileConversionEventStore implements ConversionEventStore {
	private readonly store: JsonFileStore<StoredConversionEvents>;

	constructor(path = getConversionEventStorePath()) {
		this.store = {
			path,
			createDefault: () => ({ version: 1, events: [] }),
			parse: parseStoredConversionEvents,
			lock: { timeoutMs: 120_000 },
			skipUnchangedWrites: true,
		};
	}

	async hasEventId(eventId: string): Promise<boolean> {
		return (await readJsonFileStore(this.store)).events.some(
			(event) => event.eventId === eventId,
		);
	}

	async record(input: ConversionEventInput): Promise<"created" | "duplicate"> {
		validateConversionEvent(input);
		const sanitized = sanitizeConversionEvent(input);
		return updateJsonFileStore(this.store, (document) => {
			const existing = document.events.find(
				(event) => event.eventId === input.eventId,
			);
			if (existing) {
				if (JSON.stringify(existing) !== JSON.stringify(sanitized)) {
					throw new ConversionEventValidationError(
						`eventId ${input.eventId} already belongs to a different conversion`,
					);
				}
				return commitJsonFileStoreUpdate(document, "duplicate" as const);
			}
			if (document.events.some((event) =>
				event.testId === input.testId &&
				event.subscriberUuid === input.subscriberUuid &&
				event.variantId !== input.variantId,
			)) {
				throw new ConversionEventValidationError(`subscriber ${input.subscriberUuid} already converted in another variant of test ${input.testId}`);
			}
			if (input.currency !== undefined && document.events.some((event) =>
				event.testId === input.testId && event.currency !== undefined && event.currency !== input.currency,
			)) {
				throw new ConversionEventValidationError(`A/B test ${input.testId} already records revenue in another currency`);
			}
			return commitJsonFileStoreUpdate(
				{ version: 1 as const, events: [...document.events, sanitized] },
				"created" as const,
			);
		});
	}

	async aggregate(testId: string): Promise<VariantConversionAggregate[]> {
		const document = await readJsonFileStore(this.store);
		return aggregateConversionEvents(
			document.events.filter((event) => event.testId === testId),
		);
	}
}

export class ConversionEventValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConversionEventValidationError";
	}
}

/**
 * Validate a conversion event input before recording.
 * Throws ConversionEventValidationError on invalid data.
 */
export function validateConversionEvent(
	input: ConversionEventInput,
): void {
	if (typeof input.eventId !== "string" || input.eventId.trim().length === 0) {
		throw new ConversionEventValidationError("eventId is required");
	}
	if (typeof input.testId !== "string" || input.testId.trim().length === 0) {
		throw new ConversionEventValidationError("testId is required");
	}
	if (typeof input.variantId !== "string" || input.variantId.trim().length === 0) {
		throw new ConversionEventValidationError("variantId is required");
	}
	if (
		typeof input.subscriberUuid !== "string" ||
		input.subscriberUuid.trim().length === 0
	) {
		throw new ConversionEventValidationError("subscriberUuid is required");
	}
	if (typeof input.event !== "string" || input.event.trim().length === 0) {
		throw new ConversionEventValidationError("event is required");
	}
	if (input.value !== undefined) {
		if (
			!Number.isFinite(input.value) ||
			input.value < 0
		) {
			throw new ConversionEventValidationError(
				`value must be finite and non-negative, received ${input.value}`,
			);
		}
		if (typeof input.currency !== "string" || input.currency.trim().length === 0) {
			throw new ConversionEventValidationError(
				"currency is required when value is set",
			);
		}
	} else if (input.currency !== undefined) {
		throw new ConversionEventValidationError("currency requires value");
	}
	if (input.currency !== undefined && !/^[A-Z]{3}$/.test(input.currency)) {
		throw new ConversionEventValidationError(
			"currency must be a three-letter ISO 4217 code",
		);
	}
	if (typeof input.occurredAt !== "string") {
		throw new ConversionEventValidationError(
			"occurredAt must be an ISO timestamp",
		);
	}
	const occurredMs = new Date(input.occurredAt).getTime();
	if (Number.isNaN(occurredMs) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.occurredAt)) {
		throw new ConversionEventValidationError(
			`occurredAt must be a valid ISO timestamp, received ${input.occurredAt}`,
		);
	}
}

function aggregateConversionEvents(events: ConversionEventInput[]): VariantConversionAggregate[] {
	const byVariant = new Map<string, ConversionEventInput[]>();
	for (const event of events) {
		const list = byVariant.get(event.variantId) ?? [];
		list.push(event);
		byVariant.set(event.variantId, list);
	}
	const aggregates: VariantConversionAggregate[] = [];
	for (const [variantId, variantEvents] of byVariant) {
		const revenueEvents = variantEvents.filter(
			(event) => event.value !== undefined,
		);
		const currencies = new Set(revenueEvents.map((event) => event.currency));
		if (currencies.size > 1) {
			throw new ConversionEventValidationError(
				`variant ${variantId} has mixed currencies: ${[...currencies].join(", ")}`,
			);
		}
		aggregates.push({
			variantId,
			totalEvents: variantEvents.length,
			uniqueSubscribers: new Set(variantEvents.map((event) => event.subscriberUuid)).size,
			totalValue: revenueEvents.reduce(
				(sum, event) => sum + (event.value ?? 0),
				0,
			),
			currency: revenueEvents[0]?.currency,
		});
	}
	return aggregates;
}

/**
 * In-memory conversion event store. No persistence; for testing only.
 */
export class InMemoryConversionEventStore implements ConversionEventStore {
	private readonly events = new Map<string, ConversionEventInput>();
	private readonly byTest = new Map<string, ConversionEventInput[]>();

	/**
	 * @param assignmentLookup - Optional function that checks whether a
	 * subscriber UUID is assigned to a variant in a test. If provided,
	 * events for unassigned subscribers are rejected.
	 * @param attributionWindow - Optional [startTime, endTime] for
	 * attribution. Events outside this window are rejected.
	 */
	constructor(
		private readonly assignmentLookup?: (
			testId: string,
			variantId: string,
			subscriberUuid: string,
		) => boolean,
		private readonly attributionWindow?: {
			startTime: number;
			endTime: number;
		},
	) {}

	async record(
		input: ConversionEventInput,
	): Promise<"created" | "duplicate"> {
		// Check idempotency before validation — a retry should succeed
		// even if the assignment or window config changed since the
		// original write.
		const existing = this.events.get(input.eventId);
		if (existing) {
			validateConversionEvent(input);
			if (JSON.stringify(existing) !== JSON.stringify(sanitizeConversionEvent(input))) {
				throw new ConversionEventValidationError(
					`eventId ${input.eventId} already belongs to a different conversion`,
				);
			}
			return "duplicate";
		}

		validateConversionEvent(input);
		if ((this.byTest.get(input.testId) ?? []).some((event) =>
			event.subscriberUuid === input.subscriberUuid && event.variantId !== input.variantId,
		)) {
			throw new ConversionEventValidationError(
				`subscriber ${input.subscriberUuid} already converted in another variant of test ${input.testId}`,
			);
		}
		if (input.currency !== undefined && (this.byTest.get(input.testId) ?? []).some((event) =>
			event.currency !== undefined && event.currency !== input.currency,
		)) {
			throw new ConversionEventValidationError(
				`A/B test ${input.testId} already records revenue in another currency`,
			);
		}

		if (this.assignmentLookup) {
			if (
				!this.assignmentLookup(
					input.testId,
					input.variantId,
					input.subscriberUuid,
				)
			) {
				throw new ConversionEventValidationError(
					`subscriber ${input.subscriberUuid} is not assigned to variant ${input.variantId} in test ${input.testId}`,
				);
			}
		}

		if (this.attributionWindow) {
			if (
				!Number.isFinite(this.attributionWindow.startTime) ||
				!Number.isFinite(this.attributionWindow.endTime) ||
				this.attributionWindow.startTime >
					this.attributionWindow.endTime
			) {
				throw new ConversionEventValidationError(
					"attribution window is malformed (non-finite or reversed)",
				);
			}
			const occurredMs = new Date(input.occurredAt).getTime();
			if (
				occurredMs < this.attributionWindow.startTime ||
				occurredMs > this.attributionWindow.endTime
			) {
				throw new ConversionEventValidationError(
					`event occurred outside the attribution window`,
				);
			}
		}

		// Clone only the allowed fields to enforce PII-free storage.
		const sanitized = sanitizeConversionEvent(input);
		this.events.set(input.eventId, sanitized);
		const list = this.byTest.get(input.testId) ?? [];
		list.push(sanitized);
		this.byTest.set(input.testId, list);
		return "created";
	}

	async aggregate(
		testId: string,
	): Promise<VariantConversionAggregate[]> {
		return aggregateConversionEvents(this.byTest.get(testId) ?? []);
	}
}
