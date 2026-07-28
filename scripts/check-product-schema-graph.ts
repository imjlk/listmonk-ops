import {
	emailOperationsProductSchema,
} from "../packages/product-schema/src";
import type { GraphDump } from "./check-graph-architecture";

export type ProductSchemaGraphEdge = {
	operationId: string;
	kind: "calls" | "type_ref";
	from: string;
	to: string;
};

export const productSchemaOperationCount =
	emailOperationsProductSchema.operations.length;

export const productSchemaGraphEdges: readonly ProductSchemaGraphEdge[] =
	emailOperationsProductSchema.operations.flatMap((operation) => [
		{
			operationId: operation.id,
			kind: "calls" as const,
			from: operation.projection.graph.runtimeDefinitionNode,
			to: operation.projection.graph.bindingNode,
		},
		{
			operationId: operation.id,
			kind: "type_ref" as const,
			from: operation.projection.graph.bindingNode,
			to: operation.projection.graph.descriptorNode,
		},
		{
			operationId: operation.id,
			kind: "calls" as const,
			from: operation.projection.graph.invokerNode,
			to: operation.projection.graph.executorNode,
		},
	]);

export function assertProductSchemaGraph(
	graph: GraphDump,
	contracts: readonly ProductSchemaGraphEdge[] = productSchemaGraphEdges,
): void {
	const nodes = new Set(graph.nodes.map((node) => node.id));
	const edges = new Set(
		graph.edges.map((edge) => `${edge.kind}\0${edge.from}\0${edge.to}`),
	);
	const failures: string[] = [];

	for (const contract of contracts) {
		if (!nodes.has(contract.from)) {
			failures.push(`${contract.operationId} missing node ${contract.from}`);
		}
		if (!nodes.has(contract.to)) {
			failures.push(`${contract.operationId} missing node ${contract.to}`);
		}
		if (
			nodes.has(contract.from) &&
			nodes.has(contract.to) &&
			!edges.has(`${contract.kind}\0${contract.from}\0${contract.to}`)
		) {
			failures.push(
				`${contract.operationId} missing ${contract.kind} edge ${contract.from} -> ${contract.to}`,
			);
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`Product schema graph projection failed:\n${failures
				.map((failure) => `- ${failure}`)
				.join("\n")}`,
		);
	}
}

if (import.meta.main) {
	const graph = (await Bun.stdin.json()) as GraphDump;
	assertProductSchemaGraph(graph);
	console.log(
		`Product schema preserves ${productSchemaOperationCount} pilot operations across ${productSchemaGraphEdges.length} direct graph edges.`,
	);
}
