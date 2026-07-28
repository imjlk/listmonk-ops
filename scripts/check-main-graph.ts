import {
	architectureCallPaths,
	assertArchitectureCallPaths,
	countArchitectureCallEdges,
	type GraphDump,
} from "./check-graph-architecture";
import {
	assertOperationCoverage,
	operationCoverageContracts,
	operationCoverageEdges,
} from "./check-operation-coverage";
import {
	assertProductSchemaGraph,
	productSchemaGraphEdges,
	productSchemaOperationCount,
} from "./check-product-schema-graph";

export function assertMainGraphContracts(graph: GraphDump): void {
	assertOperationCoverage(graph);
	assertArchitectureCallPaths(graph);
	assertProductSchemaGraph(graph);
}

if (import.meta.main) {
	const graph = (await Bun.stdin.json()) as GraphDump;
	assertMainGraphContracts(graph);

	console.log(
		`Shared operation graph coverage preserves ${operationCoverageContracts.length} families across ${operationCoverageEdges.length} direct graph edges.`,
	);
	console.log(
		`Main graph preserves ${architectureCallPaths.length} architecture paths across ${countArchitectureCallEdges()} direct call edges.`,
	);
	console.log(
		`Product schema preserves ${productSchemaOperationCount} pilot operations across ${productSchemaGraphEdges.length} direct graph edges.`,
	);
}
