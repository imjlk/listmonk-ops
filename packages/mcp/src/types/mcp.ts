// MCP types (simplified for now, will be replaced with actual SDK types)
export interface CallToolRequest {
	method: "tools/call";
	params: {
		name: string;
		arguments?: Record<string, unknown>;
	};
}

export interface CallToolResult {
	content: Array<{
		type: "text";
		text: string;
	}>;
	isError?: boolean;
}

export interface ListToolsRequest {
	method: "tools/list";
}

export interface ListToolsResult {
	tools: Tool[];
}

export interface Tool {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

// MCP Tool schemas
export interface MCPTool extends Tool {
	name: string;
	description: string;
	inputSchema: {
		type: "object";
		properties: Record<string, unknown>;
		required?: string[];
	};
}

export type MCPToolHandler = (
	request: CallToolRequest,
) => Promise<CallToolResult>;

export interface MCPServer {
	tools: Map<string, MCPTool>;
	handlers: Map<string, MCPToolHandler>;
	listTools(request: ListToolsRequest): Promise<ListToolsResult>;
	callTool(request: CallToolRequest): Promise<CallToolResult>;
}

export interface ListmonkClientConfig {
	baseUrl: string;
	username: string;
	password: string;
}
