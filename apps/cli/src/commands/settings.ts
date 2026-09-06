import type { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeGetSettingsOperation,
	OperationExecutionError,
} from "@listmonk-ops/operations";
import { getOutput } from "../lib/output";
import { defineCommand, defineGroup, type HandlerArgs } from "../lib/command";
import { toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

type SettingsOutput = Pick<typeof OutputUtils, "json" | "success">;

export interface SettingsCliContext {
	client: Pick<ListmonkClient, "settings">;
	output: SettingsOutput;
}

export function createSettingsCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderSettings(
	context: SettingsCliContext,
): Promise<void> {
	const { settings } = await invokeGetSettingsOperation(context, {});
	context.output.success("Installation settings (credentials redacted)");
	context.output.json(settings);
}

export async function handleGetSettingsCommand({
	...args
}: HandlerArgs<Record<string, unknown>>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderSettings({ client, output: getOutput() });
	} catch (error) {
		throw createSettingsCommandError(
			"Failed to read installation settings",
			error,
		);
	}
}

export default defineGroup({
	name: "settings",
	description: "Read Listmonk installation settings (redacted)",
	commands: [
		defineCommand({
			name: "get",
			operationId: "settings.get",
			description:
				"Read installation settings with credentials recursively redacted",
			options: {},
			handler: handleGetSettingsCommand,
		}),
	],
});
