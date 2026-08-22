import {
	createFileBackedResourceCreateIdempotencyStore,
} from "@listmonk-ops/common";
import { createHash } from "node:crypto";

import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getListOperationByMcpName,
	invokeListOperationByMcpName,
	listOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const listsTools: MCPTool[] = listOperations.map(toMcpTool);

export function isListsToolName(name: string): boolean {
	return getListOperationByMcpName(name) !== undefined;
}

function hashCreatePayload(serialized: string): string {
	return createHash("sha256").update(serialized).digest("hex");
}

/**
 * Extended handler signature carrying the resolved Listmonk target so
 * keyed list creates namespace their idempotency records by instance.
 */
export type ListsHandlerFunction = (
	request: CallToolRequest,
	client: ListmonkClient,
	target?: { baseUrl?: string; username?: string },
) => Promise<CallToolResult>;

export const handleListsTools: ListsHandlerFunction = withErrorHandler(
	async (
	request: CallToolRequest,
	client: ListmonkClient,
	target: { baseUrl?: string; username?: string } = {},
): Promise<CallToolResult> => {
		const invocation = await invokeListOperationByMcpName(
			{
				client,
				// Inject the file-backed resource-create idempotency store so
				// keyed list creates replay instead of duplicating; the store
				// path resolves via LISTMONK_OPS_RESOURCE_CREATE_STORE.
				createIdempotencyStore:
					createFileBackedResourceCreateIdempotencyStore(),
				hashCreatePayload,
				target,
			},
			request.params.name,
			request.params.arguments ?? {},
		);
		if (!invocation) {
			return createErrorResult(`Unknown tool: ${request.params.name}`);
		}

		return createOperationResult(invocation.operation, invocation.output);
	},
);
