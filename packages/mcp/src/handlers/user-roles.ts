import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeUserRoleOperationByMcpName,
	userRoleOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";

export const userRolesTools: MCPTool[] = userRoleOperations.map(toMcpTool);

export async function handleUserRolesTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		const operationInvocation = await invokeUserRoleOperationByMcpName(
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
