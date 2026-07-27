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
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const transactionalTools: MCPTool[] =
	transactionalOperations.map(toMcpTool);

export function isTransactionalToolName(name: string): boolean {
	return getTransactionalOperationByMcpName(name) !== undefined;
}

/**
 * The MCP server's resolved Listmonk target identity, threaded in from the
 * server config so idempotency records are namespaced by the instance the
 * server actually targets (honoring --listmonk-url / --listmonk-username
 * overrides and programmatic config), not just the ambient environment.
 */
export type TransactionalHandlerTarget = {
	baseUrl?: string;
	username?: string;
};

/**
 * Extended handler signature that carries the resolved Listmonk target.
 * Other resource handlers stay on the 2-arg `HandlerFunction` shape; only
 * the transactional handler needs the target because only it namespaces
 * idempotency records by instance.
 */
export type TransactionalHandlerFunction = (
	request: CallToolRequest,
	client: ListmonkClient,
	target?: TransactionalHandlerTarget,
) => Promise<CallToolResult>;

export const handleTransactionalTools: TransactionalHandlerFunction =
	withErrorHandler(
		async (
			request: CallToolRequest,
			client: ListmonkClient,
			target: TransactionalHandlerTarget = {},
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
