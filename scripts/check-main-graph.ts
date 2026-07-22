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

export function assertMainGraphContracts(graph: GraphDump): void {
	assertOperationCoverage(graph);
	assertArchitectureCallPaths(graph);
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
}
