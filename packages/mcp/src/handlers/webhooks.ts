import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getWebhookOperationByMcpName,
	invokeWebhookOperationByMcpName,
	webhookOperations,
	type WebhookOperationContext,
} from "@listmonk-ops/automation";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";

export const webhookTools: MCPTool[] = webhookOperations.map(toMcpTool);

export function isWebhookToolName(name: string): boolean {
	return getWebhookOperationByMcpName(name) !== undefined;
}

export async function executeWebhookTools(
	request: CallToolRequest,
	_client: ListmonkClient,
	context: WebhookOperationContext = {},
): Promise<CallToolResult> {
	const invocation = await invokeWebhookOperationByMcpName(
		context,
		request.params.name,
		request.params.arguments ?? {},
	);
	if (!invocation) {
		return createErrorResult(`Unknown tool: ${request.params.name}`);
	}
	return createOperationResult(invocation.operation, invocation.output);
}

export function createWebhookToolsHandler(
	context: WebhookOperationContext = {},
): HandlerFunction {
	return withErrorHandler((request, client) =>
		executeWebhookTools(request, client, context),
	);
}

export const handleWebhookTools = createWebhookToolsHandler();
