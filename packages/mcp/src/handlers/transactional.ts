import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getTransactionalOperationByMcpName,
	invokeTransactionalOperationByMcpName,
	transactionalOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const transactionalTools: MCPTool[] =
	transactionalOperations.map(toMcpTool);

export function isTransactionalToolName(name: string): boolean {
	return getTransactionalOperationByMcpName(name) !== undefined;
}

/**
 * Resolve the Listmonk target identity for idempotency namespacing from the
 * MCP server's environment. The server process already validated these on
 * startup; reading them here keeps the handler signature aligned with the
 * other resource handlers (which receive only the client) while still
 * preventing cross-instance replay.
 */
function resolveListmonkTarget(): { baseUrl?: string; username?: string } {
	const baseUrl = process.env.LISTMONK_API_URL?.trim();
	const username = process.env.LISTMONK_USERNAME?.trim();
	if (!baseUrl && !username) return {};
	return { baseUrl, username };
}

export const handleTransactionalTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const invocation = await invokeTransactionalOperationByMcpName(
			{
				client,
				// Inject the file-backed idempotency store and SHA-256 hasher
				// here so the operations package stays runtime-neutral. The
				// store path resolves via LISTMONK_OPS_TRANSACTIONAL_STORE
				// (same convention as the audit/abtest stores).
				idempotencyStore:
					createFileBackedTransactionalIdempotencyStore(),
				hashPayload: hashTransactionalPayload,
				target: resolveListmonkTarget(),
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
