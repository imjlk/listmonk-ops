import type { AgentOperationContext } from "./agent";
import type { OperationEffect, ProductResourceKind } from "./effect";
import type {
	ProductContractSchema,
} from "./json";
import {
	assertPolicyMatchesEffects,
	type OperationPolicy,
	type PolicyForEffects,
} from "./policy";
import type { RetrySemantics } from "./retry";

export type ProductOperationVerb =
	| "list"
	| "get"
	| "create"
	| "update"
	| "delete"
	| "schedule"
	| "start"
	| "pause"
	| "cancel"
	| "plan"
	| "apply"
	| "reconcile"
	| "preview"
	| "approve"
	| "launch"
	| "analyze"
	| "deploy"
	| "stats"
	| "status"
	| "doctor"
	| "diff"
	| "blocklist";

export type ProductOperationLifecycle =
	| {
			stability: "experimental" | "stable";
			since: string;
			deprecated?: never;
		}
	| {
			stability: "deprecated";
			since: string;
			deprecated: {
				since: string;
				replacedBy: `${string}.${string}`;
			};
		};

export interface ProductStateTransition {
	resource: ProductResourceKind;
	from: readonly string[];
	to: string;
	allowNoopFromTarget: boolean;
}

export interface ProductOperationProjection {
	mcpName: `listmonk_${string}`;
	openWorld: boolean;
	graph: {
		descriptorNode: string;
		bindingNode: string;
		runtimeDefinitionNode: string;
		invokerNode: string;
		executorNode: string;
	};
}

export interface ProductOperationContract {
	input: ProductContractSchema;
	output: ProductContractSchema;
}

interface ProductOperationBase {
	id: `${string}.${string}`;
	resource: ProductResourceKind;
	verb: ProductOperationVerb;
	title: string;
	description: string;
	contract: ProductOperationContract;
	retry: RetrySemantics;
	state?: ProductStateTransition | undefined;
	agent: AgentOperationContext;
	projection: ProductOperationProjection;
}

export type ProductOperation<
	Effects extends readonly OperationEffect[] = readonly OperationEffect[],
> = ProductOperationBase & {
	effects: Effects;
	policy: PolicyForEffects<Effects>;
} & ProductOperationLifecycle;

export type AnyProductOperation = ProductOperationBase & {
	effects: readonly OperationEffect[];
	policy: OperationPolicy;
} & ProductOperationLifecycle;

const OPERATION_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const MCP_NAME_PATTERN = /^listmonk_[a-z][a-z0-9_]*$/;

function assertNonBlank(value: string, label: string): void {
	if (value.trim().length === 0) {
		throw new TypeError(`${label} must not be blank`);
	}
}

function assertObjectContractSchema(
	operationId: string,
	direction: "input" | "output",
	contract: ProductContractSchema,
): void {
	const rootType = contract.schema.type;
	const hasObjectReference =
		typeof contract.schema.$ref === "string" &&
		contract.schema.$ref.length > 0;
	if (rootType !== "object" && !hasObjectReference) {
		throw new TypeError(
			`Product operation ${operationId} ${direction} contract must have an object root or reference`,
		);
	}
}

export function defineProductOperation<
	const Effects extends readonly OperationEffect[],
>(
	operation: ProductOperation<Effects>,
): ProductOperation<Effects> {
	if (!OPERATION_ID_PATTERN.test(operation.id)) {
		throw new TypeError(`Invalid product operation id: ${operation.id}`);
	}
	if (!MCP_NAME_PATTERN.test(operation.projection.mcpName)) {
		throw new TypeError(
			`Invalid product operation MCP name: ${operation.projection.mcpName}`,
		);
	}
	assertNonBlank(operation.title, `Product operation ${operation.id} title`);
	assertNonBlank(
		operation.description,
		`Product operation ${operation.id} description`,
	);
	if (operation.effects.length === 0) {
		throw new TypeError(
			`Product operation ${operation.id} must declare at least one effect`,
		);
	}
	if (operation.state !== undefined) {
		if (operation.state.from.length === 0) {
			throw new TypeError(
				`Product operation ${operation.id} state transition must declare at least one source state`,
			);
		}
		for (const source of operation.state.from) {
			assertNonBlank(
				source,
				`Product operation ${operation.id} state transition source`,
			);
		}
		assertNonBlank(
			operation.state.to,
			`Product operation ${operation.id} state transition target`,
		);
	}
	assertPolicyMatchesEffects(
		operation.effects,
		operation.policy as OperationPolicy,
	);
	for (const [label, nodePath] of Object.entries(operation.projection.graph)) {
		assertNonBlank(
			nodePath,
			`Product operation ${operation.id} projection graph ${label}`,
		);
	}
	assertObjectContractSchema(operation.id, "input", operation.contract.input);
	assertObjectContractSchema(operation.id, "output", operation.contract.output);
	for (const guidance of [
		...operation.agent.useWhen,
		...operation.agent.avoidWhen,
		operation.agent.retryGuidance,
	]) {
		assertNonBlank(
			guidance,
			`Product operation ${operation.id} agent guidance`,
		);
	}
	const operationId = operation.id;
	const lifecycle: ProductOperationLifecycle = operation;
	if (
		lifecycle.stability === "deprecated" &&
		lifecycle.deprecated === undefined
	) {
		throw new TypeError(
			`Deprecated product operation ${operationId} must declare replacedBy`,
		);
	}
	if (
		lifecycle.stability !== "deprecated" &&
		lifecycle.deprecated !== undefined
	) {
		throw new TypeError(
			`Active product operation ${operationId} must not declare deprecated metadata`,
		);
	}
	return operation;
}
