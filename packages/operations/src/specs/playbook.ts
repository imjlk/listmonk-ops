import type { OperationId } from "./retry";

export type OperationPlaybookPrimitive = string | number | boolean | null;

export interface OperationPlaybookInput {
	name: string;
	type: "string" | "number" | "boolean";
	required: boolean;
	description: string;
}

export type OperationPlaybookValueSource =
	| {
			kind: "playbook-input";
			name: string;
		}
	| {
			kind: "step-output";
			stepId: string;
			path: string;
		}
	| {
			kind: "literal";
			value: OperationPlaybookPrimitive;
		};

export interface OperationPlaybookInputBinding {
	parameter: string;
	source: OperationPlaybookValueSource;
}

export interface OperationPlaybookResultGuard {
	path: string;
	operator: "equals" | "not-equals";
	expected: OperationPlaybookPrimitive;
	onFailure: "stop";
	message: string;
}

export interface OperationPlaybookStep {
	id: string;
	operation: OperationId;
	approval: "none" | "human";
	description: string;
	dependsOn: readonly string[];
	input: readonly OperationPlaybookInputBinding[];
	resultGuard?: OperationPlaybookResultGuard | undefined;
}

export interface OperationPlaybook {
	id: `${string}.${string}`;
	title: string;
	goal: string;
	inputs: readonly OperationPlaybookInput[];
	steps: readonly [OperationPlaybookStep, ...OperationPlaybookStep[]];
	recoveryOperation: OperationId;
}

const PLAYBOOK_ID_PATTERN =
	/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

function assertNonBlank(value: string, label: string): void {
	if (value.trim().length === 0) {
		throw new TypeError(`${label} must not be blank`);
	}
}

function assertDistinct(values: readonly string[], label: string): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			throw new TypeError(`${label} contains duplicate value: ${value}`);
		}
		seen.add(value);
	}
}

export function defineOperationPlaybook<
	const Playbook extends OperationPlaybook,
>(playbook: Playbook): Playbook {
	if (!PLAYBOOK_ID_PATTERN.test(playbook.id)) {
		throw new TypeError(`Invalid operation playbook id: ${playbook.id}`);
	}
	assertNonBlank(playbook.title, `Operation playbook ${playbook.id} title`);
	assertNonBlank(playbook.goal, `Operation playbook ${playbook.id} goal`);
	for (const input of playbook.inputs) {
		assertNonBlank(input.name, `Operation playbook ${playbook.id} input name`);
		assertNonBlank(
			input.description,
			`Operation playbook ${playbook.id} input ${input.name} description`,
		);
	}
	for (const step of playbook.steps) {
		assertNonBlank(step.id, `Operation playbook ${playbook.id} step id`);
	}
	assertDistinct(
		playbook.inputs.map((input) => input.name),
		`Operation playbook ${playbook.id} inputs`,
	);
	assertDistinct(
		playbook.steps.map((step) => step.id),
		`Operation playbook ${playbook.id} steps`,
	);

	const inputNames = new Set(playbook.inputs.map((input) => input.name));
	const priorStepIds = new Set<string>();
	for (const step of playbook.steps) {
		assertNonBlank(
			step.description,
			`Operation playbook ${playbook.id} step ${step.id} description`,
		);
		for (const dependency of step.dependsOn) {
			if (!priorStepIds.has(dependency)) {
				throw new TypeError(
					`Operation playbook ${playbook.id} step ${step.id} depends on unavailable prior step ${dependency}`,
				);
			}
		}
		for (const binding of step.input) {
			assertNonBlank(
				binding.parameter,
				`Operation playbook ${playbook.id} step ${step.id} input parameter`,
			);
			if (
				binding.source.kind === "playbook-input" &&
				!inputNames.has(binding.source.name)
			) {
				throw new TypeError(
					`Operation playbook ${playbook.id} step ${step.id} references unknown playbook input ${binding.source.name}`,
				);
			}
			if (binding.source.kind === "step-output") {
				if (!priorStepIds.has(binding.source.stepId)) {
					throw new TypeError(
						`Operation playbook ${playbook.id} step ${step.id} references unavailable prior step output ${binding.source.stepId}`,
					);
				}
				assertNonBlank(
					binding.source.path,
					`Operation playbook ${playbook.id} step ${step.id} source path`,
				);
			}
		}
		assertDistinct(
			step.input.map((binding) => binding.parameter),
			`Operation playbook ${playbook.id} step ${step.id} input bindings`,
		);
		if (step.resultGuard !== undefined) {
			assertNonBlank(
				step.resultGuard.path,
				`Operation playbook ${playbook.id} step ${step.id} result guard path`,
			);
			assertNonBlank(
				step.resultGuard.message,
				`Operation playbook ${playbook.id} step ${step.id} result guard message`,
			);
		}
		priorStepIds.add(step.id);
	}
	return playbook;
}
