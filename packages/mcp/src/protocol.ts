import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import packageJson from "../package.json" with { type: "json" };
import type {
	CallToolRequest,
	CallToolResult,
	ListToolsRequest,
	ListToolsResult,
} from "./types/mcp.js";

export const MCP_SERVER_INFO = {
	name: "listmonk-ops",
	version: packageJson.version,
} as const;

export interface MCPToolProvider {
	listTools(request: ListToolsRequest): Promise<ListToolsResult>;
	callTool(request: CallToolRequest): Promise<CallToolResult>;
}

export function createMCPProtocolServer(provider: MCPToolProvider): Server {
	const server = new Server(MCP_SERVER_INFO, {
		capabilities: {
			tools: {},
		},
		instructions:
			"Manage Listmonk resources and listmonk-ops automation through the available tools.",
	});

	server.setRequestHandler(ListToolsRequestSchema, async () =>
		provider.listTools({ method: "tools/list" }),
	);
	server.setRequestHandler(CallToolRequestSchema, async (request) =>
		provider.callTool(request),
	);

	return server;
}

export async function connectMCPTransport(
	provider: MCPToolProvider,
	transport: Transport,
): Promise<Server> {
	const server = createMCPProtocolServer(provider);
	await server.connect(transport);
	return server;
}
