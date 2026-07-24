import type { AbTest } from "./types";

/**
 * Transport-neutral conversion event store for A/B test attribution.
 *
 * Records conversion events (purchases, signups, etc.) attributed to
 * specific variant assignments. PII (email, name) is never stored —
 * only subscriber UUID for attribution matching.
 *
 * The store enforces:
 * - eventId idempotency (duplicate events return "duplicate")
 * - subscriber UUID exists in the test's assignment manifest
 * - occurredAt falls within the attribution window
 * - value is finite/non-negative; revenue requires currency
 */

export interface ConversionEventInput {
	/** Unique event identifier for idempotency. */
	eventId: string;
	testId: string;
	variantId: string;
	/** Subscriber UUID — must exist in the test's assignment manifest. */
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
	conversionRate: number;
	revenuePerRecipient: number;
}

export interface ConversionEventStore {
	record(input: ConversionEventInput): Promise<"created" | "duplicate">;
	aggregate(testId: string): Promise<VariantConversionAggregate[]>;
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
	if (!input.eventId || input.eventId.trim().length === 0) {
		throw new ConversionEventValidationError("eventId is required");
	}
	if (!input.testId || input.testId.trim().length === 0) {
		throw new ConversionEventValidationError("testId is required");
	}
	if (!input.variantId || input.variantId.trim().length === 0) {
		throw new ConversionEventValidationError("variantId is required");
	}
	if (
		!input.subscriberUuid ||
		input.subscriberUuid.trim().length === 0
	) {
		throw new ConversionEventValidationError("subscriberUuid is required");
	}
	if (!input.event || input.event.trim().length === 0) {
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
		if (!input.currency || input.currency.trim().length === 0) {
			throw new ConversionEventValidationError(
				"currency is required when value is set",
			);
		}
	}
	const occurredMs = new Date(input.occurredAt).getTime();
	if (Number.isNaN(occurredMs)) {
		throw new ConversionEventValidationError(
			`occurredAt must be a valid ISO timestamp, received ${input.occurredAt}`,
		);
	}
}

/**
 * In-memory conversion event store. No persistence; for testing only.
 * Production should use a Postgres-backed store.
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
		if (this.events.has(input.eventId)) {
			return "duplicate";
		}

		validateConversionEvent(input);

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
		const sanitized: ConversionEventInput = {
			eventId: input.eventId,
			testId: input.testId,
			variantId: input.variantId,
			subscriberUuid: input.subscriberUuid,
			event: input.event,
			value: input.value,
			currency: input.currency,
			occurredAt: input.occurredAt,
		};
		this.events.set(input.eventId, sanitized);
		const list = this.byTest.get(input.testId) ?? [];
		list.push(sanitized);
		this.byTest.set(input.testId, list);
		return "created";
	}

	async aggregate(
		testId: string,
	): Promise<VariantConversionAggregate[]> {
		const events = this.byTest.get(testId) ?? [];
		const byVariant = new Map<string, ConversionEventInput[]>();

		for (const event of events) {
			const list = byVariant.get(event.variantId) ?? [];
			list.push(event);
			byVariant.set(event.variantId, list);
		}

		const aggregates: VariantConversionAggregate[] = [];
		for (const [variantId, variantEvents] of byVariant) {
			const uniqueSubscribers = new Set(
				variantEvents.map((e) => e.subscriberUuid),
			);
			const revenueEvents = variantEvents.filter((e) => e.value !== undefined);
			const currencies = new Set(revenueEvents.map((e) => e.currency));
			if (currencies.size > 1) {
				throw new ConversionEventValidationError(
					`variant ${variantId} has mixed currencies: ${[...currencies].join(", ")}`,
				);
			}
			const totalValue = revenueEvents.reduce(
				(sum, e) => sum + (e.value ?? 0),
				0,
			);
			const currency = revenueEvents[0]?.currency;

			aggregates.push({
				variantId,
				totalEvents: variantEvents.length,
				uniqueSubscribers: uniqueSubscribers.size,
				totalValue,
				currency,
				conversionRate: 0,
				revenuePerRecipient: 0,
			});
		}

		return aggregates;
	}
}
