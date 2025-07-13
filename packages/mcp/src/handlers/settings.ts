import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	makeListmonkRequest,
} from "../utils/response.js";

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

export async function handleSettingsTools(
	request: CallToolRequest,
	baseUrl: string,
	auth: string,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_settings": {
				const url = `${baseUrl}/settings`;
				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch settings: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_update_settings": {
				if (!args.settings) {
					return createErrorResult("Settings object is required");
				}

				const url = `${baseUrl}/settings`;
				const response = await makeListmonkRequest(
					url,
					{
						method: "PUT",
						body: JSON.stringify(args.settings),
					},
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to update settings: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_get_server_config": {
				const url = `${baseUrl}/config`;
				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch server config: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return createErrorResult(
			`Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
