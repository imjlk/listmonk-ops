import type { CallToolRequest, CallToolResult } from "./mcp.js";
import type { ListmonkClient } from "@listmonk-ops/openapi";

// Common pagination parameters
export interface PaginationParams {
	page?: number;
	per_page?: number;
}

// Standard handler function signature
export type HandlerFunction = (
	request: CallToolRequest,
	client: ListmonkClient,
) => Promise<CallToolResult>;

// List types for type safety  
export type ListType = "public" | "private";
export type OptinType = "single" | "double";