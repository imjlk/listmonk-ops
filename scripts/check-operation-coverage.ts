import type { GraphDump } from "./check-graph-architecture";

type GraphEdgeKind = "accesses" | "calls";

export type OperationCoverageContract = {
	family: string;
	registry: string;
	testAnchor: string;
	mcpHandler: string;
	dispatcher: string;
};

export type GraphEdgeContract = {
	from: string;
	to: string;
	kind: GraphEdgeKind;
};

const coverageTestModule =
	"scripts/operation-coverage.test.ts#scripts/operation-coverage.test.ts:module";
const sharedOperationRegistryPattern =
	/^packages\/(operations|automation|abtest)\/src\/[^#]+#[A-Za-z][A-Za-z0-9]*Operations:variable$/;

export const operationCoverageContracts: readonly OperationCoverageContract[] = [
	{
		family: "subscriber lists",
		registry: "packages/operations/src/lists.ts#listOperations:variable",
		testAnchor:
			"scripts/shared-operation-coverage.ts#assertListOperationsPublished:function",
		mcpHandler:
			"packages/mcp/src/handlers/lists.ts#handleListsTools:variable",
		dispatcher:
			"packages/operations/src/lists.ts#invokeListOperationByMcpName:function",
	},
	{
		family: "campaigns",
		registry: "packages/operations/src/campaigns.ts#campaignOperations:variable",
		testAnchor:
			"scripts/shared-operation-coverage.ts#assertCampaignOperationsPublished:function",
		mcpHandler:
			"packages/mcp/src/handlers/campaigns.ts#handleCampaignsTools:variable",
		dispatcher:
			"packages/operations/src/campaigns.ts#invokeCampaignOperationByMcpName:function",
	},
	{
		family: "subscribers",
		registry:
			"packages/operations/src/subscribers.ts#subscriberOperations:variable",
		testAnchor:
			"scripts/shared-operation-coverage.ts#assertSubscriberOperationsPublished:function",
		mcpHandler:
			"packages/mcp/src/handlers/subscribers.ts#handleSubscribersTools:function",
		dispatcher:
			"packages/operations/src/subscribers.ts#invokeSubscriberOperationByMcpName:function",
	},
	{
		family: "templates",
		registry: "packages/operations/src/templates.ts#templateOperations:variable",
		testAnchor:
			"scripts/shared-operation-coverage.ts#assertTemplateOperationsPublished:function",
		mcpHandler:
			"packages/mcp/src/handlers/templates.ts#handleTemplatesTools:function",
		dispatcher:
			"packages/operations/src/templates.ts#invokeTemplateOperationByMcpName:function",
	},
	{
		family: "transactional mail",
		registry:
			"packages/operations/src/transactional.ts#transactionalOperations:variable",
		testAnchor:
			"scripts/shared-operation-coverage.ts#assertTransactionalOperationsPublished:function",
		mcpHandler:
			"packages/mcp/src/handlers/transactional.ts#handleTransactionalTools:variable",
		dispatcher:
			"packages/operations/src/transactional.ts#invokeTransactionalOperationByMcpName:function",
	},
	{
		family: "operations workflows",
		registry:
			"packages/automation/src/ops-operations.ts#opsOperations:variable",
		testAnchor:
			"scripts/shared-operation-coverage.ts#assertOpsOperationsPublished:function",
		mcpHandler: "packages/mcp/src/handlers/ops.ts#handleOpsTools:variable",
		dispatcher:
			"packages/automation/src/ops-operations.ts#invokeOpsOperationByMcpName:function",
	},
	{
		family: "A/B tests",
		registry: "packages/abtest/src/operations.ts#abTestOperations:variable",
		testAnchor:
			"scripts/shared-operation-coverage.ts#assertAbTestOperationsPublished:function",
		mcpHandler:
			"packages/mcp/src/handlers/abtest.ts#handleAbTestTools:variable",
		dispatcher:
			"packages/abtest/src/operations.ts#invokeAbTestOperationByMcpName:function",
	},
];

export const operationCoverageEdges: readonly GraphEdgeContract[] =
	operationCoverageContracts.flatMap((contract) => [
		{
			from: coverageTestModule,
			to: contract.testAnchor,
			kind: "calls" as const,
		},
		{
			from: contract.testAnchor,
			to: contract.registry,
			kind: "accesses" as const,
		},
		{
			from: contract.mcpHandler,
			to: contract.dispatcher,
			kind: "calls" as const,
		},
	]);

export function assertOperationCoverage(
	graph: GraphDump,
	contracts: readonly GraphEdgeContract[] = operationCoverageEdges,
	coverageContracts: readonly OperationCoverageContract[] =
		operationCoverageContracts,
): void {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const edges = new Set(
		graph.edges.map((edge) => `${edge.kind}\0${edge.from}\0${edge.to}`),
	);
	const failures: string[] = [];
	const coveredRegistries = new Set(
		coverageContracts.map((contract) => contract.registry),
	);

	for (const contract of coverageContracts) {
		if (!nodeIds.has(contract.registry)) {
			failures.push(`missing shared operation registry ${contract.registry}`);
		}
	}

	for (const nodeId of nodeIds) {
		if (
			sharedOperationRegistryPattern.test(nodeId) &&
			!coveredRegistries.has(nodeId)
		) {
			failures.push(
				`missing coverage contract for shared operation registry ${nodeId}`,
			);
		}
	}

	for (const contract of contracts) {
		if (!nodeIds.has(contract.from)) {
			failures.push(`missing node ${contract.from}`);
		}
		if (!nodeIds.has(contract.to)) {
			failures.push(`missing node ${contract.to}`);
		}
		if (
			nodeIds.has(contract.from) &&
			nodeIds.has(contract.to) &&
			!edges.has(`${contract.kind}\0${contract.from}\0${contract.to}`)
		) {
			failures.push(
				`missing ${contract.kind} edge ${contract.from} -> ${contract.to}`,
			);
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`Shared operation graph coverage failed:\n${failures
				.map((failure) => `- ${failure}`)
				.join("\n")}`,
		);
	}
}

if (import.meta.main) {
	const graph = (await Bun.stdin.json()) as GraphDump;
	assertOperationCoverage(graph);
	console.log(
		`Shared operation graph coverage preserves ${operationCoverageContracts.length} families across ${operationCoverageEdges.length} direct graph edges.`,
	);
}
