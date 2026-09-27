import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeSubscriberOperationByMcpName,
	subscriberOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";

/**
 * Every subscriber tool projects a shared operation, so each mutation passes
 * through the server's confirmation and audit policy gate. The ungated
 * SQL-expression bulk tools (`listmonk_delete_subscribers_by_query`,
 * `listmonk_blocklist_subscribers_by_query`) and the unaudited
 * `listmonk_send_subscriber_optin` duplicate were removed: resolve IDs with
 * `listmonk_get_subscribers` and act through the ID-based
 * `listmonk_delete_subscriber`, `listmonk_blocklist_subscribers`, or
 * `listmonk_send_optin` operations instead.
 */
export const subscribersTools: MCPTool[] = subscriberOperations.map(toMcpTool);

export async function handleSubscribersTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;
	try {
		const operationInvocation = await invokeSubscriberOperationByMcpName(
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
