import { describe, expect, test } from "bun:test";
import {
	assertOperationsSpecGraph,
	operationsSpecGraphEdges,
} from "./check-operations-spec-graph";

describe("operations spec graph contracts", () => {
	test("accepts every generated operations-spec edge", () => {
		const nodes = new Set(
			operationsSpecGraphEdges.flatMap((contract) => [
				contract.from,
				contract.to,
			]),
		);
		expect(() =>
			assertOperationsSpecGraph({
				nodes: [...nodes].map((id) => ({ id })),
				edges: operationsSpecGraphEdges.map((contract) => ({
					from: contract.from,
					to: contract.to,
					kind: contract.kind,
				})),
			}),
		).not.toThrow();
	});

	test("reports the operation spec when a projection edge is missing", () => {
		const first = operationsSpecGraphEdges[0];
		if (!first) {
			throw new Error("Expected at least one operations spec graph edge");
		}
		expect(() =>
			assertOperationsSpecGraph(
				{
					nodes: [{ id: first.from }, { id: first.to }],
					edges: [],
				},
				[first],
			),
		).toThrow(`${first.operationId} missing ${first.kind} edge`);
	});
});
