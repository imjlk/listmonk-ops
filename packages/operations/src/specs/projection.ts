import type { AnyOperationSpec } from "./operation";
import { cloneSpecValue } from "./json";
import type { RetrySemantics, UnconditionalRetrySemantics } from "./retry";

export interface RuntimeOperationProjection {
	id: string;
	title: string;
	description: string;
	mcpName: string;
	safety: {
		readOnlyHint: boolean;
		destructiveHint: boolean;
		idempotentHint: boolean;
		openWorldHint: boolean;
	};
}

const RUNTIME_CONTRACT_CAPTURE = Symbol.for(
	"@listmonk-ops/operations/specs:runtime-contract-capture",
);

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key, nested]) => key !== "$schema" && nested !== undefined)
				.sort(([left], [right]) =>
					left < right ? -1 : left > right ? 1 : 0,
				)
				.map(([key, nested]) => [key, stableValue(nested)]),
		);
	}
	return value;
}

export function assertRuntimeOperationContracts(
	spec: AnyOperationSpec,
	runtime: {
		input: Readonly<Record<string, unknown>>;
		output: Readonly<Record<string, unknown>>;
	},
): void {
	// The explicit snapshot generator sets this process-global flag before
	// dynamically loading every workspace catalog. Without this narrow capture
	// mode, the stale snapshot that needs updating would prevent the generator
	// from observing the new runtime schemas. Normal CLI/MCP startup never sets
	// the flag and remains fail-closed.
	if (Reflect.get(globalThis, RUNTIME_CONTRACT_CAPTURE) === true) {
		return;
	}
	for (const direction of ["input", "output"] as const) {
		const contract = spec.contract[direction];
		if (contract.source !== "runtime-operation") {
			continue;
		}
		const expected = JSON.stringify(stableValue(contract.schema));
		const actual = JSON.stringify(stableValue(runtime[direction]));
		if (actual !== expected) {
			throw new TypeError(
				`Runtime operation ${spec.id} ${direction} contract drifted from its committed operation spec bridge`,
			);
		}
	}
}

function operationSpecIsReadOnly(operation: AnyOperationSpec): boolean {
	return operation.effects.every((effect) => effect.kind === "read");
}

function unconditionalRetryIsIdempotent(
	retry: UnconditionalRetrySemantics,
): boolean {
	switch (retry.kind) {
		case "safe":
			return true;
		case "reconcile":
			return retry.idempotent;
		case "unsafe":
			return false;
		default: {
			const unhandled: never = retry;
			return unhandled;
		}
	}
}

function retryIsIdempotent(retry: RetrySemantics): boolean {
	if (retry.kind === "conditional") {
		return retry.cases.every(({ semantics }) =>
			unconditionalRetryIsIdempotent(semantics),
		);
	}
	return unconditionalRetryIsIdempotent(retry);
}

function operationSpecIsIdempotent(operation: AnyOperationSpec): boolean {
	return retryIsIdempotent(operation.retry);
}

export function assertRuntimeOperationProjection(
	spec: AnyOperationSpec,
	runtime: RuntimeOperationProjection,
): void {
	if (runtime.id !== spec.id) {
		throw new TypeError(
			`Runtime operation ${runtime.id} does not match operation spec ${spec.id}`,
		);
	}
	for (const [field, actual, expected] of [
		["title", runtime.title, spec.title],
		["description", runtime.description, spec.description],
		["mcpName", runtime.mcpName, spec.projection.mcpName],
	] as const) {
		if (actual !== expected) {
			throw new TypeError(
				`Runtime operation ${runtime.id} ${field} drifted from its operation spec: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
			);
		}
	}
	const expectedSafety = {
		readOnlyHint: operationSpecIsReadOnly(spec),
		destructiveHint: spec.policy.confirmation === "required",
		idempotentHint: operationSpecIsIdempotent(spec),
		openWorldHint: spec.projection.openWorld,
	};
	for (const key of Object.keys(expectedSafety) as Array<
		keyof typeof expectedSafety
	>) {
		if (runtime.safety[key] !== expectedSafety[key]) {
			throw new TypeError(
				`Runtime operation ${runtime.id} ${key} drifted from its operation spec: expected ${String(expectedSafety[key])}, received ${String(runtime.safety[key])}`,
			);
		}
	}
}

export function projectOperationSpec(
	operation: AnyOperationSpec,
): AnyOperationSpec {
	return cloneSpecValue(operation);
}
