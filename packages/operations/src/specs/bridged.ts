import type { AgentOperationContext } from "./agent";
import type { OperationEffect, OperationResourceKind } from "./effect";
import {
	defineOperationSpec,
	type AnyOperationSpec,
	type OperationSpec,
	type OperationSpecVerb,
	type OperationStateTransitionSpec,
} from "./operation";
import { expectedPolicyForEffects } from "./policy";
import type { OperationId, RetrySemantics } from "./retry";
import { runtimeOperationContract } from "./runtime-contracts";
import type {
	runtimeOperationContractIds,
} from "./runtime-contract-ids";

type BridgedOperationId = (typeof runtimeOperationContractIds)[number];

interface BridgedOperationDeclaration {
	id: BridgedOperationId;
	resource: OperationResourceKind;
	verb: OperationSpecVerb;
	title: string;
	description: string;
	mcpName: `listmonk_${string}`;
	effects: readonly OperationEffect[];
	idempotent: boolean;
	runtimeFile: string;
	runtimeDefinition: string;
	invoker: string;
	executor: string;
	prerequisites?: readonly OperationId[];
	verifyWith?: readonly OperationId[];
	related?: readonly OperationId[];
	state?: OperationStateTransitionSpec;
}

const read = (resource: OperationResourceKind): readonly OperationEffect[] => [
	{ kind: "read", resource },
];
const write = (
	resource: OperationResourceKind,
	reversible: boolean,
	preview?: boolean,
): readonly OperationEffect[] => [
	{
		kind: "write",
		resource,
		reversible,
		...(preview === undefined ? {} : { preview }),
	},
];
const remove = (resource: OperationResourceKind): readonly OperationEffect[] => [
	{ kind: "delete", resource, reversible: false },
];

function retrySemantics(
	declaration: BridgedOperationDeclaration,
): RetrySemantics {
	return declaration.idempotent
		? {
				kind: "safe",
				reason:
					"The shared operation contract declares identical retries idempotent.",
			}
		: {
				kind: "unsafe",
				reason:
					"The shared operation may create, deliver, or advance state before an ambiguous failure.",
			};
}

function agentContext(
	declaration: BridgedOperationDeclaration,
): AgentOperationContext {
	const readOnly = declaration.effects.every(
		(effect) => effect.kind === "read",
	);
	return {
		useWhen: [declaration.description],
		avoidWhen: [
			readOnly
				? "A mutation or workflow transition is required instead of inspection."
				: "The target, intended side effect, or required confirmation has not been verified.",
		],
		prerequisites: declaration.prerequisites ?? [],
		verifyWith: declaration.verifyWith ?? [],
		related: declaration.related ?? [],
		retryGuidance: declaration.idempotent
			? "Retry identical transient failures with bounded backoff."
			: "Do not automatically retry an ambiguous failure; inspect the target resource or reconcile first.",
	};
}

function defineBridgedOperationSpec(
	declaration: BridgedOperationDeclaration,
): AnyOperationSpec {
	const contract = runtimeOperationContract(declaration.id);
	return defineOperationSpec({
		id: declaration.id,
		resource: declaration.resource,
		verb: declaration.verb,
		title: declaration.title,
		description: declaration.description,
		contract,
		effects: declaration.effects,
		policy: expectedPolicyForEffects(declaration.effects),
		retry: retrySemantics(declaration),
		...(declaration.state === undefined
			? {}
			: { state: declaration.state }),
		agent: agentContext(declaration),
		projection: {
			mcpName: declaration.mcpName,
			openWorld: true,
			graph: {
				descriptorNode:
					"packages/operations/src/specs/bridged.ts#bridgedOperationSpecsById:variable",
				bindingNode:
					"packages/operations/src/specs/bridged.ts#bindBridgedOperationSpec:function",
				runtimeDefinitionNode: `${declaration.runtimeFile}#${declaration.runtimeDefinition}:variable`,
				invokerNode: `${declaration.runtimeFile}#${declaration.invoker}:function`,
				executorNode: `${declaration.runtimeFile}#${declaration.executor}:function`,
			},
		},
		stability: "experimental",
		since: "0.9.0",
	} as OperationSpec<readonly OperationEffect[]>);
}

const bridgedOperationDeclarations = [
	{
		id: "abtest.list",
		resource: "experiment",
		verb: "list",
		title: "List A/B tests",
		description: "List persisted A/B tests, optionally filtered by status",
		mcpName: "listmonk_abtest_list",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "listAbTestsOperation",
		invoker: "invokeListAbTestsOperation",
		executor: "executeListAbTestsOperation",
		related: ["abtest.get", "abtest.run", "abtest.tick"],
	},
	{
		id: "abtest.get",
		resource: "experiment",
		verb: "get",
		title: "Get A/B test",
		description: "Get persisted A/B test details",
		mcpName: "listmonk_abtest_get",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "getAbTestOperation",
		invoker: "invokeGetAbTestOperation",
		executor: "executeGetAbTestOperation",
		related: [
			"abtest.analyze",
			"abtest.run",
			"abtest.export-assignment",
		],
	},
	{
		id: "abtest.create",
		resource: "experiment",
		verb: "create",
		title: "Create A/B test",
		description:
			"Create and persist an A/B test; auto-launch can start its campaigns",
		mcpName: "listmonk_abtest_create",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{ kind: "write", resource: "campaign", reversible: true },
			{ kind: "write", resource: "list", reversible: true },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "scheduled",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "createAbTestOperation",
		invoker: "invokeCreateAbTestOperation",
		executor: "executeCreateAbTestOperation",
		verifyWith: ["abtest.get"],
		related: ["ops.campaign.preflight", "abtest.launch", "abtest.run"],
	},
	{
		id: "abtest.analyze",
		resource: "experiment",
		verb: "analyze",
		title: "Analyze A/B test",
		description: "Analyze persisted A/B test statistical results",
		mcpName: "listmonk_abtest_analyze",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "analyzeAbTestOperation",
		invoker: "invokeAnalyzeAbTestOperation",
		executor: "executeAnalyzeAbTestOperation",
		prerequisites: ["abtest.get"],
		related: ["abtest.deploy-winner", "abtest.export-assignment"],
	},
	{
		id: "abtest.launch",
		resource: "experiment",
		verb: "launch",
		title: "Launch A/B test",
		description: "Launch a draft A/B test",
		mcpName: "listmonk_abtest_launch",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "scheduled",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "launchAbTestOperation",
		invoker: "invokeLaunchAbTestOperation",
		executor: "executeLaunchAbTestOperation",
		prerequisites: ["abtest.get", "ops.campaign.preflight"],
		verifyWith: ["abtest.get"],
		related: ["abtest.stop", "abtest.run"],
	},
	{
		id: "abtest.stop",
		resource: "experiment",
		verb: "stop",
		title: "Stop A/B test",
		description:
			"Stop an A/B test and clean up its non-terminal Listmonk campaigns and temporary lists",
		mcpName: "listmonk_abtest_stop",
		effects: [
			...write("experiment", false),
			...remove("campaign"),
			...remove("list"),
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "stopAbTestOperation",
		invoker: "invokeStopAbTestOperation",
		executor: "executeStopAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.reconcile", "abtest.delete"],
	},
	{
		id: "abtest.delete",
		resource: "experiment",
		verb: "delete",
		title: "Delete A/B test",
		description:
			"Delete an A/B test and clean up non-terminal Listmonk campaigns and temporary lists before removing persisted state",
		mcpName: "listmonk_abtest_delete",
		effects: [
			...remove("experiment"),
			...remove("campaign"),
			...remove("list"),
		],
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "deleteAbTestOperation",
		invoker: "invokeDeleteAbTestOperation",
		executor: "executeDeleteAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.list"],
	},
	{
		id: "abtest.recommend-sample-size",
		resource: "experiment",
		verb: "recommend-sample-size",
		title: "Recommend A/B test sample size",
		description:
			"Get statistical recommendations for test-group sample size",
		mcpName: "listmonk_abtest_recommend_sample_size",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "recommendAbTestSampleSizeOperation",
		invoker: "invokeRecommendAbTestSampleSizeOperation",
		executor: "executeRecommendAbTestSampleSizeOperation",
		related: ["abtest.create"],
	},
	{
		id: "abtest.deploy-winner",
		resource: "experiment",
		verb: "deploy-winner",
		title: "Deploy A/B test winner",
		description:
			"Deploy a statistically significant winner to the holdout group",
		mcpName: "listmonk_abtest_deploy_winner",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{ kind: "write", resource: "campaign", reversible: true },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "immediate",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "deployAbTestWinnerOperation",
		invoker: "invokeDeployAbTestWinnerOperation",
		executor: "executeDeployAbTestWinnerOperation",
		prerequisites: ["abtest.get", "abtest.analyze"],
		verifyWith: ["abtest.get"],
		related: ["abtest.run", "abtest.reconcile"],
	},
	{
		id: "abtest.run",
		resource: "experiment",
		verb: "run",
		title: "Run A/B test step",
		description:
			"Advance a single A/B test one lifecycle step based on its current status",
		mcpName: "listmonk_abtest_run",
		effects: [
			{ kind: "write", resource: "experiment", reversible: false },
			{ kind: "write", resource: "campaign", reversible: true },
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "immediate",
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "runAbTestOperation",
		invoker: "invokeRunAbTestOperation",
		executor: "executeRunAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.tick", "abtest.reconcile"],
	},
	{
		id: "abtest.tick",
		resource: "experiment",
		verb: "tick",
		title: "Tick A/B tests",
		description:
			"Advance every non-terminal A/B test one lifecycle step and report the actions taken",
		mcpName: "listmonk_abtest_tick",
		effects: [
			{
				kind: "write",
				resource: "experiment",
				reversible: false,
				preview: true,
			},
			{
				kind: "write",
				resource: "campaign",
				reversible: true,
				preview: true,
			},
			{
				kind: "delivery",
				resource: "campaign",
				audience: "bulk",
				timing: "immediate",
				preview: true,
			},
		],
		idempotent: false,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "tickAbTestsOperation",
		invoker: "invokeTickAbTestsOperation",
		executor: "executeTickAbTestsOperation",
		prerequisites: ["abtest.list"],
		verifyWith: ["abtest.list"],
		related: ["abtest.run", "abtest.reconcile"],
	},
	{
		id: "abtest.reconcile",
		resource: "experiment",
		verb: "reconcile",
		title: "Reconcile A/B test state",
		description:
			"Reconcile persisted A/B test state against expected lifecycle state; repairs are destructive when enabled",
		mcpName: "listmonk_abtest_reconcile",
		effects: [
			{
				kind: "maintenance",
				resource: "experiment",
				action: "resolve",
				destructive: true,
				preview: false,
			},
		],
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "reconcileAbTestOperation",
		invoker: "invokeReconcileAbTestOperation",
		executor: "executeReconcileAbTestOperation",
		prerequisites: ["abtest.get"],
		verifyWith: ["abtest.get"],
		related: ["abtest.run", "abtest.stop"],
	},
	{
		id: "abtest.export-assignment",
		resource: "experiment",
		verb: "export-assignment",
		title: "Export A/B test assignment manifest",
		description:
			"Export the subscriber assignment manifest for a test with deterministic provisioning. Contains subscriber group assignments (no email/PII).",
		mcpName: "listmonk_abtest_export_assignment",
		effects: read("experiment"),
		idempotent: true,
		runtimeFile: "packages/abtest/src/operations.ts",
		runtimeDefinition: "exportAbTestAssignmentOperation",
		invoker: "invokeExportAbTestAssignmentOperation",
		executor: "executeExportAbTestAssignmentOperation",
		prerequisites: ["abtest.get"],
		related: ["abtest.analyze"],
	},
] as const satisfies readonly BridgedOperationDeclaration[];

export const bridgedOperationSpecs = bridgedOperationDeclarations.map(
	defineBridgedOperationSpec,
);

export const bridgedOperationSpecsById = Object.fromEntries(
	bridgedOperationSpecs.map((operation) => [operation.id, operation]),
) as Readonly<Record<BridgedOperationId, AnyOperationSpec>>;

export function bindBridgedOperationSpec<
	const Id extends BridgedOperationId,
>(operationId: Id): (typeof bridgedOperationSpecsById)[Id] {
	const operation = bridgedOperationSpecsById[operationId];
	if (operation === undefined) {
		throw new TypeError(`Missing bridged operation spec ${operationId}`);
	}
	return operation;
}
