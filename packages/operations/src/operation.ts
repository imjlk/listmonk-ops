import { z } from "zod";
import {
	assertOperationSpecMigrationExemptionActive,
	assertRuntimeOperationProjection,
	type AnyOperationSpec,
	type OperationSpecMigrationExemption,
} from "./specs";

export type ObjectJsonSchema = {
	$schema?: string;
	type: "object";
	properties?: Record<string, object>;
	required?: string[];
	[key: string]: unknown;
};

export interface OperationSafety {
	readOnlyHint: boolean;
	destructiveHint: boolean;
	idempotentHint: boolean;
	openWorldHint: boolean;
}

export interface OperationMcpMetadata {
	name: string;
	legacySuccessText?:
		| string
		| ((output: Record<string, unknown>) => string);
}

export interface OperationDefinition<
	Context,
	InputSchema extends z.ZodType,
	OutputSchema extends z.ZodType,
> {
	id: string;
	title: string;
	description: string;
	inputSchema: InputSchema;
	outputSchema: OutputSchema;
	inputJsonSchema: ObjectJsonSchema;
	outputJsonSchema: ObjectJsonSchema;
	safety: OperationSafety;
	mcp: OperationMcpMetadata;
	spec?: AnyOperationSpec | undefined;
	specMigration?: OperationSpecMigrationExemption | undefined;
	invoke(context: Context, input: unknown): Promise<z.output<OutputSchema>>;
}

export class OperationInputError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "OperationInputError";
	}
}

export class OperationOutputError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "OperationOutputError";
	}
}

export class OperationExecutionError extends Error {
	public readonly operationId: string;

	public constructor(operationId: string, cause: unknown) {
		super(toErrorMessage(cause), { cause });
		this.name = "OperationExecutionError";
		this.operationId = operationId;
	}
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (error && typeof error === "object" && "message" in error) {
		return String(error.message);
	}
	return String(error);
}

function toObjectJsonSchema(
	schema: z.ZodType,
	io: "input" | "output",
): ObjectJsonSchema {
	const jsonSchema = z.toJSONSchema(schema, { io });
	if (jsonSchema.type !== "object") {
		throw new TypeError("Operation schemas must have an object root");
	}
	return jsonSchema as ObjectJsonSchema;
}

function hasRequiredValue(input: unknown, key: PropertyKey): boolean {
	if (!input || typeof input !== "object" || !(key in input)) {
		return false;
	}

	const value = Reflect.get(input, key);
	if (value === null || value === undefined) {
		return false;
	}
	if (typeof value === "string") {
		return value.trim().length > 0;
	}
	if (Array.isArray(value)) {
		return value.length > 0;
	}
	return true;
}

function formatInputError(error: z.ZodError, input: unknown): string {
	const issue = error.issues[0];
	if (!issue) {
		return "Invalid operation input";
	}

	const root = issue.path[0];
	const parameter = issue.path.map(String).join(".") || "input";
	if (
		(typeof root === "string" || typeof root === "number") &&
		!hasRequiredValue(input, root)
	) {
		return `Missing required parameter: ${String(root)}`;
	}

	return `Invalid parameter ${parameter}: ${issue.message}`;
}

export function parseOperationInput<const InputSchema extends z.ZodType>(
	schema: InputSchema,
	input: unknown,
): z.output<InputSchema> {
	const parsedInput = schema.safeParse(input ?? {});
	if (!parsedInput.success) {
		throw new OperationInputError(
			formatInputError(parsedInput.error, input ?? {}),
		);
	}
	return parsedInput.data;
}

/**
 * Union of operation-scoped error types that can escape an invoker. Members
 * preserve their concrete class so callers can narrow on `instanceof` and
 * read typed metadata (e.g. `TransactionalReconcileError.status`).
 */
export type OperationError =
	| OperationExecutionError
	| OperationInputError
	| OperationOutputError;

export function normalizeOperationExecutionError(
	operationId: string,
	error: unknown,
): OperationError {
	// Domain errors already carry operation-scoped context and typed
	// metadata (validation path, reconcile-required status). Preserve them
	// verbatim rather than re-wrapping into a generic execution error, so
	// the concrete class and its typed fields survive the boundary.
	if (
		error instanceof OperationExecutionError ||
		error instanceof OperationInputError ||
		error instanceof OperationOutputError
	) {
		return error;
	}
	return new OperationExecutionError(operationId, error);
}

export function parseOperationOutput<const OutputSchema extends z.ZodType>(
	operationId: string,
	schema: OutputSchema,
	output: unknown,
): z.output<OutputSchema> {
	const parsedOutput = schema.safeParse(output);
	if (!parsedOutput.success) {
		throw new OperationOutputError(
			`${operationId} produced invalid output: ${parsedOutput.error.message}`,
		);
	}
	return parsedOutput.data;
}

export function defineOperation<
	Context,
	const InputSchema extends z.ZodType,
	const OutputSchema extends z.ZodType,
>(
	config: {
	id: string;
	title: string;
	description: string;
	inputSchema: InputSchema;
	outputSchema: OutputSchema;
	parseInput?(input: unknown): z.output<InputSchema>;
	normalizeError?(error: unknown): OperationError;
	safety: OperationSafety;
	mcp: OperationMcpMetadata;
	execute(
		context: Context,
		input: z.output<InputSchema>,
	): Promise<z.output<OutputSchema>>;
} & (
		| {
				spec: AnyOperationSpec;
				specMigration?: never;
		  }
		| {
				spec?: never;
				specMigration: OperationSpecMigrationExemption;
		  }
	)): OperationDefinition<Context, InputSchema, OutputSchema> {
	const inputJsonSchema = toObjectJsonSchema(config.inputSchema, "input");
	const outputJsonSchema = toObjectJsonSchema(config.outputSchema, "output");
	if (config.spec !== undefined) {
		assertRuntimeOperationProjection(config.spec, {
			id: config.id,
			title: config.title,
			description: config.description,
			mcpName: config.mcp.name,
			safety: config.safety,
		});
	} else {
		if (config.specMigration.operationId !== config.id) {
			throw new TypeError(
				`Runtime operation ${config.id} binds mismatched spec migration exemption ${config.specMigration.operationId}`,
			);
		}
		assertOperationSpecMigrationExemptionActive(config.specMigration);
	}
	return {
		id: config.id,
		title: config.title,
		description: config.description,
		inputSchema: config.inputSchema,
		outputSchema: config.outputSchema,
		inputJsonSchema,
		outputJsonSchema,
		safety: config.safety,
		mcp: config.mcp,
		...(config.spec === undefined ? {} : { spec: config.spec }),
		...(config.specMigration === undefined
			? {}
			: { specMigration: config.specMigration }),
		async invoke(context, input) {
			const parsedInput = config.parseInput
				? config.parseInput(input)
				: parseOperationInput(config.inputSchema, input);

			let output: z.output<OutputSchema>;
			try {
				output = await config.execute(context, parsedInput);
			} catch (error) {
				throw config.normalizeError
					? config.normalizeError(error)
					: normalizeOperationExecutionError(config.id, error);
			}
			return parseOperationOutput(config.id, config.outputSchema, output);
		},
	};
}
