import type { AgentOperationContext } from "./agent";
import type { OperationEffect, OperationResourceKind } from "./effect";
import type {
	NormalizedContractSchema,
} from "./json";
import {
	assertPolicyMatchesEffects,
	expectedPolicyForEffects,
	type OperationPolicy,
	type PolicyForEffects,
} from "./policy";
import {
	assertRetryGuidanceMatchesSemantics,
	type RetrySemantics,
} from "./retry";

export type OperationSpecVerb =
	| "list"
	| "get"
	| "create"
	| "update"
	| "delete"
	| "schedule"
	| "send"
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
	| "deploy-winner"
	| "stats"
	| "analytics"
	| "counts"
	| "charts"
	| "status"
	| "doctor"
	| "quota"
	| "webhook-status"
	| "dns-check"
	| "diff"
	| "preflight"
	| "blocklist"
	| "search"
	| "describe"
	| "capabilities"
	| "prime"
	| "test"
	| "dispatch"
	| "retry"
	| "prune"
	| "tick"
	| "ingest"
	| "replay"
	| "reset"
	| "validate"
	| "enroll"
	| "resume"
	| "clone"
	| "set-default"
	| "upload"
	| "add-to-lists"
	| "remove-from-lists"
	| "unblocklist"
	| "guard"
	| "deliverability-guard"
	| "hygiene"
	| "drift"
	| "sync"
	| "registry-sync"
	| "history"
	| "registry-history"
	| "promote"
	| "registry-promote"
	| "rollback"
	| "registry-rollback"
	| "daily"
	| "stop"
	| "recommend-sample-size"
	| "run"
	| "export-assignment";

export type OperationSpecLifecycle =
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

export interface OperationStateTransitionSpec {
	resource: OperationResourceKind;
	from: readonly string[];
	to: string;
	allowNoopFromTarget: boolean;
}

export interface OperationProjectionSpec {
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

export interface OperationContractSpec {
	input: NormalizedContractSchema;
	output: NormalizedContractSchema;
}

interface OperationSpecBase {
	id: `${string}.${string}`;
	resource: OperationResourceKind;
	verb: OperationSpecVerb;
	title: string;
	description: string;
	contract: OperationContractSpec;
	retry: RetrySemantics;
	state?: OperationStateTransitionSpec | undefined;
	agent: AgentOperationContext;
	projection: OperationProjectionSpec;
}

export type OperationSpec<
	Effects extends readonly OperationEffect[] = readonly OperationEffect[],
> = OperationSpecBase & {
	effects: Effects;
	policy: PolicyForEffects<Effects>;
} & OperationSpecLifecycle;

export type AnyOperationSpec = OperationSpecBase & {
	effects: readonly OperationEffect[];
	policy: OperationPolicy;
} & OperationSpecLifecycle;

export type DerivedPolicyOperationSpec<
	Effects extends readonly OperationEffect[],
> = Omit<OperationSpec<Effects>, "policy">;

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
	contract: NormalizedContractSchema,
): void {
	const rootType = contract.schema.type;
	const hasObjectReference =
		typeof contract.schema.$ref === "string" &&
		contract.schema.$ref.length > 0;
	const hasObjectComposition = ["allOf", "anyOf", "oneOf"].some((keyword) => {
		const branches = contract.schema[keyword];
		return Array.isArray(branches) && branches.length > 0;
	});
	if (
		rootType !== "object" &&
		!hasObjectReference &&
		!hasObjectComposition
	) {
		throw new TypeError(
			`Operation spec ${operationId} ${direction} contract must have an object root, reference, or composition`,
		);
	}
}

export function defineOperationSpec<
	const Effects extends readonly OperationEffect[],
>(
	operation: OperationSpec<Effects>,
): OperationSpec<Effects> {
	if (!OPERATION_ID_PATTERN.test(operation.id)) {
		throw new TypeError(`Invalid operation spec id: ${operation.id}`);
	}
	if (!MCP_NAME_PATTERN.test(operation.projection.mcpName)) {
		throw new TypeError(
			`Invalid operation spec MCP name: ${operation.projection.mcpName}`,
		);
	}
	assertNonBlank(operation.title, `Operation spec ${operation.id} title`);
	assertNonBlank(
		operation.description,
		`Operation spec ${operation.id} description`,
	);
	if (operation.effects.length === 0) {
		throw new TypeError(
			`Operation spec ${operation.id} must declare at least one effect`,
		);
	}
	const idVerb = operation.id.slice(operation.id.lastIndexOf(".") + 1);
	if (idVerb !== operation.verb) {
		throw new TypeError(
			`Operation spec ${operation.id} id verb (${idVerb}) must match declared verb (${operation.verb})`,
		);
	}
	if (operation.state !== undefined) {
		if (operation.state.resource !== operation.resource) {
			throw new TypeError(
				`Operation spec ${operation.id} state resource (${operation.state.resource}) must match operation resource (${operation.resource})`,
			);
		}
		if (operation.state.from.length === 0) {
			throw new TypeError(
				`Operation spec ${operation.id} state transition must declare at least one source state`,
			);
		}
		for (const source of operation.state.from) {
			assertNonBlank(
				source,
				`Operation spec ${operation.id} state transition source`,
			);
		}
		assertNonBlank(
			operation.state.to,
			`Operation spec ${operation.id} state transition target`,
		);
	}
	assertPolicyMatchesEffects(
		operation.effects,
		operation.policy as OperationPolicy,
	);
	for (const [label, nodePath] of Object.entries(operation.projection.graph)) {
		assertNonBlank(
			nodePath,
			`Operation spec ${operation.id} projection graph ${label}`,
		);
	}
	assertObjectContractSchema(operation.id, "input", operation.contract.input);
	assertObjectContractSchema(operation.id, "output", operation.contract.output);
	for (const guidance of [
		...operation.agent.useWhen,
		...operation.agent.avoidWhen,
		operation.agent.retryGuidance,
	]) {
		assertNonBlank(guidance, `Operation spec ${operation.id} agent guidance`);
	}
	assertRetryGuidanceMatchesSemantics(
		operation.id,
		operation.retry,
		operation.agent.retryGuidance,
	);
	if (operation.retry.kind === "conditional") {
		for (const retryCase of operation.retry.cases) {
			assertNonBlank(
				retryCase.when,
				`Operation spec ${operation.id} conditional retry predicate`,
			);
			assertNonBlank(
				retryCase.semantics.reason,
				`Operation spec ${operation.id} conditional retry reason`,
			);
		}
	}
	assertNonBlank(
		operation.retry.reason,
		`Operation spec ${operation.id} retry reason`,
	);
	const operationId = operation.id;
	const lifecycle: OperationSpecLifecycle = operation;
	if (
		lifecycle.stability === "deprecated" &&
		lifecycle.deprecated === undefined
	) {
		throw new TypeError(
			`Deprecated operation spec ${operationId} must declare replacedBy`,
		);
	}
	if (
		lifecycle.stability !== "deprecated" &&
		lifecycle.deprecated !== undefined
	) {
		throw new TypeError(
			`Active operation spec ${operationId} must not declare deprecated metadata`,
		);
	}
	if (
		lifecycle.stability === "stable" &&
		(operation.contract.input.source !== "typescript" ||
			operation.contract.output.source !== "typescript")
	) {
		throw new TypeError(
			`Stable operation spec ${operationId} must use TypeScript-authored input and output contracts`,
		);
	}
	return operation;
}

/**
 * Declare an operation and derive its safety policy from typed effects.
 * Product declarations choose effects; confirmation, audit, and dry-run
 * policy cannot be weakened independently.
 */
export function defineOperationSpecFromEffects<
	const Effects extends readonly OperationEffect[],
>(
	operation: DerivedPolicyOperationSpec<Effects>,
): OperationSpec<Effects> {
	return defineOperationSpec({
		...operation,
		policy: expectedPolicyForEffects(operation.effects),
	} as OperationSpec<Effects>);
}
