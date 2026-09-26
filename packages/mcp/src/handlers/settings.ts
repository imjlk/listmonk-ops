import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult, handleDataResponse } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

/**
 * Transport-specific read-only diagnostics that are not yet shared
 * operations. They bypass the operation policy gate, so they must stay
 * read-only; settings are read through the redacted shared
 * `listmonk_get_settings` operation and are never written over MCP.
 */
export const settingsTools: MCPTool[] = [
	{
		name: "listmonk_health_check",
		title: "Check Listmonk API health",
		description: "Check Listmonk API health",
		inputSchema: {
			type: "object",
			properties: {},
		},
		annotations: {
			title: "Check Listmonk API health",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	},
	{
		name: "listmonk_get_server_config",
		title: "Read server configuration",
		description: "Get server configuration",
		inputSchema: {
			type: "object",
			properties: {},
		},
		annotations: {
			title: "Read server configuration",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		},
	},
];

export const handleSettingsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name } = request.params;

		switch (name) {
			case "listmonk_health_check": {
				const response = await client.getHealthCheck();
				return handleDataResponse(response, "Health check failed");
			}

			case "listmonk_get_server_config": {
				const response = await client.system.getConfig();
				return handleDataResponse(response, "Failed to fetch server config");
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
