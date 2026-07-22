import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeTemplateOperationByMcpName,
	templateOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";

export const templatesTools: MCPTool[] = templateOperations.map(toMcpTool);

export async function handleTemplatesTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		const operationInvocation = await invokeTemplateOperationByMcpName(
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
