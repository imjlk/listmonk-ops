import { describe, expect, test } from "bun:test";
import {
	assertProductSchemaGraph,
	productSchemaGraphEdges,
} from "./check-product-schema-graph";

describe("product schema graph contracts", () => {
	test("accepts every generated product-schema edge", () => {
		const nodes = new Set(
			productSchemaGraphEdges.flatMap((contract) => [
				contract.from,
				contract.to,
			]),
		);
		expect(() =>
			assertProductSchemaGraph({
				nodes: [...nodes].map((id) => ({ id })),
				edges: productSchemaGraphEdges.map((contract) => ({
					from: contract.from,
					to: contract.to,
					kind: contract.kind,
				})),
			}),
		).not.toThrow();
	});

	test("reports the product operation when a projection edge is missing", () => {
		const first = productSchemaGraphEdges[0];
		if (!first) {
			throw new Error("Expected at least one product schema graph edge");
		}
		expect(() =>
			assertProductSchemaGraph(
				{
					nodes: [{ id: first.from }, { id: first.to }],
					edges: [],
				},
				[first],
			),
		).toThrow(`${first.operationId} missing ${first.kind} edge`);
	});
});
