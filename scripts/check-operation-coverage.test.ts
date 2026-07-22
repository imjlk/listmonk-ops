import { describe, expect, test } from "bun:test";
import {
	assertOperationCoverage,
	operationCoverageContracts,
	operationCoverageEdges,
} from "./check-operation-coverage";
import type { GraphDump } from "./check-graph-architecture";

function completeGraph(): GraphDump {
	return {
		nodes: [
			...new Set(
				[
					...operationCoverageEdges.flatMap((edge) => [edge.from, edge.to]),
					...operationCoverageContracts.map((contract) => contract.registry),
				],
			),
		].map((id) => ({ id })),
		edges: operationCoverageEdges.map((edge) => ({ ...edge })),
	};
}

describe("shared operation graph coverage", () => {
	test("accepts every registry, MCP publication, and dispatcher anchor", () => {
		expect(() => assertOperationCoverage(completeGraph())).not.toThrow();
	});

	test("rejects a missing direct test anchor", () => {
		const graph = completeGraph();
		graph.edges = graph.edges.filter(
			(edge) =>
				!(
					edge.kind === "calls" &&
					edge.from.includes("operation-coverage.test.ts")
				),
		);

		expect(() => assertOperationCoverage(graph)).toThrow(
			"missing calls edge",
		);
	});

	test("rejects a test helper that no longer accesses its registry", () => {
		const graph = completeGraph();
		const contract = operationCoverageContracts[0];
		if (!contract) {
			throw new Error("expected at least one shared operation coverage contract");
		}
		graph.edges = graph.edges.filter(
			(edge) =>
				!(
					edge.kind === "accesses" &&
					edge.from === contract.testAnchor &&
					edge.to === contract.registry
				),
		);

		expect(() => assertOperationCoverage(graph)).toThrow(
			"missing accesses edge",
		);
	});

	test("rejects a declared shared operation registry missing from the graph", () => {
		const graph = completeGraph();
		const contract = operationCoverageContracts[0];
		if (!contract) {
			throw new Error("expected at least one shared operation coverage contract");
		}
		graph.nodes = graph.nodes.filter(
			(node) => node.id !== contract.registry,
		);

		expect(() => assertOperationCoverage(graph)).toThrow(
			"missing shared operation registry",
		);
	});

	test("rejects a shared operation registry without a coverage contract", () => {
		const graph = completeGraph();
		graph.nodes.push({
			id: "packages/operations/src/imports.ts#importOperations:variable",
		});

		expect(() => assertOperationCoverage(graph)).toThrow(
			"missing coverage contract for shared operation registry",
		);
	});
});
