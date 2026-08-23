import {
	createFileBackedResourceCreateIdempotencyStore,
} from "@listmonk-ops/common";
import { createHash } from "node:crypto";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeTemplateOperationByMcpName,
	templateOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";

export const templatesTools: MCPTool[] = templateOperations.map(toMcpTool);

function hashCreatePayload(serialized: string): string {
	return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Extended handler signature carrying the resolved Listmonk target so
 * keyed template creates namespace their idempotency records by instance.
 */
export async function handleTemplatesTools(
	request: CallToolRequest,
	client: ListmonkClient,
	target: { baseUrl?: string; username?: string } = {},
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		const operationInvocation = await invokeTemplateOperationByMcpName(
			{
				client,
				// Inject the file-backed resource-create idempotency store so
				// keyed template creates replay instead of duplicating; the
				// store path resolves via LISTMONK_OPS_RESOURCE_CREATE_STORE.
				createIdempotencyStore:
					createFileBackedResourceCreateIdempotencyStore(),
				hashCreatePayload,
				target,
			},
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
