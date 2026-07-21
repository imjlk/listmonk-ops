import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getTransactionalOperationByMcpName,
	invokeTransactionalOperationByMcpName,
	transactionalOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const transactionalTools: MCPTool[] =
	transactionalOperations.map(toMcpTool);

export function isTransactionalToolName(name: string): boolean {
	return getTransactionalOperationByMcpName(name) !== undefined;
}

export const handleTransactionalTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const invocation = await invokeTransactionalOperationByMcpName(
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
