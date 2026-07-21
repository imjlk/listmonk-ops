import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getTransactionalOperationByMcpName,
	invokeTransactionalOperationByMcpName,
	transactionalOperations,
	type TransactionalOperation,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

function toMcpTool(operation: TransactionalOperation): MCPTool {
	return {
		name: operation.mcp.name,
		title: operation.title,
		description: operation.description,
		inputSchema: operation.inputJsonSchema,
		outputSchema: operation.outputJsonSchema,
		annotations: {
			title: operation.title,
			...operation.safety,
		},
	};
}

function createOperationResult(
	output: Record<string, unknown> & { sent: boolean },
): CallToolResult {
	return {
		content: [{ type: "text", text: JSON.stringify(output.sent) }],
		structuredContent: output,
	};
}

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

		return createOperationResult(invocation.output);
	},
);
