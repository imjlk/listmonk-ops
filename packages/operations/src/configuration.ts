import type { ListmonkConfigurationSummary } from "@listmonk-ops/common";
import { z } from "zod";
import { bindControlConfigurationOperationSpec } from "./specs";
import {
	defineOperation,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "./operation";

const configurationSourceSchema = z.object({
	kind: z.enum([
		"default",
		"environment",
		"argument",
		"profile",
		"programmatic",
	]),
	name: z.string().optional(),
});
const configurationSummarySchema = z.object({
	profile: z.string().optional(),
	configFile: z.string().optional(),
	availableProfiles: z.array(z.string()),
	baseUrl: z.string(),
	username: z.string(),
	dataDirectory: z.string(),
	sources: z.object({
		baseUrl: configurationSourceSchema,
		username: configurationSourceSchema,
		dataDirectory: configurationSourceSchema,
	}),
	authentication: z.object({
		kind: z.enum(["token", "legacy_password", "none"]),
		source: configurationSourceSchema,
		reference: z.string().optional(),
	}),
});
export interface ControlConfigurationOperationContext {
	configuration?: ListmonkConfigurationSummary;
}

/** Return only the declared metadata fields, never a resolved secret or arbitrary context data. */
export async function getControlConfiguration(context: ControlConfigurationOperationContext): Promise<ListmonkConfigurationSummary> {
	if (!context.configuration) throw new Error("Resolved Listmonk configuration is unavailable");
	const summary = configurationSummarySchema.parse(context.configuration);
	try {
		const url = new URL(summary.baseUrl);
		url.username = "";
		url.password = "";
		url.search = "";
		url.hash = "";
		summary.baseUrl = url.toString().replace(/\/$/, "");
	} catch {
		summary.baseUrl = "[invalid URL]";
	}
	return summary;
}

export const controlConfigurationOperation = defineOperation({
	id: "control.config",
	title: "Inspect resolved configuration",
	description: "Inspect the selected connection profile, configuration sources, credential reference, and default state directory without reading secret values.",
	inputSchema: z.object({}),
	outputSchema: configurationSummarySchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_config" },
	spec: bindControlConfigurationOperationSpec(),
	execute: getControlConfiguration,
});

export async function invokeControlConfigurationOperation(context: ControlConfigurationOperationContext, input: unknown) {
	parseOperationInput(controlConfigurationOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			controlConfigurationOperation.id,
			controlConfigurationOperation.outputSchema,
			await getControlConfiguration(context),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			controlConfigurationOperation.id,
			error,
		);
	}
}
