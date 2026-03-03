import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult, createSuccessResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

export const settingsTools: MCPTool[] = [
	{
		name: "listmonk_health_check",
		description: "Check Listmonk API health",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
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
	{
		name: "listmonk_get_dashboard_counts",
		description: "Get dashboard aggregate counts",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "listmonk_get_dashboard_charts",
		description: "Get dashboard chart data",
		inputSchema: {
			type: "object",
			properties: {
				type: {
					type: "string",
					description: "Optional chart type filter",
				},
			},
		},
	},
	{
		name: "listmonk_test_smtp",
		description: "Test SMTP settings payload before applying changes",
		inputSchema: {
			type: "object",
			properties: {
				settings: {
					type: "object",
					description: "SMTP settings payload",
				},
			},
			required: ["settings"],
		},
	},
	{
		name: "listmonk_get_logs",
		description: "Get Listmonk application logs",
		inputSchema: {
			type: "object",
			properties: {},
		},
	},
	{
		name: "listmonk_reload_app",
		description: "Reload Listmonk app configuration without restart",
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
			case "listmonk_health_check": {
				const response = await client.getHealthCheck();
				return createSuccessResult(response.data);
			}

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

			case "listmonk_get_dashboard_counts": {
				const response = await client.dashboard.getCounts();
				return createSuccessResult(response.data);
			}

			case "listmonk_get_dashboard_charts": {
				const response = await client.dashboard.getCharts(
					args.type ? { query: { type: String(args.type) } } : undefined,
				);
				return createSuccessResult(response.data);
			}

			case "listmonk_test_smtp": {
				if (!args.settings || typeof args.settings !== "object") {
					return createErrorResult("settings object is required");
				}

				const response = await client.settings.testSmtp({
					body: args.settings as Record<string, unknown>,
				});

				return createSuccessResult(response.data);
			}

			case "listmonk_get_logs": {
				const response = await client.system.getLogs();
				return createSuccessResult(response.data);
			}

			case "listmonk_reload_app": {
				const response = await client.system.reload();
				return createSuccessResult(response.data);
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
