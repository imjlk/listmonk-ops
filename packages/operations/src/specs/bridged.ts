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

const bridgedOperationDeclarations = [] as const satisfies readonly BridgedOperationDeclaration[];

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
