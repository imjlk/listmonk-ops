import {
	createOperationAuditExecutionId,
	recordOperationAudit,
	type OperationAuditEvent,
	type OperationAuditStoreOptions,
} from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { createListmonkClient } from "@listmonk-ops/openapi";
import { assertOperationConfirmation } from "@listmonk-ops/operations";
import type { Context } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
	assertUniqueToolNames,
	handleAbTestTools,
	handleBouncesTools,
	handleCampaignsTools,
	handleOperationCatalogTools,
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
	toolRegistrations,
} from "./handlers/index.js";
import type {
	CallToolRequest,
	CallToolResult,
	ListToolsRequest,
	ListToolsResult,
	MCPTool,
} from "./types/mcp.js";
import {
	assertMcpOperationDryRun,
	getMcpOperationExecution,
	type McpOperationExecution,
} from "./operation-execution.js";
import { createErrorResult, toErrorMessage } from "./utils/response.js";
import { createMCPProtocolServer, MCP_SERVER_INFO } from "./protocol.js";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHostname(hostname: string): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.replace(/\.$/, "");
}

function isLoopbackHostname(hostname: string): boolean {
	return LOOPBACK_HOSTNAMES.has(normalizeHostname(hostname));
}

function normalizeAllowedHost(host: string): string {
	const normalized = normalizeHostname(host);
	if (
		!normalized ||
		normalized.includes("/") ||
		normalized.includes("://") ||
		(normalized.includes(":") && isIP(normalized) !== 6)
	) {
		throw new TypeError(
			`Invalid MCP HTTP allowed host: ${host}. Use a hostname without a scheme, path, or port.`,
		);
	}
	return normalized;
}

function parseHttpOrigin(origin: string): URL | undefined {
	let parsed: URL;
	try {
		parsed = new URL(origin.trim());
	} catch {
		return undefined;
	}
	if (
		(parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.pathname !== "/" ||
		parsed.search !== "" ||
		parsed.hash !== ""
	) {
		return undefined;
	}
	return parsed;
}

function normalizeAllowedOrigin(origin: string): string {
	const parsed = parseHttpOrigin(origin);
	if (!parsed) {
		throw new TypeError(
			`Invalid MCP HTTP allowed origin: ${origin}. Use an exact http(s) origin without a path.`,
		);
	}
	return parsed.origin;
}

function requestHostname(request: Request): string | undefined {
	const host = request.headers.get("Host") ?? new URL(request.url).host;
	if (
		host.length === 0 ||
		/[\u0000-\u0020\u007f/?#@\\]/u.test(host)
	) {
		return undefined;
	}
	try {
		const parsed = new URL(`http://${host}`);
		if (
			parsed.username !== "" ||
			parsed.password !== "" ||
			parsed.pathname !== "/" ||
			parsed.search !== "" ||
			parsed.hash !== ""
		) {
			return undefined;
		}
		return normalizeHostname(parsed.hostname);
	} catch {
		return undefined;
	}
}

function bearerTokenMatches(
	authorization: string | undefined,
	expectedToken: string,
): boolean {
	if (!authorization) {
		return false;
	}
	const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
	if (!match?.[1]) {
		return false;
	}
	const actual = createHash("sha256").update(match[1], "utf8").digest();
	const expected = createHash("sha256").update(expectedToken, "utf8").digest();
	return timingSafeEqual(actual, expected);
}

function requiresHttpAuthentication(pathname: string): boolean {
	const normalized = pathname.replace(/\/+$/, "") || "/";
	return normalized === "/mcp" || normalized.startsWith("/tools/");
}

export class ListmonkMCPServer {
	private app: Hono;
	private tools: Map<string, MCPTool>;
	private client: ListmonkClient;
	private baseUrl: string;
	private auditStoreOptions: OperationAuditStoreOptions;
	private httpAuthToken: string | undefined;
	private allowedHttpHosts: Set<string>;
	private allowedHttpOrigins: Set<string>;

	constructor(config: {
		baseUrl: string;
		username: string;
		password: string;
		apiToken?: string;
		auditStorePath?: string;
		auditStoreLimit?: number;
		httpAuthToken?: string;
		allowedHttpHosts?: readonly string[];
		allowedHttpOrigins?: readonly string[];
	}) {
		this.app = new Hono();
		this.tools = new Map();
		this.baseUrl = config.baseUrl;
		this.auditStoreOptions = {
			path: config.auditStorePath,
			limit: config.auditStoreLimit,
		};
		this.httpAuthToken = config.httpAuthToken;
		this.allowedHttpHosts = new Set(
			(config.allowedHttpHosts ?? []).map(normalizeAllowedHost),
		);
		this.allowedHttpOrigins = new Set(
			(config.allowedHttpOrigins ?? []).map(normalizeAllowedOrigin),
		);
		if (
			(this.allowedHttpHosts.size > 0 || this.allowedHttpOrigins.size > 0) &&
			!this.httpAuthToken
		) {
			throw new TypeError(
				"MCP HTTP allowed hosts and origins require MCP_HTTP_AUTH_TOKEN",
			);
		}

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

	private isAllowedHttpOrigin(origin: string): boolean {
		const parsed = parseHttpOrigin(origin);
		if (!parsed) {
			return false;
		}
		return (
			isLoopbackHostname(parsed.hostname) ||
			this.allowedHttpOrigins.has(parsed.origin)
		);
	}

	private validateHttpRequest(request: Request): Response | undefined {
		const hostname = requestHostname(request);
		if (
			!hostname ||
			(!isLoopbackHostname(hostname) && !this.allowedHttpHosts.has(hostname))
		) {
			return Response.json({ error: "Forbidden host" }, { status: 403 });
		}

		const origin = request.headers.get("Origin");
		if (origin && !this.isAllowedHttpOrigin(origin)) {
			return Response.json({ error: "Forbidden origin" }, { status: 403 });
		}

		if (
			this.httpAuthToken &&
			requiresHttpAuthentication(new URL(request.url).pathname) &&
			request.method !== "OPTIONS" &&
			!bearerTokenMatches(
				request.headers.get("Authorization") ?? undefined,
				this.httpAuthToken,
			)
		) {
			return Response.json(
				{ error: "Unauthorized" },
				{
					status: 401,
					headers: { "WWW-Authenticate": 'Bearer realm="listmonk-ops-mcp"' },
				},
			);
		}

		return undefined;
	}

	private setupMiddleware() {
		this.app.use("*", logger());
		this.app.use("*", async (c, next) => {
			const rejection = this.validateHttpRequest(c.req.raw);
			if (rejection) {
				return rejection;
			}
			return next();
		});
		this.app.use(
			"*",
			cors({
				origin: (origin) =>
					origin && this.isAllowedHttpOrigin(origin) ? origin : undefined,
				allowMethods: ["GET", "POST", "OPTIONS"],
				allowHeaders: [
					"Accept",
					"Authorization",
					"Content-Type",
					"Last-Event-ID",
					"MCP-Protocol-Version",
					"Mcp-Session-Id",
				],
				exposeHeaders: ["Mcp-Session-Id"],
			}),
		);
	}
	private registerTools() {
		assertUniqueToolNames();
		for (const registration of toolRegistrations) {
			for (const tool of registration.tools) {
				this.tools.set(tool.name, tool);
			}
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

	private async recordMcpOperationAudit(
		execution: McpOperationExecution,
		executionId: string,
		event: OperationAuditEvent,
	): Promise<void> {
		await recordOperationAudit(
			{
				executionId,
				surface: "mcp",
				operationId: execution.operation.id,
				event,
				confirmationRequired: execution.policy.confirmationRequired,
				confirmed: execution.confirmed,
				dryRun: execution.dryRun,
			},
			this.auditStoreOptions,
		);
	}

	private async completeMcpOperationExecution(
		execution: McpOperationExecution | undefined,
		executionId: string | undefined,
		result: CallToolResult,
	): Promise<CallToolResult> {
		if (!execution || !executionId) {
			return result;
		}

		const event: OperationAuditEvent = result.isError ? "failed" : "succeeded";
		try {
			await this.recordMcpOperationAudit(execution, executionId, event);
		} catch (error) {
			// The durable started event already prevents a remote mutation from
			// becoming untraceable. Never replace a remote result with an audit
			// write failure, which could cause an unsafe retry.
			console.error(
				`Unable to record MCP operation audit ${event} for ${execution.operation.id}: ${toErrorMessage(error)}`,
			);
		}

		return result;
	}

	async callTool(request: CallToolRequest): Promise<CallToolResult> {
		const { name } = request.params;

		if (!this.tools.has(name)) {
			return createErrorResult(`Unknown tool: ${name}`);
		}

		const execution = getMcpOperationExecution(request);
		let executionId: string | undefined;
		if (execution?.policy.auditRequired) {
			executionId = createOperationAuditExecutionId();
			try {
				await this.recordMcpOperationAudit(execution, executionId, "started");
			} catch (error) {
				return createErrorResult(
					`Unable to start audit for operation ${execution.operation.id}: ${toErrorMessage(error)}`,
				);
			}
		}

		if (execution) {
			try {
				assertMcpOperationDryRun(execution);
				assertOperationConfirmation(execution.operation, execution.confirmed);
			} catch (error) {
				if (executionId) {
					try {
						await this.recordMcpOperationAudit(
							execution,
							executionId,
							"blocked",
						);
					} catch (auditError) {
						return createErrorResult(
							`${toErrorMessage(error)}; unable to record blocked audit event: ${toErrorMessage(auditError)}`,
						);
					}
				}
				return createErrorResult(toErrorMessage(error));
			}
		}

		const operationRequest = execution?.request ?? request;

		try {
			// Route to appropriate handler based on tool name prefix
			let result: CallToolResult;
			if (isListsToolName(name)) {
				result = await handleListsTools(operationRequest, this.client);
			} else if (toolNameSets.subscribers.has(name)) {
				result = await handleSubscribersTools(operationRequest, this.client);
			} else if (toolNameSets.campaigns.has(name)) {
				result = await handleCampaignsTools(operationRequest, this.client);
			} else if (toolNameSets.templates.has(name)) {
				result = await handleTemplatesTools(operationRequest, this.client);
			} else if (toolNameSets.catalog.has(name)) {
				result = await handleOperationCatalogTools(
					operationRequest,
					this.client,
				);
			} else if (toolNameSets.media.has(name)) {
				result = await handleMediaTools(operationRequest, this.client);
			} else if (toolNameSets.bounces.has(name)) {
				result = await handleBouncesTools(operationRequest, this.client);
			} else if (toolNameSets.settings.has(name)) {
				result = await handleSettingsTools(operationRequest, this.client);
			} else if (isTransactionalToolName(name)) {
				result = await handleTransactionalTools(operationRequest, this.client);
			} else if (toolNameSets.ops.has(name)) {
				result = await handleOpsTools(operationRequest, this.client);
			} else if (toolNameSets.abtest.has(name)) {
				result = await handleAbTestTools(operationRequest, this.client);
			} else {
				result = createErrorResult(`No handler found for tool: ${name}`);
			}

			return await this.completeMcpOperationExecution(
				execution,
				executionId,
				result,
			);
		} catch (error) {
			const result = createErrorResult(
				`Error calling tool ${name}: ${toErrorMessage(error)}`,
			);
			return await this.completeMcpOperationExecution(
				execution,
				executionId,
				result,
			);
		}
	}

	getApp() {
		return this.app;
	}

	private assertSecureHttpBinding(hostname: string): void {
		if (isLoopbackHostname(hostname)) {
			return;
		}
		if (!this.httpAuthToken) {
			throw new Error(
				"Refusing non-loopback MCP HTTP binding without MCP_HTTP_AUTH_TOKEN",
			);
		}
		if (
			this.allowedHttpHosts.size === 0 ||
			this.allowedHttpOrigins.size === 0
		) {
			throw new Error(
				"Non-loopback MCP HTTP binding requires MCP_HTTP_ALLOWED_HOSTS and MCP_HTTP_ALLOWED_ORIGINS",
			);
		}
	}

	async listen(port: number, hostname = "localhost") {
		this.assertSecureHttpBinding(hostname);
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
	auditStorePath?: string;
	auditStoreLimit?: number;
	httpAuthToken?: string;
	allowedHttpHosts?: readonly string[];
	allowedHttpOrigins?: readonly string[];
}) {
	return new ListmonkMCPServer({
		baseUrl: config.baseUrl,
		username: config.username || "admin",
		password: config.password || "adminpass",
		apiToken: config.apiToken,
		auditStorePath: config.auditStorePath,
		auditStoreLimit: config.auditStoreLimit,
		httpAuthToken: config.httpAuthToken,
		allowedHttpHosts: config.allowedHttpHosts,
		allowedHttpOrigins: config.allowedHttpOrigins,
	});
}
