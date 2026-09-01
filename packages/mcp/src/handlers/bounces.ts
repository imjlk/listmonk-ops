import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	bouncesOperations,
	invokeBouncesOperationByMcpName,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createErrorResult, createSuccessResult } from "../utils/response.js";
import { arrayToCommaString } from "../utils/typeHelpers.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";

/**
 * Legacy hand-rolled bulk bounce delete tool. It remains transport-specific
 * until the destructive bulk/all bounce operation is designed with
 * echo/dry-run semantics (Listmonk rejects a bulk delete that names any
 * missing ID, so its retry contract needs dedicated care); the read and
 * single-delete tools are already shared operations.
 */
const legacyBounceDeleteTools: MCPTool[] = [
	{
		name: "listmonk_delete_bounces",
		description: "Delete multiple bounce records",
		inputSchema: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Array of bounce IDs to delete",
				},
				all: {
					type: "boolean",
					description: "Delete all bounces",
					default: false,
				},
			},
		},
	},
];

export const bouncesTools: MCPTool[] = [
	...bouncesOperations.map(toMcpTool),
	...legacyBounceDeleteTools,
];

export async function handleBouncesTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		const operationInvocation = await invokeBouncesOperationByMcpName(
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

		switch (name) {
			case "listmonk_delete_bounces": {
				const query: { all?: boolean; id?: string } = {};
				const deleteAll = args.all === true || args.all === "true";

				if (deleteAll) {
					query.all = true;
				} else if (args.ids && Array.isArray(args.ids)) {
					query.id = arrayToCommaString(args.ids);
				} else {
					return createErrorResult(
						"Either 'ids' array or 'all=true' must be provided",
					);
				}

				await client.bounce.delete({ query });
				return createSuccessResult("Bounces deleted successfully");
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return createErrorResult(
			error instanceof Error ? error.message : String(error),
		);
	}
};
