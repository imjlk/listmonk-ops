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
