import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bindMaintenanceGcSubscribersOperationSpec,
	bindMaintenanceGcUnconfirmedOperationSpec,
} from "./specs";
import { z } from "zod";
import { MAINTENANCE_BEFORE_DATE_PATTERN_SOURCE } from "./maintenance-before-date";
import { defineOperationCatalog } from "./catalog";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";
import {
	deleteResourceSafety,
	jsonResourceValue,
	unwrapResourceResponse,
} from "./resource-helpers";

export interface MaintenanceOperationContext {
	client: Pick<ListmonkClient, "maintenance">;
}

const maintenanceGcSubscribersInputSchema = z.object({
	type: z.enum(["orphan", "blocklisted"]),
});

const maintenanceGcSubscribersOutputSchema = z.object({
	type: z.enum(["orphan", "blocklisted"]),
	count: z.number().int().nonnegative(),
});

const RFC3339_PATTERN = new RegExp(MAINTENANCE_BEFORE_DATE_PATTERN_SOURCE);

const maintenanceGcUnconfirmedInputSchema = z.object({
	before_date: z
		.string()
		.regex(
			RFC3339_PATTERN,
			"before_date must be an RFC3339 timestamp (e.g. 2026-01-01T00:00:00Z)",
		),
});

const maintenanceGcUnconfirmedOutputSchema = z.object({
	before_date: z.string(),
	count: z.number().int().nonnegative(),
});

/**
 * One-shot deletion of every orphaned or blocklisted subscriber. The
 * observed 6.2 endpoint answers `{count}` and offers no preview, so the
 * operation is confirmation-gated with the no-preview boundary stated in
 * the spec rather than a simulated dry run.
 */
export async function gcSubscribers(
	{ client }: MaintenanceOperationContext,
	input: z.output<typeof maintenanceGcSubscribersInputSchema>,
): Promise<z.output<typeof maintenanceGcSubscribersOutputSchema>> {
	const response = await client.maintenance.gcSubscribers({
		path: { type: input.type },
	});
	const data = unwrapResourceResponse(
		response,
		`Failed to garbage-collect ${input.type} subscribers`,
	);
	return {
		type: input.type,
		count: typeof data?.count === "number" ? data.count : 0,
	};
}

/**
 * One-shot deletion of every subscription still unconfirmed before the
 * echoed RFC3339 cutoff. The upstream spec modeled the cutoff as a form
 * body; the observed endpoint takes it as a query parameter, corrected
 * in the owned overlay.
 */
export async function gcUnconfirmedSubscriptions(
	{ client }: MaintenanceOperationContext,
	input: z.output<typeof maintenanceGcUnconfirmedInputSchema>,
): Promise<z.output<typeof maintenanceGcUnconfirmedOutputSchema>> {
	const response = await client.maintenance.gcUnconfirmedSubscriptions({
		query: { before_date: input.before_date },
	});
	const data = unwrapResourceResponse(
		response,
		"Failed to garbage-collect unconfirmed subscriptions",
	);
	return {
		before_date: input.before_date,
		count: typeof data?.count === "number" ? data.count : 0,
	};
}

export const gcSubscribersOperation = defineOperation({
	id: "maintenance.gc-subscribers",
	title: "Garbage-collect subscribers",
	description:
		"One-shot deletion of every orphaned (listless) or blocklisted subscriber. The server offers no preview; one confirmed request deletes the full matching set.",
	inputSchema: maintenanceGcSubscribersInputSchema,
	outputSchema: maintenanceGcSubscribersOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_gc_subscribers",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindMaintenanceGcSubscribersOperationSpec(),
	execute: gcSubscribers,
});

export const gcUnconfirmedOperation = defineOperation({
	id: "maintenance.gc-unconfirmed",
	title: "Garbage-collect unconfirmed subscriptions",
	description:
		"One-shot deletion of every subscription still unconfirmed before an RFC3339 cutoff. The server offers no preview; one confirmed request deletes the full matching set.",
	inputSchema: maintenanceGcUnconfirmedInputSchema,
	outputSchema: maintenanceGcUnconfirmedOutputSchema,
	safety: deleteResourceSafety,
	mcp: {
		name: "listmonk_gc_unconfirmed_subscriptions",
		legacySuccessText: jsonResourceValue,
	},
	spec: bindMaintenanceGcUnconfirmedOperationSpec(),
	execute: gcUnconfirmedSubscriptions,
});

export async function invokeGcSubscribersOperation(
	context: MaintenanceOperationContext,
	input: unknown,
): Promise<z.output<typeof maintenanceGcSubscribersOutputSchema>> {
	const parsedInput = parseOperationInput(
		gcSubscribersOperation.inputSchema,
		input,
	);
	let output: z.output<typeof maintenanceGcSubscribersOutputSchema>;
	try {
		output = await gcSubscribers(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(gcSubscribersOperation.id, error);
	}
	return parseOperationOutput(
		gcSubscribersOperation.id,
		gcSubscribersOperation.outputSchema,
		output,
	);
}

export async function invokeGcUnconfirmedOperation(
	context: MaintenanceOperationContext,
	input: unknown,
): Promise<z.output<typeof maintenanceGcUnconfirmedOutputSchema>> {
	const parsedInput = parseOperationInput(
		gcUnconfirmedOperation.inputSchema,
		input,
	);
	let output: z.output<typeof maintenanceGcUnconfirmedOutputSchema>;
	try {
		output = await gcUnconfirmedSubscriptions(context, parsedInput);
	} catch (error) {
		throw normalizeOperationExecutionError(gcUnconfirmedOperation.id, error);
	}
	return parseOperationOutput(
		gcUnconfirmedOperation.id,
		gcUnconfirmedOperation.outputSchema,
		output,
	);
}

export const maintenanceOperations = [
	gcSubscribersOperation,
	gcUnconfirmedOperation,
] as const;

export const maintenanceOperationCatalog = defineOperationCatalog({
	id: "maintenance",
	title: "Maintenance",
	operations: maintenanceOperations,
	specMigrationExemptions: [],
});

export type MaintenanceOperation = (typeof maintenanceOperations)[number];

const maintenanceOperationsByMcpName = new Map<string, MaintenanceOperation>(
	maintenanceOperations.map((operation) => [operation.mcp.name, operation]),
);

export function getMaintenanceOperationByMcpName(
	name: string,
): MaintenanceOperation | undefined {
	return maintenanceOperationsByMcpName.get(name);
}

export interface MaintenanceOperationInvocation {
	operation: MaintenanceOperation;
	output: Record<string, unknown>;
}

export async function invokeMaintenanceOperationByMcpName(
	context: MaintenanceOperationContext,
	name: string,
	input: unknown,
): Promise<MaintenanceOperationInvocation | undefined> {
	switch (name) {
		case gcSubscribersOperation.mcp.name:
			return {
				operation: gcSubscribersOperation,
				output: await invokeGcSubscribersOperation(context, input),
			};
		case gcUnconfirmedOperation.mcp.name:
			return {
				operation: gcUnconfirmedOperation,
				output: await invokeGcUnconfirmedOperation(context, input),
			};
		default:
			return undefined;
	}
}
