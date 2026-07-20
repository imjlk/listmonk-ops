import { z } from "zod";

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
	legacySuccessText?: string;
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

function toObjectJsonSchema(schema: z.ZodType): ObjectJsonSchema {
	const jsonSchema = z.toJSONSchema(schema);
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

export function defineOperation<
	Context,
	const InputSchema extends z.ZodType,
	const OutputSchema extends z.ZodType,
>(config: {
	id: string;
	title: string;
	description: string;
	inputSchema: InputSchema;
	outputSchema: OutputSchema;
	safety: OperationSafety;
	mcp: OperationMcpMetadata;
	execute(
		context: Context,
		input: z.output<InputSchema>,
	): Promise<unknown>;
}): OperationDefinition<Context, InputSchema, OutputSchema> {
	return {
		id: config.id,
		title: config.title,
		description: config.description,
		inputSchema: config.inputSchema,
		outputSchema: config.outputSchema,
		inputJsonSchema: toObjectJsonSchema(config.inputSchema),
		outputJsonSchema: toObjectJsonSchema(config.outputSchema),
		safety: config.safety,
		mcp: config.mcp,
		async invoke(context, input) {
			const parsedInput = config.inputSchema.safeParse(input ?? {});
			if (!parsedInput.success) {
				throw new OperationInputError(
					formatInputError(parsedInput.error, input ?? {}),
				);
			}

			const output = await config.execute(context, parsedInput.data);
			const parsedOutput = config.outputSchema.safeParse(output);
			if (!parsedOutput.success) {
				throw new OperationOutputError(
					`${config.id} produced invalid output: ${parsedOutput.error.message}`,
				);
			}
			return parsedOutput.data;
		},
	};
}
