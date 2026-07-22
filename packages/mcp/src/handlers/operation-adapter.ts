import type {
	ObjectJsonSchema,
	OperationMcpMetadata,
	OperationSafety,
} from "@listmonk-ops/operations";
import { withMcpOperationConfirmationInputSchema } from "../operation-execution.js";
import type { CallToolResult, MCPTool } from "../types/mcp.js";

export type McpOperationMetadata = {
	title: string;
	description: string;
	inputJsonSchema: ObjectJsonSchema;
	outputJsonSchema: ObjectJsonSchema;
	safety: OperationSafety;
	mcp: OperationMcpMetadata;
};

export function toMcpTool(operation: McpOperationMetadata): MCPTool {
	return {
		name: operation.mcp.name,
		title: operation.title,
		description: operation.description,
		inputSchema: withMcpOperationConfirmationInputSchema(
			operation.inputJsonSchema,
			operation.safety,
		),
		outputSchema: operation.outputJsonSchema,
		annotations: {
			title: operation.title,
			...operation.safety,
		},
	};
}

export function createOperationResult(
	operation: McpOperationMetadata,
	output: unknown,
): CallToolResult {
	if (!output || typeof output !== "object" || Array.isArray(output)) {
		throw new TypeError(
			`Operation ${operation.mcp.name} produced a non-object MCP result`,
		);
	}

	const structuredContent = output as Record<string, unknown>;
	const legacySuccessText = operation.mcp.legacySuccessText;
	const text =
		typeof legacySuccessText === "function"
			? legacySuccessText(structuredContent)
			: (legacySuccessText ?? JSON.stringify(structuredContent, null, 2));

	return {
		content: [{ type: "text", text }],
		structuredContent,
	};
}
