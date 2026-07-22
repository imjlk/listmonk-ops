import type { ObjectJsonSchema, OperationSafety } from "./operation";

/**
 * The minimum metadata needed to derive execution requirements without
 * coupling the policy to a transport or runtime context.
 */
export type OperationExecutionPolicySource = Readonly<{
	id: string;
	safety: OperationSafety;
	inputJsonSchema: ObjectJsonSchema;
}>;

/**
 * Transport-neutral execution requirements derived from an operation's
 * existing safety declaration and input contract.
 */
export type OperationExecutionPolicy = Readonly<{
	confirmationRequired: boolean;
	auditRequired: boolean;
	dryRunSupported: boolean;
}>;

export class OperationConfirmationRequiredError extends Error {
	public readonly operationId: string;

	public constructor(operationId: string) {
		super(`Operation ${operationId} requires explicit confirmation`);
		this.name = "OperationConfirmationRequiredError";
		this.operationId = operationId;
	}
}

function isBooleanSchema(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "boolean"
	);
}

function supportsDryRunInput(inputJsonSchema: ObjectJsonSchema): boolean {
	return isBooleanSchema(inputJsonSchema.properties?.dry_run);
}

/**
 * Destructive operations require an explicit transport confirmation. Every
 * write is auditable, while dry-run support is opt-in through a real boolean
 * `dry_run` input rather than a synthetic simulation of a remote mutation.
 */
export function getOperationExecutionPolicy(
	operation: OperationExecutionPolicySource,
): OperationExecutionPolicy {
	return {
		confirmationRequired: operation.safety.destructiveHint,
		auditRequired: !operation.safety.readOnlyHint,
		dryRunSupported: supportsDryRunInput(operation.inputJsonSchema),
	};
}

export function assertOperationConfirmation(
	operation: OperationExecutionPolicySource,
	confirmed: boolean,
): void {
	if (
		getOperationExecutionPolicy(operation).confirmationRequired &&
		!confirmed
	) {
		throw new OperationConfirmationRequiredError(operation.id);
	}
}
