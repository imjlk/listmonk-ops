import type { Args, Command } from "gunshi";
import { define } from "gunshi/definition";

export type RunnerType = "executor" | "config" | "simple";

// Define our custom metadata structure that includes the runner type
export interface CommandMeta extends Command {
	name: string; // Make name required
	runner: RunnerType;
}

/**
 * Type-safe helper for defining command metadata with our custom `runner` property.
 * This wraps gunshi's `define` to provide type inference and safety with runtime validation.
 * @param meta The command metadata.
 * @returns The typed command metadata object.
 */
export function defineCommand<TArgs extends Args>(
	meta: CommandMeta & { args?: TArgs },
): CommandMeta & { args?: TArgs } {
	// Validate runner at runtime to ensure type safety
	const validRunners: RunnerType[] = ["executor", "config", "simple"];
	if (!meta.runner || !validRunners.includes(meta.runner)) {
		throw new Error(
			`Invalid runner type: "${meta.runner}". Must be one of: ${validRunners.join(", ")}`,
		);
	}

	// Let gunshi validate the base command structure first
	const validated = define(meta as Command);

	// Return with preserved type and runner property, ensuring type safety
	return {
		...validated,
		runner: meta.runner,
		args: meta.args,
	} as CommandMeta & { args?: TArgs };
}
