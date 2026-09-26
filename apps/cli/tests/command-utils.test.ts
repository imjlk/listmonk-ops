import { describe, expect, test } from "bun:test";
import {
	parseCsvNumbersStrict,
	parsePositiveIntegerId,
	positiveIntegerIdSchema,
} from "../src/lib/command-utils";

describe("CLI resource ID parsing", () => {
	test("accepts positive decimal IDs with surrounding whitespace", () => {
		expect(parseCsvNumbersStrict("12, 4 ,7", "list IDs")).toEqual([12, 4, 7]);
		expect(parsePositiveIntegerId(" 42 ", "campaign ID")).toBe(42);
		expect(positiveIntegerIdSchema.parse("16")).toBe(16);
		expect(positiveIntegerIdSchema.parse(" 16 ")).toBe(16);
	});

	test.each([
		["12,O4", "'O4'"],
		["1,2x,3", "'2x'"],
		["0x10", "'0x10'"],
		["1e1", "'1e1'"],
		["0b1", "'0b1'"],
		["1.0", "'1.0'"],
		["+1", "'+1'"],
		["-1", "'-1'"],
		["0", "'0'"],
		["012", "'012'"],
		["1,,2", "''"],
		["1,2,", "''"],
	])("rejects the ID list %p instead of dropping or rewriting an entry", (input, token) => {
		expect(() => parseCsvNumbersStrict(input, "list IDs")).toThrow(
			`Invalid list IDs ${token}: expected a positive integer`,
		);
	});

	test("rejects missing and unsafe ID lists", () => {
		expect(() => parseCsvNumbersStrict(undefined, "list IDs")).toThrow(
			"Expected a comma-separated list of list IDs",
		);
		expect(() => parseCsvNumbersStrict("", "list IDs")).toThrow(
			"Expected a comma-separated list of list IDs",
		);
		expect(() =>
			parseCsvNumbersStrict("1,9007199254740993", "list IDs"),
		).toThrow("exceeds the maximum safe integer");
	});

	test.each(["0x10", "1e1", "0b1", "0o7", "1.0", "+1", "012", "0", "", "Infinity"])(
		"rejects the scalar ID %p that Number() would coerce",
		(input) => {
			const result = positiveIntegerIdSchema.safeParse(input);
			expect(result.success).toBe(false);
			expect(result.error?.issues[0]?.message).toBe(
				`expected a positive decimal integer, received ${JSON.stringify(input)}`,
			);
		},
	);

	test("rejects scalar IDs beyond the safe integer range", () => {
		const result = positiveIntegerIdSchema.safeParse("9007199254740993");
		expect(result.success).toBe(false);
		expect(result.error?.issues[0]?.message).toContain(
			"exceeds the maximum safe integer",
		);
	});
});
