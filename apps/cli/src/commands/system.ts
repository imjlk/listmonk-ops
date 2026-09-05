import type { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeReadSystemAboutOperation,
	invokeReadSystemLogsOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { z } from "zod";
import { getOutput } from "../lib/output";
import {
	defineCommand,
	defineGroup,
	type HandlerArgs,
	option,
} from "../lib/command";
import { toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type SystemOutput = Pick<typeof OutputUtils, "info" | "json" | "success">;

export interface SystemCliContext {
	client: Pick<ListmonkClient, "system">;
	output: SystemOutput;
}

export function createSystemCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderSystemAbout(
	context: SystemCliContext,
): Promise<void> {
	const about = await invokeReadSystemAboutOperation(context, {});
	context.output.success(
		`Listmonk ${about.version ?? "unknown"} build identity`,
	);
	context.output.json(about);
}

export async function renderSystemLogs(
	context: SystemCliContext,
	input: { lines?: number },
): Promise<void> {
	const logs = await invokeReadSystemLogsOperation(context, {});
	// lines is schema-validated positive; -0 would slice(0) and return
	// everything, so guard explicitly for the undefined case only.
	const selected =
		input.lines === undefined ? logs.logs : logs.logs.slice(-input.lines);
	if (selected.length === 0) {
		context.output.info("No server logs recorded");
	}
	context.output.json({ logs: selected });
}

export async function handleSystemAboutCommand({
	...args
}: HandlerArgs<Record<string, unknown>>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSystemAbout({ client, output: getOutput() });
	} catch (error) {
		throw createSystemCommandError(
			"Failed to read server build identity",
			error,
		);
	}
}

type SystemLogsCommandFlags = { lines?: number };

export async function handleSystemLogsCommand({
	flags,
	...args
}: HandlerArgs<SystemLogsCommandFlags>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSystemLogs(
			{ client, output: getOutput() },
			{
				lines: flags.lines,
			},
		);
	} catch (error) {
		throw createSystemCommandError("Failed to read server logs", error);
	}
}

export default defineGroup({
	name: "system",
	description: "Read Listmonk server identity and diagnostics",
	commands: [
		defineCommand({
			name: "about",
			operationId: "system.about",
			description: "Read the running Listmonk version and build identity",
			options: {},
			handler: handleSystemAboutCommand,
		}),
		defineCommand({
			name: "logs",
			operationId: "system.logs",
			description: "Read recent Listmonk server log lines",
			options: {
				lines: option(z.coerce.number().int().positive().optional(), {
					description: "Show only the most recent N lines (must be >= 1)",
				}),
			},
			handler: handleSystemLogsCommand,
		}),
	],
});
