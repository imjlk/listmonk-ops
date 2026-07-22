import type { ObjectJsonSchema, OperationSafety } from "./operation";
import type { z } from "zod";

/**
 * The minimum metadata needed to derive execution requirements without
 * coupling the policy to a transport or runtime context.
 */
export type OperationExecutionPolicySource = Readonly<{
	id: string;
	safety: OperationSafety;
	inputJsonSchema: ObjectJsonSchema;
}>;

export type OperationExecutionInputSource = Readonly<{
	inputSchema: z.ZodType;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

/**
 * Resolves the effective dry-run value after the operation's input schema has
 * applied preprocessing and defaults. Invalid input intentionally returns
 * undefined so the named operation invoker remains the validation authority.
 */
export function getOperationEffectiveDryRun(
	operation: OperationExecutionInputSource,
	input: unknown,
): boolean | undefined {
	const parsedInput = operation.inputSchema.safeParse(input ?? {});
	if (!parsedInput.success || !isRecord(parsedInput.data)) {
		return undefined;
	}

	const dryRun = parsedInput.data.dry_run;
	return typeof dryRun === "boolean" ? dryRun : undefined;
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
