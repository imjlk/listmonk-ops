import type { OperationEventSpec } from "./event";
import type { AnyOperationSpec } from "./operation";
import type { OperationPlaybook } from "./playbook";
import type { OperationResourceSpec } from "./resource";

export interface EmailOperationsSpec {
	schemaVersion: string;
	title: string;
	description: string;
	resources: readonly OperationResourceSpec[];
	operations: readonly AnyOperationSpec[];
	events: readonly OperationEventSpec[];
	playbooks: readonly OperationPlaybook[];
}

function assertDistinct(
	values: readonly string[],
	label: string,
): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			throw new TypeError(
				`Operations spec contains duplicate ${label}: ${value}`,
			);
		}
		seen.add(value);
	}
}

function validateStateTransition(
	operation: AnyOperationSpec,
	resources: ReadonlyMap<string, OperationResourceSpec>,
): void {
	if (operation.state === undefined) {
		return;
	}
	if (operation.state.resource !== operation.resource) {
		throw new TypeError(
			`Operation spec ${operation.id} state resource does not match operation resource`,
		);
	}
	const resource = resources.get(operation.state.resource);
	if (!resource) {
		throw new TypeError(
			`Operation spec ${operation.id} references unknown state resource ${operation.state.resource}`,
		);
	}
	const states = new Set<string>(resource.states);
	if (!states.has(operation.state.to)) {
		throw new TypeError(
			`Operation spec ${operation.id} has unknown target state ${operation.state.to}`,
		);
	}
	if (operation.state.from.length === 0) {
		throw new TypeError(
			`Operation spec ${operation.id} state transition must declare at least one source state`,
		);
	}
	for (const from of operation.state.from) {
		if (!states.has(from)) {
			throw new TypeError(
				`Operation spec ${operation.id} has unknown source state ${from}`,
			);
		}
		const allowed = resource.transitions[from] ?? [];
		if (!allowed.includes(operation.state.to)) {
			throw new TypeError(
				`Operation spec ${operation.id} declares invalid transition ${from} -> ${operation.state.to}`,
			);
		}
	}
}

export function defineEmailOperationsSpec(
	schema: EmailOperationsSpec,
): EmailOperationsSpec {
	if (schema.resources.length === 0) {
		throw new TypeError("Operations spec must define resources");
	}
	if (schema.operations.length === 0) {
		throw new TypeError("Operations spec must define operations");
	}
	assertDistinct(
		schema.resources.map((resource) => resource.id),
		"resource id",
	);
	assertDistinct(
		schema.operations.map((operation) => operation.id),
		"operation id",
	);
	assertDistinct(
		schema.operations.map((operation) => operation.projection.mcpName),
		"MCP name",
	);
	assertDistinct(
		schema.playbooks.map((playbook) => playbook.id),
		"playbook id",
	);
	assertDistinct(
		schema.events.map((event) => event.type),
		"event type",
	);

	const resources = new Map(
		schema.resources.map((resource) => [resource.id, resource] as const),
	);
	const operationsById = new Map(
		schema.operations.map((operation) => [operation.id, operation] as const),
	);
	for (const operation of schema.operations) {
		if (!resources.has(operation.resource)) {
			throw new TypeError(
				`Operation spec ${operation.id} references unknown resource ${operation.resource}`,
			);
		}
		validateStateTransition(operation, resources);
	}
	for (const event of schema.events) {
		if (!resources.has(event.subject)) {
			throw new TypeError(
				`Operation event spec ${event.type} references unknown resource ${event.subject}`,
			);
		}
	}
	for (const playbook of schema.playbooks) {
		for (const step of playbook.steps) {
			const operation = operationsById.get(step.operation);
			if (operation === undefined) {
				throw new TypeError(
					`Operation playbook ${playbook.id} step ${step.id} references unknown operation ${step.operation}`,
				);
			}
			if (
				operation.policy.confirmation === "required" &&
				step.approval !== "human"
			) {
				throw new TypeError(
					`Operation playbook ${playbook.id} step ${step.id} must require human approval for ${step.operation}`,
				);
			}
		}
		if (!operationsById.has(playbook.recoveryOperation)) {
			throw new TypeError(
				`Operation playbook ${playbook.id} references unknown recovery operation ${playbook.recoveryOperation}`,
			);
		}
	}
	return schema;
}
