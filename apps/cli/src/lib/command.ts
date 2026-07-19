import * as clack from "@clack/prompts";
import { type ArgSchema, define, type SubCommandable } from "gunshi";
import type { output, ZodType } from "zod";

type OptionConfig = {
	description?: string;
	fileType?: "path" | "file" | "directory";
};

type CliOption<Schema extends ZodType = ZodType> = {
	schema: Schema;
	config: OptionConfig;
};

type OptionMap = Record<string, CliOption>;

type InferFlags<Options extends OptionMap> = {
	[Key in keyof Options]: Options[Key] extends CliOption<infer Schema>
		? output<Schema>
		: never;
};

type RuntimeFlags = {
	interactive?: boolean;
	tui?: boolean;
};

export type PromptRuntime = {
	clack: typeof clack;
};

export type HandlerArgs<
	Flags extends Record<string, unknown> = Record<string, unknown>,
> = {
	flags: Flags & RuntimeFlags;
	spinner: typeof clack.spinner;
	prompt: PromptRuntime;
	terminal: {
		isInteractive: boolean;
	};
};

type CliCommand = SubCommandable & { name: string };

const booleanOptionNames = new Set<string>();
let runtimeFlags: RuntimeFlags = {};

export function getRuntimeFlags(): Readonly<RuntimeFlags> {
	return runtimeFlags;
}

export function option<const Schema extends ZodType>(
	schema: Schema,
	config: OptionConfig = {},
): CliOption<Schema> {
	return { schema, config };
}

function formatValidationError(error: {
	issues: { message: string }[];
}): string {
	return error.issues.map((issue) => issue.message).join("; ");
}

function createArgSchema(name: string, definition: CliOption): ArgSchema {
	const defaultResult = definition.schema.safeParse(undefined);
	const description = definition.config.description;

	if (defaultResult.success && typeof defaultResult.data === "boolean") {
		booleanOptionNames.add(name);
		return {
			type: "boolean",
			description,
			default: defaultResult.data,
			negatable: true,
		};
	}

	const arg: ArgSchema = {
		type: "custom",
		description,
		metavar: definition.config.fileType === "path" ? "PATH" : "VALUE",
		parse(value) {
			const result = definition.schema.safeParse(value);
			if (!result.success) {
				throw new TypeError(formatValidationError(result.error));
			}
			return result.data;
		},
	};

	if (!defaultResult.success) {
		arg.required = true;
	} else if (
		typeof defaultResult.data === "string" ||
		typeof defaultResult.data === "number"
	) {
		arg.default = defaultResult.data;
	}

	return arg;
}

export function defineCommand<
	const Options extends OptionMap = OptionMap,
>(config: {
	name: string;
	description?: string;
	options?: Options;
	handler: (args: HandlerArgs<InferFlags<Options>>) => void | Promise<void>;
}): CliCommand {
	const args = Object.fromEntries(
		Object.entries(config.options ?? {}).map(([name, definition]) => [
			name,
			createArgSchema(name, definition),
		]),
	);

	return define({
		name: config.name,
		description: config.description,
		args,
		async run(context) {
			await config.handler({
				flags: {
					...runtimeFlags,
					...context.values,
				} as InferFlags<Options> & RuntimeFlags,
				spinner: clack.spinner,
				prompt: { clack },
				terminal: {
					isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
				},
			});
		},
	}) as CliCommand;
}

export function defineGroup(config: {
	name: string;
	description?: string;
	commands: CliCommand[];
}): CliCommand {
	const subCommands = Object.fromEntries(
		config.commands.map((command) => [command.name, command]),
	);

	return define({
		name: config.name,
		description: config.description,
		subCommands,
		run: () => undefined,
	}) as CliCommand;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
	if (value === undefined) {
		return fallback;
	}
	return value.toLowerCase() !== "false";
}

export function prepareCliArgv(input: string[]): string[] {
	runtimeFlags = {};
	const args: string[] = [];

	for (let index = 0; index < input.length; index += 1) {
		const token = input[index];
		if (token === undefined) {
			continue;
		}
		if (token === "--") {
			args.push(...input.slice(index));
			break;
		}

		const globalMatch = token.match(/^--(interactive|tui)(?:=(true|false))?$/);
		if (token === "-i" || globalMatch) {
			const key = token === "-i" ? "interactive" : globalMatch?.[1];
			const inlineValue = globalMatch?.[2];
			const nextValue = input[index + 1];
			const consumesNext =
				inlineValue === undefined && /^(true|false)$/i.test(nextValue ?? "");
			if (key === "interactive" || key === "tui") {
				runtimeFlags[key] = parseBoolean(
					inlineValue ?? (consumesNext ? nextValue : undefined),
					true,
				);
			}
			if (consumesNext) {
				index += 1;
			}
			continue;
		}

		const negatedGlobalMatch = token.match(/^--no-(interactive|tui)$/);
		if (negatedGlobalMatch) {
			const key = negatedGlobalMatch[1];
			if (key === "interactive" || key === "tui") {
				runtimeFlags[key] = false;
			}
			continue;
		}

		const optionMatch = token.match(/^--([^=]+)(?:=(true|false))?$/);
		const optionName = optionMatch?.[1];
		if (optionName && booleanOptionNames.has(optionName)) {
			const inlineValue = optionMatch?.[2];
			const nextValue = input[index + 1];
			const consumesNext =
				inlineValue === undefined && /^(true|false)$/i.test(nextValue ?? "");
			const value = parseBoolean(
				inlineValue ?? (consumesNext ? nextValue : undefined),
				true,
			);
			args.push(value ? `--${optionName}` : `--no-${optionName}`);
			if (consumesNext) {
				index += 1;
			}
			continue;
		}

		args.push(token);
	}

	if (args[0] === "completions") {
		args[0] = "complete";
	}

	return args;
}
