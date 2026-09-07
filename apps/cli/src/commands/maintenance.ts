import type { OutputUtils } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeGcSubscribersOperation,
	invokeGcUnconfirmedOperation,
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

type MaintenanceOutput = Pick<typeof OutputUtils, "json" | "success">;

export interface MaintenanceCliContext {
	client: Pick<ListmonkClient, "maintenance">;
	output: MaintenanceOutput;
}

export function createMaintenanceCommandError(
	context: string,
	error: unknown,
): Error {
	if (error instanceof OperationExecutionError) return error;
	return new Error(`${context}: ${toErrorMessage(error)}`, { cause: error });
}

export async function renderGcSubscribers(
	context: MaintenanceCliContext,
	input: { type: "orphan" | "blocklisted" },
): Promise<void> {
	const result = await invokeGcSubscribersOperation(context, input);
	context.output.success(
		`Garbage-collected ${result.count} ${result.type} subscriber(s)`,
	);
	context.output.json(result);
}

export async function renderGcUnconfirmed(
	context: MaintenanceCliContext,
	input: { before_date: string },
): Promise<void> {
	const result = await invokeGcUnconfirmedOperation(context, input);
	context.output.success(
		`Garbage-collected ${result.count} unconfirmed subscription(s) before ${result.before_date}`,
	);
	context.output.json(result);
}

export async function handleGcSubscribersCommand({
	flags,
	...args
}: HandlerArgs<{ type: "orphan" | "blocklisted" }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderGcSubscribers(
			{ client, output: getOutput() },
			{
				type: flags.type,
			},
		);
	} catch (error) {
		throw createMaintenanceCommandError(
			"Failed to garbage-collect subscribers",
			error,
		);
	}
}

export async function handleGcUnconfirmedCommand({
	flags,
	...args
}: HandlerArgs<{ "before-date": string }>): Promise<void> {
	try {
		const client = await getListmonkClient(args);
		await renderGcUnconfirmed(
			{ client, output: getOutput() },
			{
				before_date: flags["before-date"],
			},
		);
	} catch (error) {
		throw createMaintenanceCommandError(
			"Failed to garbage-collect unconfirmed subscriptions",
			error,
		);
	}
}

export default defineGroup({
	name: "maintenance",
	description:
		"One-shot destructive garbage collection (no server-side preview)",
	commands: [
		defineCommand({
			name: "gc-subscribers",
			operationId: "maintenance.gc-subscribers",
			description:
				"Delete every orphaned or blocklisted subscriber in one batch",
			options: {
				type: option(z.enum(["orphan", "blocklisted"]), {
					description: "Which subscriber set the collection deletes",
				}),
			},
			handler: handleGcSubscribersCommand,
		}),
		defineCommand({
			name: "gc-unconfirmed",
			operationId: "maintenance.gc-unconfirmed",
			description:
				"Delete every subscription unconfirmed before an RFC3339 cutoff",
			options: {
				"before-date": option(
					z
						.string()
						.regex(
							/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
						),
					{
						description:
							"RFC3339 cutoff (e.g. 2026-01-01T00:00:00Z); repeat requests report count 0",
					},
				),
			},
			handler: handleGcUnconfirmedCommand,
		}),
	],
});
