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
	assertOperationsSpecGraph,
	operationsSpecGraphEdges,
	operationsSpecOperationCount,
} from "./check-operations-spec-graph";

export function assertMainGraphContracts(graph: GraphDump): void {
	assertOperationCoverage(graph);
	assertArchitectureCallPaths(graph);
	assertOperationsSpecGraph(graph);
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
		`Operations spec preserves ${operationsSpecOperationCount} pilot operations across ${operationsSpecGraphEdges.length} direct graph edges.`,
	);
}
