import { describe, expect, test } from "bun:test";
import type { NormalizedContractSchema } from "../src/specs/json";
import { assertTypeScriptContractCompatibility } from "../src/specs/schema-compatibility";

type SchemaObject = Readonly<Record<string, unknown>>;

type SemanticCompatibilityFixture = {
	label: string;
	direction: "input" | "output";
	product: SchemaObject;
	runtime: SchemaObject;
	expectedError?: string;
};

function productContract(value: SchemaObject): NormalizedContractSchema {
	return {
		dialect: "openapi-3.1",
		stage: "normalized",
		source: "typescript",
		schema: {
			type: "object",
			properties: { value },
			required: ["value"],
			additionalProperties: false,
		},
		components: {},
	};
}

function runtimeContract(value: SchemaObject): SchemaObject {
	return {
		type: "object",
		properties: { value },
		required: ["value"],
		additionalProperties: false,
	};
}

const semanticCompatibilityFixtures: readonly SemanticCompatibilityFixture[] = [
	{
		label: "accepts an input numeric domain narrowed by the product contract",
		direction: "input",
		product: { type: "number", minimum: 1, maximum: 9 },
		runtime: { type: "number", minimum: 0, maximum: 10 },
	},
	{
		label: "rejects an input numeric domain widened below the runtime boundary",
		direction: "input",
		product: { type: "number", minimum: -1, maximum: 9 },
		runtime: { type: "number", minimum: 0, maximum: 10 },
		expectedError: "value minimum drifted",
	},
	{
		label: "accepts runtime output narrowed inside the product domain",
		direction: "output",
		product: { type: "number", minimum: 0, maximum: 10 },
		runtime: { type: "number", minimum: 1, maximum: 9 },
	},
	{
		label: "rejects runtime output widened above the product domain",
		direction: "output",
		product: { type: "number", minimum: 0, maximum: 10 },
		runtime: { type: "number", minimum: 0, maximum: 11 },
		expectedError: "value maximum drifted",
	},
	{
		label: "treats an integer exclusive lower bound as its inclusive equivalent",
		direction: "input",
		product: { type: "integer", minimum: 1 },
		runtime: { type: "integer", exclusiveMinimum: 0 },
	},
	{
		label: "accepts an input array narrowed inside runtime cardinality",
		direction: "input",
		product: {
			type: "array",
			minItems: 2,
			maxItems: 3,
			items: { type: "string" },
		},
		runtime: {
			type: "array",
			minItems: 1,
			maxItems: 4,
			items: { type: "string" },
		},
	},
	{
		label: "rejects runtime output beyond product array cardinality",
		direction: "output",
		product: {
			type: "array",
			minItems: 1,
			maxItems: 4,
			items: { type: "string" },
		},
		runtime: {
			type: "array",
			minItems: 1,
			maxItems: 5,
			items: { type: "string" },
		},
		expectedError: "value maxItems drifted",
	},
	{
		label: "accepts an input literal covered by a runtime pattern",
		direction: "input",
		product: { type: "string", enum: ["alpha"] },
		runtime: { type: "string", pattern: "^[a-z]+$" },
	},
	{
		label: "accepts a runtime output literal from the product enum",
		direction: "output",
		product: { type: "string", enum: ["draft", "scheduled"] },
		runtime: { type: "string", const: "draft" },
	},
];

describe("semantic JSON Schema compatibility", () => {
	for (const fixture of semanticCompatibilityFixtures) {
		test(fixture.label, () => {
			const assertion = () =>
				assertTypeScriptContractCompatibility(
					`fixture.${fixture.direction}`,
					fixture.direction,
					productContract(fixture.product),
					runtimeContract(fixture.runtime),
				);
			if (fixture.expectedError === undefined) {
				expect(assertion).not.toThrow();
				return;
			}
			expect(assertion).toThrow(fixture.expectedError);
		});
	}
});
