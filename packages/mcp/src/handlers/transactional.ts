import {
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import { getTransactionalIdempotencyStoreFromEnvironment } from "@listmonk-ops/automation";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getTransactionalOperationByMcpName,
	invokeTransactionalOperationByMcpName,
	transactionalOperations,
	type TransactionalIdempotencyStore,
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
	idempotencyStore?: TransactionalIdempotencyStore;
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
		const { idempotencyStore, ...identity } = target;
		const invocation = await invokeTransactionalOperationByMcpName(
			{
				client,
				// Follow the server's configured sequence claim store when present;
				// otherwise use the environment-selected Postgres or file store.
				idempotencyStore:
					idempotencyStore ?? getTransactionalIdempotencyStoreFromEnvironment(),
				hashPayload: hashTransactionalPayload,
				target: identity,
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
