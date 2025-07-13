import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import {
	bouncesTools,
	campaignsTools,
	handleBouncesTools,
	handleCampaignsTools,
	handleListsTools,
	handleMediaTools,
	handleSettingsTools,
	handleSubscribersTools,
	handleTemplatesTools,
	handleTransactionalTools,
	listsTools,
	mediaTools,
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
import { createErrorResult, getBasicAuth } from "./utils/response.js";

export class ListmonkMCPServer {
	private app: Hono;
	private tools: Map<string, MCPTool>;
	private baseUrl: string;
	private auth: string;

	constructor(config: {
		baseUrl: string;
		username: string;
		password: string;
		apiToken?: string;
	}) {
		this.app = new Hono();
		this.tools = new Map();
		this.baseUrl = config.baseUrl;
		// Use API token if provided (in username:token format), otherwise use basic auth
		this.auth = config.apiToken
			? `${config.username}:${config.apiToken}`
			: getBasicAuth(config.username, config.password);

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
			...bouncesTools,
			...settingsTools,
			...transactionalTools,
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
				return await handleListsTools(request, this.baseUrl, this.auth);
			}

			if (
				name.startsWith("listmonk_get_subscribers") ||
				name.startsWith("listmonk_get_subscriber") ||
				name.startsWith("listmonk_create_subscriber") ||
				name.startsWith("listmonk_update_subscriber") ||
				name.startsWith("listmonk_delete_subscriber")
			) {
				return await handleSubscribersTools(request, this.baseUrl, this.auth);
			}

			if (
				name.startsWith("listmonk_get_campaigns") ||
				name.startsWith("listmonk_get_campaign") ||
				name.startsWith("listmonk_create_campaign") ||
				name.startsWith("listmonk_update_campaign") ||
				name.startsWith("listmonk_delete_campaign") ||
				name.startsWith("listmonk_test_campaign")
			) {
				return await handleCampaignsTools(request, this.baseUrl, this.auth);
			}

			if (
				name.startsWith("listmonk_get_templates") ||
				name.startsWith("listmonk_get_template") ||
				name.startsWith("listmonk_create_template") ||
				name.startsWith("listmonk_update_template") ||
				name.startsWith("listmonk_delete_template") ||
				name.startsWith("listmonk_set_default_template")
			) {
				return await handleTemplatesTools(request, this.baseUrl, this.auth);
			}

			if (
				name.startsWith("listmonk_get_media") ||
				name.startsWith("listmonk_get_media_file") ||
				name.startsWith("listmonk_delete_media")
			) {
				return await handleMediaTools(request, this.baseUrl, this.auth);
			}

			if (
				name.startsWith("listmonk_get_bounces") ||
				name.startsWith("listmonk_get_bounce") ||
				name.startsWith("listmonk_delete_bounce")
			) {
				return await handleBouncesTools(request, this.baseUrl, this.auth);
			}

			if (
				name.startsWith("listmonk_get_settings") ||
				name.startsWith("listmonk_update_settings") ||
				name.startsWith("listmonk_get_server_config")
			) {
				return await handleSettingsTools(request, this.baseUrl, this.auth);
			}

			if (
				name.startsWith("listmonk_send_transactional") ||
				name.startsWith("listmonk_get_transactional_message")
			) {
				return await handleTransactionalTools(request, this.baseUrl, this.auth);
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
