import { describe, expect, it } from "bun:test";
import {
	InMemoryConversionEventStore,
	ConversionEventValidationError,
	validateConversionEvent,
	type ConversionEventInput,
} from "../src/conversion-events";

function makeEvent(
	overrides: Partial<ConversionEventInput> = {},
): ConversionEventInput {
	return {
		eventId: "evt-1",
		testId: "test-1",
		variantId: "A",
		subscriberUuid: "uuid-1",
		event: "purchase",
		occurredAt: "2026-07-24T12:00:00Z",
		...overrides,
	};
}

describe("validateConversionEvent", () => {
	it("accepts a valid event", () => {
		expect(() => validateConversionEvent(makeEvent())).not.toThrow();
	});

	it("accepts an event with value and currency", () => {
		expect(() =>
			validateConversionEvent(
				makeEvent({ value: 99.99, currency: "USD" }),
			),
		).not.toThrow();
	});

	it("rejects missing eventId", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ eventId: "" })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects missing subscriberUuid", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ subscriberUuid: "" })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects negative value", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ value: -1, currency: "USD" })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects value without currency", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ value: 10 })),
		).toThrow(ConversionEventValidationError);
	});

	it("rejects malformed occurredAt", () => {
		expect(() =>
			validateConversionEvent(makeEvent({ occurredAt: "not-a-date" })),
		).toThrow(ConversionEventValidationError);
	});
});

describe("InMemoryConversionEventStore", () => {
	it("records an event and returns created", async () => {
		const store = new InMemoryConversionEventStore();
		const result = await store.record(makeEvent());
		expect(result).toBe("created");
	});

	it("returns duplicate for same eventId", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(makeEvent({ eventId: "evt-1" }));
		const result = await store.record(
			makeEvent({ eventId: "evt-1", event: "different" }),
		);
		expect(result).toBe("duplicate");
	});

	it("aggregates events by variant", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(
			makeEvent({ eventId: "e1", variantId: "A", subscriberUuid: "u1" }),
		);
		await store.record(
			makeEvent({ eventId: "e2", variantId: "A", subscriberUuid: "u2" }),
		);
		await store.record(
			makeEvent({ eventId: "e3", variantId: "B", subscriberUuid: "u3" }),
		);
		const aggregates = await store.aggregate("test-1");
		expect(aggregates).toHaveLength(2);
		const variantA = aggregates.find((a) => a.variantId === "A");
		expect(variantA?.totalEvents).toBe(2);
		expect(variantA?.uniqueSubscribers).toBe(2);
	});

	it("aggregates revenue correctly", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(
			makeEvent({
				eventId: "e1",
				variantId: "A",
				value: 50,
				currency: "USD",
			}),
		);
		await store.record(
			makeEvent({
				eventId: "e2",
				variantId: "A",
				value: 30,
				currency: "USD",
			}),
		);
		const aggregates = await store.aggregate("test-1");
		const variantA = aggregates.find((a) => a.variantId === "A");
		expect(variantA?.totalValue).toBe(80);
		expect(variantA?.currency).toBe("USD");
	});

	it("rejects events for unassigned subscribers", async () => {
		const lookup = (_testId: string, _variantId: string, uuid: string) =>
			uuid === "known-uuid";
		const store = new InMemoryConversionEventStore(lookup);
		await expect(
			store.record(makeEvent({ subscriberUuid: "unknown-uuid" })),
		).rejects.toThrow(ConversionEventValidationError);
		await expect(
			store.record(makeEvent({ subscriberUuid: "known-uuid" })),
		).resolves.toBe("created");
	});

	it("rejects events outside the attribution window", async () => {
		const store = new InMemoryConversionEventStore(undefined, {
			startTime: new Date("2026-07-24T00:00:00Z").getTime(),
			endTime: new Date("2026-07-25T00:00:00Z").getTime(),
		});
		await expect(
			store.record(
				makeEvent({ occurredAt: "2026-07-23T12:00:00Z" }),
			),
		).rejects.toThrow("attribution window");
		await expect(
			store.record(
				makeEvent({ occurredAt: "2026-07-24T12:00:00Z" }),
			),
		).resolves.toBe("created");
	});

	it("returns empty array for test with no events", async () => {
		const store = new InMemoryConversionEventStore();
		const aggregates = await store.aggregate("no-events-test");
		expect(aggregates).toEqual([]);
	});

	it("does not store PII (email/name)", async () => {
		const store = new InMemoryConversionEventStore();
		await store.record(makeEvent());
		const aggregates = await store.aggregate("test-1");
		const json = JSON.stringify(aggregates);
		expect(json).not.toContain("email");
		expect(json).not.toContain("@");
		expect(json).not.toContain("name");
	});
});
