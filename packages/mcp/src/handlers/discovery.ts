import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	discoveryOperations,
	getDiscoveryOperationByMcpName,
	invokeDiscoveryOperationByMcpName,
} from "@listmonk-ops/operations";
import packageJson from "../../package.json" with { type: "json" };
import { mcpOperationCatalog } from "../operation-catalog.js";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";

export const discoveryTools: readonly MCPTool[] =
	discoveryOperations.map(toMcpTool);

export type DiscoveryHandlerTarget = {
	url: string;
	auth: "token" | "none";
};

export type DiscoveryHandlerFunction = (
	request: CallToolRequest,
	client: ListmonkClient,
	target?: DiscoveryHandlerTarget,
) => Promise<CallToolResult>;

export const handleDiscoveryTools: DiscoveryHandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
		target?: DiscoveryHandlerTarget,
	): Promise<CallToolResult> => {
		const operation = getDiscoveryOperationByMcpName(request.params.name);
		if (operation === undefined) {
			return createErrorResult(`Unknown tool: ${request.params.name}`);
		}
		const input = request.params.arguments ?? {};
		const output = await invokeDiscoveryOperationByMcpName(
			{
				catalog: mcpOperationCatalog,
				surface: "mcp",
				version: packageJson.version,
				runtime: {
					platform: process.platform,
					arch: process.arch,
					node: process.version,
				},
				...(target === undefined ? {} : { target }),
				probeListmonk: async () => {
					const health = await client.getHealthCheck();
					return Boolean(health.data);
				},
			},
			request.params.name,
			input,
		);
		return createOperationResult(operation, output);
	},
);
