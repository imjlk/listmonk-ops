import {
	createFileBackedTransactionalIdempotencyStore,
	hashTransactionalPayload,
} from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	getSequenceOperationByMcpName,
	getSequenceRepositoryFromEnvironment,
	invokeSequenceOperationByMcpName,
	sequenceOperations,
	type SequenceOperationContext,
} from "@listmonk-ops/automation";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";

export const sequenceTools: MCPTool[] = sequenceOperations.map(toMcpTool);

export function isSequenceToolName(name: string): boolean {
	return getSequenceOperationByMcpName(name) !== undefined;
}

export async function executeSequenceTools(
	request: CallToolRequest,
	client: ListmonkClient,
	context: SequenceOperationContext = {},
): Promise<CallToolResult> {
	const repository =
		context.repository ?? getSequenceRepositoryFromEnvironment();
	const invocation = await invokeSequenceOperationByMcpName(
		{
			...context,
			repository,
			client,
			idempotencyStore:
				context.idempotencyStore ??
				repository.idempotencyStore ??
				createFileBackedTransactionalIdempotencyStore(),
			hashPayload: context.hashPayload ?? hashTransactionalPayload,
		},
		request.params.name,
		request.params.arguments ?? {},
	);
	if (!invocation) {
		return createErrorResult(`Unknown tool: ${request.params.name}`);
	}
	return createOperationResult(invocation.operation, invocation.output);
}

export function createSequenceToolsHandler(
	context: SequenceOperationContext = {},
): HandlerFunction {
	return withErrorHandler((request, client) =>
		executeSequenceTools(request, client, context),
	);
}

export const handleSequenceTools = createSequenceToolsHandler();
