import type { ProductResourceKind } from "./effect";

export interface ProductResource<State extends string = string> {
	id: ProductResourceKind;
	title: string;
	states: readonly State[];
	transitions: Readonly<Partial<Record<State, readonly State[]>>>;
	terminalStates: readonly State[];
}

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

export function defineProductResource<const State extends string>(
	resource: ProductResource<State>,
): ProductResource<State> {
	assertNonBlank(resource.id, "Product resource id");
	assertNonBlank(resource.title, `Product resource ${resource.id} title`);
	if (resource.states.length === 0) {
		throw new TypeError(`Product resource ${resource.id} must define states`);
	}
	assertDistinct(resource.states, `Product resource ${resource.id} states`);
	assertDistinct(
		resource.terminalStates,
		`Product resource ${resource.id} terminal states`,
	);

	const stateSet = new Set<string>(resource.states);
	for (const state of resource.states) {
		assertNonBlank(state, `Product resource ${resource.id} state`);
	}
	for (const from of Object.keys(resource.transitions)) {
		if (!stateSet.has(from)) {
			throw new TypeError(
				`Product resource ${resource.id} transition has unknown source state: ${from}`,
			);
		}
	}
	for (const from of resource.states) {
		const targets = resource.transitions[from] ?? [];
		for (const target of targets) {
			if (!stateSet.has(target)) {
				throw new TypeError(
					`Product resource ${resource.id} transition has unknown target state: ${target}`,
				);
			}
		}
	}
	for (const terminalState of resource.terminalStates) {
		if (!stateSet.has(terminalState)) {
			throw new TypeError(
				`Product resource ${resource.id} has unknown terminal state: ${terminalState}`,
			);
		}
		if ((resource.transitions[terminalState] ?? []).length > 0) {
			throw new TypeError(
				`Product resource ${resource.id} terminal state ${terminalState} must not have outgoing transitions`,
			);
		}
	}
	return resource;
}
