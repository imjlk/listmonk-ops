import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getListOperationByMcpName,
	invokeListOperationByMcpName,
	listOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const listsTools: MCPTool[] = listOperations.map(toMcpTool);

export function isListsToolName(name: string): boolean {
	return getListOperationByMcpName(name) !== undefined;
}

export const handleListsTools: HandlerFunction = withErrorHandler(
	async (
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> => {
		const invocation = await invokeListOperationByMcpName(
			{ client },
			request.params.name,
			request.params.arguments ?? {},
		);
		if (!invocation) {
			return createErrorResult(`Unknown tool: ${request.params.name}`);
		}

		return createOperationResult(invocation.operation, invocation.output);
	},
);
