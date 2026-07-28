import type { AnyProductOperation } from "./operation";
import { cloneProductValue } from "./json";

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

function productOperationIsReadOnly(operation: AnyProductOperation): boolean {
	return operation.effects.every((effect) => effect.kind === "read");
}

function productOperationIsIdempotent(operation: AnyProductOperation): boolean {
	switch (operation.retry.kind) {
		case "safe":
			return true;
		case "reconcile":
			return operation.retry.idempotent;
		case "unsafe":
			return false;
		default: {
			const unhandled: never = operation.retry;
			return unhandled;
		}
	}
}

export function assertRuntimeOperationProjection(
	product: AnyProductOperation,
	runtime: RuntimeOperationProjection,
): void {
	if (runtime.id !== product.id) {
		throw new TypeError(
			`Runtime operation ${runtime.id} does not match product operation ${product.id}`,
		);
	}
	for (const [field, actual, expected] of [
		["title", runtime.title, product.title],
		["description", runtime.description, product.description],
		["mcpName", runtime.mcpName, product.projection.mcpName],
	] as const) {
		if (actual !== expected) {
			throw new TypeError(
				`Runtime operation ${runtime.id} ${field} drifted from its product descriptor: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
			);
		}
	}
	const expectedSafety = {
		readOnlyHint: productOperationIsReadOnly(product),
		destructiveHint: product.policy.confirmation === "required",
		idempotentHint: productOperationIsIdempotent(product),
		openWorldHint: product.projection.openWorld,
	};
	for (const key of Object.keys(expectedSafety) as Array<
		keyof typeof expectedSafety
	>) {
		if (runtime.safety[key] !== expectedSafety[key]) {
			throw new TypeError(
				`Runtime operation ${runtime.id} ${key} drifted from its product descriptor: expected ${String(expectedSafety[key])}, received ${String(runtime.safety[key])}`,
			);
		}
	}
}

export function projectProductOperation(
	operation: AnyProductOperation,
): AnyProductOperation {
	return cloneProductValue(operation);
}
