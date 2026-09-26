import * as clack from "@clack/prompts";
import { type ArgSchema, define, type SubCommandable } from "gunshi";
import type { output, ZodType } from "zod";
import { executeCliOperation } from "../operation-execution";

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
	profile?: string;
	configFile?: string;
	listmonkUrl?: string;
	listmonkUsername?: string;
	tokenFile?: string;
	confirm?: boolean;
	interactive?: boolean;
	tui?: boolean;
	format?: string;
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
/** Plain `no-*` flags that the current argv explicitly set to false. */
let unsetFlagNames: string[] = [];

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

/**
 * Gunshi reads `--no-<name>` as the negation of a negatable boolean, and it
 * also parses a negatable option that is itself named `no-<name>` as `false`
 * whenever it is passed. An option that already spells a negation, such as
 * `--no-body`, is therefore a plain flag: passing it enables what it names.
 */
export function isNegatableBooleanOption(name: string): boolean {
	return !name.startsWith("no-");
}

function createArgSchema(name: string, definition: CliOption): ArgSchema {
	const defaultResult = definition.schema.safeParse(undefined);
	const description = definition.config.description;
	const booleanResult = definition.schema.safeParse(true);

	if (booleanResult.success && typeof booleanResult.data === "boolean") {
		const negatable = isNegatableBooleanOption(name);
		if (!negatable && defaultResult.success && defaultResult.data === true) {
			// An explicit `--no-<name>=false` leaves a plain flag unset, which
			// must mean off.
			throw new Error(
				`Boolean option --${name} cannot default to true because it cannot be negated`,
			);
		}
		booleanOptionNames.add(name);
		return {
			type: "boolean",
			description,
			...(defaultResult.success && typeof defaultResult.data === "boolean"
				? { default: defaultResult.data }
				: {}),
			negatable,
		};
	}

	const arg: ArgSchema = {
		type: "custom",
		description,
		metavar: definition.config.fileType === "path" ? "PATH" : "VALUE",
		parse(value) {
			const result = definition.schema.safeParse(value);
			if (!result.success) {
				throw new TypeError(`--${name}: ${formatValidationError(result.error)}`);
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
	operationId?: string;
	handler: (args: HandlerArgs<InferFlags<Options>>) => unknown | Promise<unknown>;
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
			// prepareCliArgv drops `--no-<name>=false` before Gunshi sees it, so
			// Gunshi's strict check cannot report one this command lacks.
			const unknownFlags = unsetFlagNames.filter(
				(name) => !Object.hasOwn(args, name),
			);
			if (unknownFlags.length > 0) {
				throw new Error(
					`Unknown option: ${unknownFlags.map((name) => `--${name}`).join(", ")}`,
				);
			}
			const handlerArgs: HandlerArgs<InferFlags<Options>> = {
				flags: {
					...context.values,
					...runtimeFlags,
				} as InferFlags<Options> & RuntimeFlags,
				spinner: clack.spinner,
				prompt: { clack },
				terminal: {
					isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
				},
			};

			if (config.operationId) {
				await executeCliOperation({
					operationId: config.operationId,
					input: handlerArgs.flags,
					confirmed: handlerArgs.flags.confirm === true,
					invoke: async () => config.handler(handlerArgs),
				});
				return;
			}

			await config.handler(handlerArgs);
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
	unsetFlagNames = [];
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

		const configurationOptions = {
			"--profile": "profile",
			"--config": "configFile",
			"--listmonk-url": "listmonkUrl",
			"--listmonk-username": "listmonkUsername",
			"--token-file": "tokenFile",
		} as const;
		const separator = token.indexOf("=");
		const configurationOptionName = separator === -1
			? token
			: token.slice(0, separator);
		if (Object.hasOwn(configurationOptions, configurationOptionName)) {
			const key = configurationOptions[configurationOptionName as keyof typeof configurationOptions];
			const value = separator === -1
				? input[index + 1]
				: token.slice(separator + 1);
			if (!value?.trim() || (separator === -1 && value.startsWith("--"))) throw new Error(`${configurationOptionName} requires a value`);
			runtimeFlags[key] = value;
			if (separator === -1) index++;
			continue;
		}

		const globalMatch = token.match(
			/^--(confirm|interactive|tui)(?:=(true|false))?$/,
		);
		const formatMatch = token.match(
			/^--format(?:=(human|json|ndjson|quiet))?$/,
		);
		if (formatMatch) {
			const inlineValue = formatMatch[1];
			const nextValue = input[index + 1];
			if (inlineValue) {
				runtimeFlags.format = inlineValue;
			} else {
				const validFormats = ["human", "json", "ndjson", "quiet"];
				if (!nextValue || !validFormats.includes(nextValue)) {
					throw new Error(
						`--format requires one of: ${validFormats.join(", ")}`,
					);
				}
				runtimeFlags.format = nextValue;
				index += 1;
			}
			continue;
		}
		if (token === "-i" || globalMatch) {
			const key = token === "-i" ? "interactive" : globalMatch?.[1];
			const inlineValue = globalMatch?.[2];
			const nextValue = input[index + 1];
			const consumesNext =
				inlineValue === undefined && /^(true|false)$/i.test(nextValue ?? "");
			if (key === "confirm" || key === "interactive" || key === "tui") {
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

		const negatedGlobalMatch = token.match(/^--no-(confirm|interactive|tui)$/);
		if (negatedGlobalMatch) {
			const key = negatedGlobalMatch[1];
			if (key === "confirm" || key === "interactive" || key === "tui") {
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
			if (value) {
				args.push(`--${optionName}`);
			} else if (isNegatableBooleanOption(optionName)) {
				args.push(`--no-${optionName}`);
			} else {
				// An explicit false leaves a plain `no-*` flag unset (off); the
				// invoked command still has to define it.
				unsetFlagNames.push(optionName);
			}
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
