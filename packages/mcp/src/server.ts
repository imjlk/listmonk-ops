import type { ListmonkClient } from "@listmonk-ops/openapi";
import { createListmonkClient } from "@listmonk-ops/openapi";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
	abtestTools,
	bouncesTools,
	campaignsTools,
	handleAbTestTools,
	handleBouncesTools,
	handleCampaignsTools,
	handleListsTools,
	handleMediaTools,
	handleOpsTools,
	handleSettingsTools,
	handleSubscribersTools,
	handleTemplatesTools,
	handleTransactionalTools,
	listsTools,
	mediaTools,
	opsTools,
	settingsTools,
	subscribersTools,
	templatesTools,
	transactionalTools,
} from "./handlers/index.js";
import type {
	CallToolRequest,
	CallToolResult,
	ListToolsRequest,
	ListToolsResult,
	MCPTool,
} from "./types/mcp.js";
import { createErrorResult } from "./utils/response.js";

export class ListmonkMCPServer {
	private app: Hono;
	private tools: Map<string, MCPTool>;
	private client: ListmonkClient;
	private baseUrl: string;

	constructor(config: {
		baseUrl: string;
		username: string;
		password: string;
		apiToken?: string;
	}) {
		this.app = new Hono();
		this.tools = new Map();
		this.baseUrl = config.baseUrl;

		// Create ListmonkClient instance
		const credential = config.apiToken || config.password;
		const authString = `${config.username}:${credential}`;

		this.client = createListmonkClient({
			baseUrl: config.baseUrl,
			headers: {
				Authorization: `token ${authString}`,
			},
		});

		this.setupMiddleware();
		this.registerTools();
		this.setupRoutes();
	}

	private setupMiddleware() {
		this.app.use("*", logger());
		this.app.use("*", cors());
	}
	private registerTools() {
		// Register all tools
		const allTools = [
			...listsTools,
			...subscribersTools,
			...campaignsTools,
			...templatesTools,
			...mediaTools,
			...opsTools,
			...bouncesTools,
			...settingsTools,
			...transactionalTools,
			...abtestTools,
		];

		for (const tool of allTools) {
			this.tools.set(tool.name, tool);
		}
	}

	private setupRoutes() {
		// Health check
		this.app.get("/health", (c: Context) => {
			return c.json({ status: "ok", timestamp: new Date().toISOString() });
		});

		// MCP tools/list endpoint
		this.app.post("/tools/list", async (c: Context) => {
			const request: ListToolsRequest = await c.req.json();
			const result = await this.listTools(request);
			return c.json(result);
		});

		// MCP tools/call endpoint
		this.app.post("/tools/call", async (c: Context) => {
			const request: CallToolRequest = await c.req.json();
			const result = await this.callTool(request);
			return c.json(result);
		});

		// Root endpoint
		this.app.get("/", (c: Context) => {
			return c.json({
				name: "Listmonk MCP Server",
				version: "0.1.0",
				description: "Model Context Protocol server for Listmonk API",
				endpoints: {
					health: "/health",
					tools_list: "/tools/list",
					tools_call: "/tools/call",
				},
				tools_count: this.tools.size,
			});
		});
	}

	async listTools(_request: ListToolsRequest): Promise<ListToolsResult> {
		return {
			tools: Array.from(this.tools.values()),
		};
	}

	async callTool(request: CallToolRequest): Promise<CallToolResult> {
		const { name } = request.params;

		if (!this.tools.has(name)) {
			return createErrorResult(`Unknown tool: ${name}`);
		}

		try {
			// Route to appropriate handler based on tool name prefix
			if (
				name.startsWith("listmonk_get_lists") ||
				name.startsWith("listmonk_get_list") ||
				name.startsWith("listmonk_create_list") ||
				name.startsWith("listmonk_update_list") ||
				name.startsWith("listmonk_delete_list")
			) {
				return await handleListsTools(request, this.client);
			}

			if (
				name.startsWith("listmonk_get_subscribers") ||
				name.startsWith("listmonk_get_subscriber") ||
				name.startsWith("listmonk_create_subscriber") ||
				name.startsWith("listmonk_update_subscriber") ||
				name.startsWith("listmonk_delete_subscriber") ||
				name.startsWith("listmonk_send_subscriber_optin") ||
				name.startsWith("listmonk_delete_subscribers_by_query") ||
				name.startsWith("listmonk_blocklist_subscribers_by_query")
			) {
				return await handleSubscribersTools(request, this.client);
			}

			if (
				name.startsWith("listmonk_get_campaigns") ||
				name.startsWith("listmonk_get_campaign") ||
				name.startsWith("listmonk_create_campaign") ||
				name.startsWith("listmonk_update_campaign") ||
				name.startsWith("listmonk_delete_campaign") ||
				name.startsWith("listmonk_test_campaign") ||
				name.startsWith("listmonk_get_campaign_running_stats") ||
				name.startsWith("listmonk_get_campaign_analytics")
			) {
				return await handleCampaignsTools(request, this.client);
			}

			if (
				name.startsWith("listmonk_get_templates") ||
				name.startsWith("listmonk_get_template") ||
				name.startsWith("listmonk_create_template") ||
				name.startsWith("listmonk_update_template") ||
				name.startsWith("listmonk_delete_template") ||
				name.startsWith("listmonk_set_default_template")
			) {
				return await handleTemplatesTools(request, this.client);
			}

			if (
				name.startsWith("listmonk_get_media") ||
				name.startsWith("listmonk_get_media_file") ||
				name.startsWith("listmonk_delete_media")
			) {
				return await handleMediaTools(request, this.client);
			}

			if (
				name.startsWith("listmonk_get_bounces") ||
				name.startsWith("listmonk_get_bounce") ||
				name.startsWith("listmonk_delete_bounce")
			) {
				return await handleBouncesTools(request, this.client);
			}

			if (
				name.startsWith("listmonk_health_check") ||
				name.startsWith("listmonk_get_settings") ||
				name.startsWith("listmonk_update_settings") ||
				name.startsWith("listmonk_get_server_config") ||
				name.startsWith("listmonk_get_dashboard_counts") ||
				name.startsWith("listmonk_get_dashboard_charts") ||
				name.startsWith("listmonk_test_smtp") ||
				name.startsWith("listmonk_get_logs") ||
				name.startsWith("listmonk_reload_app")
			) {
				return await handleSettingsTools(request, this.client);
			}

			if (
				name.startsWith("listmonk_send_transactional") ||
				name.startsWith("listmonk_get_transactional_message")
			) {
				return await handleTransactionalTools(request, this.client);
			}

			if (name.startsWith("listmonk_ops_")) {
				return await handleOpsTools(request, this.client);
			}

			if (name.startsWith("listmonk_abtest_")) {
				return await handleAbTestTools(request, this.client);
			}

			return createErrorResult(`No handler found for tool: ${name}`);
		} catch (error) {
			return createErrorResult(
				`Error calling tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	getApp() {
		return this.app;
	}
	async listen(port: number, hostname = "localhost") {
		console.log(
			`🚀 Listmonk MCP Server starting on http://${hostname}:${port}`,
		);
		console.log(`📊 Registered ${this.tools.size} tools`);
		console.log(`🔗 Listmonk API: ${this.baseUrl}`);

		try {
			// Using Bun's built-in server with Hono
			const server = Bun.serve({
				port,
				hostname,
				fetch: this.app.fetch,
			});
			console.log(`✅ Server is running on http://${hostname}:${port}`);
			return server;
		} catch (error) {
			console.error("❌ Failed to start server:", error);
			throw error;
		}
	}
}

/**
 * Factory function to create a Listmonk MCP server instance
 */
export function createListmonkMCPServer(config: {
	baseUrl: string;
	username?: string;
	password?: string;
	apiToken?: string;
}) {
	return new ListmonkMCPServer({
		baseUrl: config.baseUrl,
		username: config.username || "admin",
		password: config.password || "adminpass",
		apiToken: config.apiToken,
	});
}
