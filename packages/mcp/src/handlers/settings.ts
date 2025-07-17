import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult, createSuccessResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const settingsTools: MCPTool[] = [
	{
		name: "listmonk_get_settings",
		description: "Get all settings from Listmonk",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "listmonk_update_settings",
		description: "Update Listmonk settings",
		inputSchema: {
			type: "object",
			properties: {
				settings: {
					type: "object",
					description: "Settings object to update",
				},
			},
			required: ["settings"],
		},
	},
	{
		name: "listmonk_get_server_config",
		description: "Get server configuration",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
];

export const handleSettingsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case "listmonk_get_settings": {
				const response = await client.settings.get();
				return createSuccessResult(response.data);
			}

			case "listmonk_update_settings": {
				if (!args.settings) {
					return createErrorResult("Settings object is required");
				}

				const response = await client.settings.update({
					body: args.settings as Record<string, unknown>,
				});

				return createSuccessResult(response.data);
			}

			case "listmonk_get_server_config": {
				const response = await client.system.getConfig();
				return createSuccessResult(response.data);
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
