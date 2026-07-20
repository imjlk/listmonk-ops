import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getListOperationByMcpName,
	listOperations,
	type ListOperation,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

function toMcpTool(operation: ListOperation): MCPTool {
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
	operation: ListOperation,
	output: Record<string, unknown>,
): CallToolResult {
	const text =
		operation.mcp.legacySuccessText ?? JSON.stringify(output, null, 2);
	return {
		content: [{ type: "text", text }],
		structuredContent: output,
	};
}

export const listsTools: MCPTool[] = listOperations.map(toMcpTool);

export function isListsToolName(name: string): boolean {
	return getListOperationByMcpName(name) !== undefined;
}

export const handleListsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const operation = getListOperationByMcpName(request.params.name);
		if (!operation) {
			return createErrorResult(`Unknown tool: ${request.params.name}`);
		}

		const output = await operation.invoke(
			{ client },
			request.params.arguments ?? {},
		);
		return createOperationResult(
			operation,
			output as Record<string, unknown>,
		);
	},
);
