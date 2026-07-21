import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getOpsOperationByMcpName,
	invokeOpsOperationByMcpName,
	opsOperations,
} from "@listmonk-ops/automation";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const opsTools: MCPTool[] = opsOperations.map(toMcpTool);

export function isOpsToolName(name: string): boolean {
	return getOpsOperationByMcpName(name) !== undefined;
}

export const handleOpsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const invocation = await invokeOpsOperationByMcpName(
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
