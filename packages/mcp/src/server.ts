import type { ListmonkClient } from "@listmonk-ops/openapi";
import { createListmonkClient } from "@listmonk-ops/openapi";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	allTools,
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
	isListsToolName,
	isTransactionalToolName,
	toolNameSets,
} from "./handlers/index.js";
import type {
	CallToolRequest,
	CallToolResult,
	ListToolsRequest,
	ListToolsResult,
	MCPTool,
} from "./types/mcp.js";
import { createErrorResult } from "./utils/response.js";
import { createMCPProtocolServer, MCP_SERVER_INFO } from "./protocol.js";

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
		for (const tool of allTools) {
			this.tools.set(tool.name, tool);
		}
	}

	private async handleMCPHttpRequest(request: Request): Promise<Response> {
		const transport = new WebStandardStreamableHTTPServerTransport({
			enableJsonResponse: true,
			sessionIdGenerator: undefined,
		});
		const protocolServer = createMCPProtocolServer(this);
		await protocolServer.connect(transport);

		try {
			return await transport.handleRequest(request);
		} finally {
			await protocolServer.close();
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

		// Standards-compliant MCP Streamable HTTP endpoint.
		this.app.all("/mcp", async (c: Context) => {
			if (c.req.method !== "POST") {
				return new Response(null, {
					status: 405,
					headers: { Allow: "POST" },
				});
			}
			return this.handleMCPHttpRequest(c.req.raw);
		});

		// Root endpoint
		this.app.get("/", (c: Context) => {
			return c.json({
				name: "Listmonk MCP Server",
				version: MCP_SERVER_INFO.version,
				description: "Model Context Protocol server for Listmonk API",
				endpoints: {
					health: "/health",
					tools_list: "/tools/list",
					tools_call: "/tools/call",
					mcp: "/mcp",
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
			if (isListsToolName(name)) {
				return await handleListsTools(request, this.client);
			}

			if (toolNameSets.subscribers.has(name)) {
				return await handleSubscribersTools(request, this.client);
			}

			if (toolNameSets.campaigns.has(name)) {
				return await handleCampaignsTools(request, this.client);
			}

			if (toolNameSets.templates.has(name)) {
				return await handleTemplatesTools(request, this.client);
			}

			if (toolNameSets.media.has(name)) {
				return await handleMediaTools(request, this.client);
			}

			if (toolNameSets.bounces.has(name)) {
				return await handleBouncesTools(request, this.client);
			}

			if (toolNameSets.settings.has(name)) {
				return await handleSettingsTools(request, this.client);
			}

			if (isTransactionalToolName(name)) {
				return await handleTransactionalTools(request, this.client);
			}

			if (toolNameSets.ops.has(name)) {
				return await handleOpsTools(request, this.client);
			}

			if (toolNameSets.abtest.has(name)) {
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
		if (typeof Bun === "undefined") {
			throw new Error(
				"@listmonk-ops/mcp requires the Bun runtime. Start it with `bun` or the installed `listmonk-mcp` launcher.",
			);
		}

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
