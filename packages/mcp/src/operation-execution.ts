import {
	getOperationCatalogEntryByMcpName,
	getOperationExecutionPolicy,
	type ObjectJsonSchema,
	type OperationCatalogItem,
	type OperationExecutionPolicy,
	type OperationSafety,
} from "@listmonk-ops/operations";
import { mcpOperationCatalog } from "./operation-catalog.js";
import type { CallToolRequest } from "./types/mcp.js";

export const MCP_OPERATION_CONFIRMATION_ARGUMENT = "confirm";

export type McpOperationExecution = Readonly<{
	operation: OperationCatalogItem;
	policy: OperationExecutionPolicy;
	confirmed: boolean;
	dryRunRequested: boolean;
	dryRun: boolean;
	request: CallToolRequest;
}>;

export class McpOperationDryRunUnsupportedError extends Error {
	public readonly operationId: string;

	public constructor(operationId: string) {
		super(`Operation ${operationId} does not support dry_run`);
		this.name = "McpOperationDryRunUnsupportedError";
		this.operationId = operationId;
	}
}

/**
 * Adds the MCP-only confirmation control to destructive operation schemas
 * without changing the transport-neutral operation input contract.
 */
export function withMcpOperationConfirmationInputSchema(
	inputSchema: ObjectJsonSchema,
	safety: OperationSafety,
): ObjectJsonSchema {
	if (!safety.destructiveHint) {
		return inputSchema;
	}

	return {
		...inputSchema,
		properties: {
			...inputSchema.properties,
			[MCP_OPERATION_CONFIRMATION_ARGUMENT]: {
				type: "boolean",
				const: true,
				description:
					"Set to true to explicitly confirm this destructive operation.",
			},
		},
		required: [
			...new Set([
				...(inputSchema.required ?? []),
				MCP_OPERATION_CONFIRMATION_ARGUMENT,
			]),
		],
	};
}

function withoutMcpOperationConfirmation(
	request: CallToolRequest,
): CallToolRequest {
	const operationArguments = { ...(request.params.arguments ?? {}) };
	delete operationArguments[MCP_OPERATION_CONFIRMATION_ARGUMENT];

	return {
		...request,
		params: {
			...request.params,
			arguments: operationArguments,
		},
	};
}

/**
 * Resolves shared-operation execution metadata for an MCP request. Legacy
 * transport-only tools deliberately return undefined until they are migrated
 * into the shared operation registry.
 */
export function getMcpOperationExecution(
	request: CallToolRequest,
): McpOperationExecution | undefined {
	const entry = getOperationCatalogEntryByMcpName(
		mcpOperationCatalog,
		request.params.name,
	);
	if (!entry) {
		return undefined;
	}

	const { operation } = entry;
	const policy = getOperationExecutionPolicy(operation);
	const arguments_ = request.params.arguments ?? {};
	const confirmed =
		arguments_[MCP_OPERATION_CONFIRMATION_ARGUMENT] === true;
	const dryRunRequested = arguments_.dry_run === true;
	const dryRun = policy.dryRunSupported && dryRunRequested;

	return {
		operation,
		policy,
		confirmed,
		dryRunRequested,
		dryRun,
		request: policy.confirmationRequired
			? withoutMcpOperationConfirmation(request)
			: request,
	};
}

export function assertMcpOperationDryRun(execution: McpOperationExecution): void {
	if (execution.dryRunRequested && !execution.policy.dryRunSupported) {
		throw new McpOperationDryRunUnsupportedError(execution.operation.id);
	}
}
