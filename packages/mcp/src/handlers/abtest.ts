import {
	abTestOperations,
	getAbTestOperationByMcpName,
	invokeAbTestOperationByMcpName,
} from "@listmonk-ops/abtest";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const abtestTools: MCPTool[] = abTestOperations.map(toMcpTool);

export function isAbTestToolName(name: string): boolean {
	return getAbTestOperationByMcpName(name) !== undefined;
}

export const handleAbTestTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const invocation = await invokeAbTestOperationByMcpName(
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
