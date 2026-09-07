import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindSystemAboutOperationSpec,
	bindSystemLogsOperationSpec,
	bindSystemReloadOperationSpec,
} from "./specs";
import { z } from "zod";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	jsonResourceValue,
	readResourceSafety,
	ResourceResponseError,
	unwrapResourceResponse,
} from "./resource-helpers";

export interface SystemOperationContext {
	client: Pick<ListmonkClient, "system">;
}

const systemAboutOutputSchema = z.looseObject({
	version: z.string().optional(),
	build: z.string().optional(),
	go_version: z.string().optional(),
	go_arch: z.string().optional(),
});

const systemLogsOutputSchema = z.object({
	logs: z.array(z.string()),
});

const systemReloadOutputSchema = z.object({
	reloaded: z.boolean(),
});

export type SystemAbout = z.output<typeof systemAboutOutputSchema>;
export type SystemLogs = z.output<typeof systemLogsOutputSchema>;

/**
 * Read the running build identity. The observed 6.2 document also
 * carries database, system, and host summaries; they pass through on
 * the loose object without being pinned into the contract.
 */
export async function readSystemAbout({
	client,
}: SystemOperationContext): Promise<SystemAbout> {
	const response = await client.system.getAbout();
	return unwrapResourceResponse(
		response,
		"Failed to read server build identity",
	) as SystemAbout;
}

/**
 * Read the recent server log lines. The observed 6.2 endpoint answers
 * with the lines as a JSON array directly under `data`.
 */
export async function readSystemLogs({
	client,
}: SystemOperationContext): Promise<SystemLogs> {
	const response = await client.system.getLogs();
	const lines = unwrapResourceResponse(response, "Failed to read server logs");
	// A silent empty coercion here would hide a shape change on the
	// endpoint; fail closed on unexpected payloads instead.
	if (
		!Array.isArray(lines) ||
		lines.some((line) => typeof line !== "string")
	) {
		throw new ResourceResponseError(
			"Failed to read server logs: unexpected payload shape",
			{ status: response.response?.status },
		);
	}
	return { logs: lines };
}

export const readSystemAboutOperation = defineOperation({
	id: "system.about",
	title: "Read server build identity",
	description:
		"Read the running Listmonk version, build, Go runtime, and host summary without any credentials.",
	inputSchema: z.object({}),
	outputSchema: systemAboutOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_about",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSystemAboutOperationSpec(),
	execute: readSystemAbout,
});

/**
 * Reload the app configuration without a restart. The observed 6.2
 * endpoint acknowledges with a bare boolean; the shared contract echoes
 * it as `reloaded`.
 */
export async function reloadSystem({
	client,
}: SystemOperationContext): Promise<{ reloaded: boolean }> {
	const response = await client.system.reload();
	const acknowledged = unwrapResourceResponse(
		response,
		"Failed to reload app configuration",
	);
	if (acknowledged !== true) {
		throw new Error(
			"Failed to reload app configuration: Listmonk returned a negative acknowledgement",
		);
	}
	return { reloaded: true };
}

export const reloadSystemOperation = defineOperation({
	id: "system.reload",
	title: "Reload app configuration",
	description:
		"Reload the Listmonk app configuration without a restart. Safe to repeat; settings mutations only take effect after a reload.",
	inputSchema: z.object({}),
	outputSchema: systemReloadOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: true,
	},
	mcp: {
		name: "listmonk_reload_app",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSystemReloadOperationSpec(),
	execute: reloadSystem,
});

export async function invokeReloadSystemOperation(
	context: SystemOperationContext,
	input: unknown,
): Promise<{ reloaded: boolean }> {
	parseOperationInput(reloadSystemOperation.inputSchema, input);
	let output: { reloaded: boolean };
	try {
		output = await reloadSystem(context);
	} catch (error) {
		throw normalizeOperationExecutionError(reloadSystemOperation.id, error);
	}
	return parseOperationOutput(
		reloadSystemOperation.id,
		reloadSystemOperation.outputSchema,
		output,
	);
}

export const readSystemLogsOperation = defineOperation({
	id: "system.logs",
	title: "Read server logs",
	description:
		"Read the recent Listmonk server log lines as recorded by the running instance.",
	inputSchema: z.object({}),
	outputSchema: systemLogsOutputSchema,
	safety: readResourceSafety,
	mcp: {
		name: "listmonk_get_logs",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindSystemLogsOperationSpec(),
	execute: readSystemLogs,
});

export async function invokeReadSystemAboutOperation(
	context: SystemOperationContext,
	input: unknown,
): Promise<SystemAbout> {
	parseOperationInput(readSystemAboutOperation.inputSchema, input);
	let output: SystemAbout;
	try {
		output = await readSystemAbout(context);
	} catch (error) {
		throw normalizeOperationExecutionError(readSystemAboutOperation.id, error);
	}
	return parseOperationOutput(
		readSystemAboutOperation.id,
		readSystemAboutOperation.outputSchema,
		output,
	);
}

export async function invokeReadSystemLogsOperation(
	context: SystemOperationContext,
	input: unknown,
): Promise<SystemLogs> {
	parseOperationInput(readSystemLogsOperation.inputSchema, input);
	let output: SystemLogs;
	try {
		output = await readSystemLogs(context);
	} catch (error) {
		throw normalizeOperationExecutionError(readSystemLogsOperation.id, error);
	}
	return parseOperationOutput(
		readSystemLogsOperation.id,
		readSystemLogsOperation.outputSchema,
		output,
	);
}

export const systemOperations = [
	readSystemAboutOperation,
	readSystemLogsOperation,
	reloadSystemOperation,
] as const;

export const systemOperationCatalog = defineOperationCatalog({
	id: "system",
	title: "System",
	operations: systemOperations,
	specMigrationExemptions: [],
});

export type SystemOperation = (typeof systemOperations)[number];

const systemOperationsByMcpName = new Map<string, SystemOperation>(
	systemOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getSystemOperationByMcpName(
	name: string,
): SystemOperation | undefined {
	return systemOperationsByMcpName.get(name);
}

export interface SystemOperationInvocation {
	operation: SystemOperation;
	output: Record<string, unknown>;
}

export async function invokeSystemOperationByMcpName(
	context: SystemOperationContext,
	name: string,
	input: unknown,
): Promise<SystemOperationInvocation | undefined> {
	switch (name) {
		case readSystemAboutOperation.mcp.name:
			return {
				operation: readSystemAboutOperation,
				output: await invokeReadSystemAboutOperation(context, input),
			};
		case readSystemLogsOperation.mcp.name:
			return {
				operation: readSystemLogsOperation,
				output: await invokeReadSystemLogsOperation(context, input),
			};
		case reloadSystemOperation.mcp.name:
			return {
				operation: reloadSystemOperation,
				output: await invokeReloadSystemOperation(context, input),
			};
		default:
			return undefined;
	}
}
