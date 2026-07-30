import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getProviderOperationByMcpName,
	invokeProviderOperationByMcpName,
	providerOperations,
	type ProviderOperationContext,
} from "@listmonk-ops/automation";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";

export const providerTools: MCPTool[] = providerOperations.map(toMcpTool);

export function isProviderToolName(name: string): boolean {
	return getProviderOperationByMcpName(name) !== undefined;
}

export async function executeProviderTools(
	request: CallToolRequest,
	client: ListmonkClient,
	context: ProviderOperationContext = {},
): Promise<CallToolResult> {
	const invocation = await invokeProviderOperationByMcpName(
		{ ...context, client },
		request.params.name,
		request.params.arguments ?? {},
	);
	if (!invocation) {
		return createErrorResult(`Unknown tool: ${request.params.name}`);
	}
	return createOperationResult(invocation.operation, invocation.output);
}

export function createProviderToolsHandler(
	context: ProviderOperationContext = {},
): HandlerFunction {
	return withErrorHandler((request, client) =>
		executeProviderTools(request, client, context),
	);
}

export const handleProviderTools = createProviderToolsHandler();
