import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	dashboardOperations,
	invokeDashboardOperationByMcpName,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createErrorResult } from "../utils/response.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";

export const dashboardTools: MCPTool[] = dashboardOperations.map(toMcpTool);

export async function handleDashboardTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		const operationInvocation = await invokeDashboardOperationByMcpName(
			{ client },
			name,
			args,
		);
		if (operationInvocation) {
			return createOperationResult(
				operationInvocation.operation,
				operationInvocation.output,
			);
		}
		return createErrorResult(`Unknown tool: ${name}`);
	} catch (error) {
		return createErrorResult(
			error instanceof Error ? error.message : String(error),
		);
	}
}
