import type { ProductEventDefinition } from "./event";
import type { AnyProductOperation } from "./operation";
import type { ProductPlaybook } from "./playbook";
import type { ProductResource } from "./resource";

export interface EmailOperationsProductSchema {
	schemaVersion: string;
	title: string;
	description: string;
	resources: readonly ProductResource[];
	operations: readonly AnyProductOperation[];
	events: readonly ProductEventDefinition[];
	playbooks: readonly ProductPlaybook[];
}

function assertDistinct(
	values: readonly string[],
	label: string,
): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			throw new TypeError(
				`Product schema contains duplicate ${label}: ${value}`,
			);
		}
		seen.add(value);
	}
}

function validateStateTransition(
	operation: AnyProductOperation,
	resources: ReadonlyMap<string, ProductResource>,
): void {
	if (operation.state === undefined) {
		return;
	}
	if (operation.state.resource !== operation.resource) {
		throw new TypeError(
			`Product operation ${operation.id} state resource does not match operation resource`,
		);
	}
	const resource = resources.get(operation.state.resource);
	if (!resource) {
		throw new TypeError(
			`Product operation ${operation.id} references unknown state resource ${operation.state.resource}`,
		);
	}
	const states = new Set<string>(resource.states);
	if (!states.has(operation.state.to)) {
		throw new TypeError(
			`Product operation ${operation.id} has unknown target state ${operation.state.to}`,
		);
	}
	for (const from of operation.state.from) {
		if (!states.has(from)) {
			throw new TypeError(
				`Product operation ${operation.id} has unknown source state ${from}`,
			);
		}
		const allowed = resource.transitions[from] ?? [];
		if (!allowed.includes(operation.state.to)) {
			throw new TypeError(
				`Product operation ${operation.id} declares invalid transition ${from} -> ${operation.state.to}`,
			);
		}
	}
}

export function defineEmailOperationsProductSchema(
	schema: EmailOperationsProductSchema,
): EmailOperationsProductSchema {
	if (schema.resources.length === 0) {
		throw new TypeError("Product schema must define resources");
	}
	if (schema.operations.length === 0) {
		throw new TypeError("Product schema must define operations");
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
	const operationIds = new Set(
		schema.operations.map((operation) => operation.id),
	);
	for (const operation of schema.operations) {
		if (!resources.has(operation.resource)) {
			throw new TypeError(
				`Product operation ${operation.id} references unknown resource ${operation.resource}`,
			);
		}
		validateStateTransition(operation, resources);
	}
	for (const event of schema.events) {
		if (!resources.has(event.subject)) {
			throw new TypeError(
				`Product event ${event.type} references unknown resource ${event.subject}`,
			);
		}
	}
	for (const playbook of schema.playbooks) {
		for (const step of playbook.steps) {
			if (!operationIds.has(step.operation)) {
				throw new TypeError(
					`Product playbook ${playbook.id} step ${step.id} references unknown operation ${step.operation}`,
				);
			}
		}
		if (!operationIds.has(playbook.recoveryOperation)) {
			throw new TypeError(
				`Product playbook ${playbook.id} references unknown recovery operation ${playbook.recoveryOperation}`,
			);
		}
	}
	return schema;
}
