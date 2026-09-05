import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindSystemAboutOperationSpec,
	bindSystemLogsOperationSpec,
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
		default:
			return undefined;
	}
}
