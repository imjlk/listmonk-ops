import type { CallToolRequest, CallToolResult } from "../types/mcp.js";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CrudResponse, PaginationParams } from "../types/shared.js";
import { createErrorResult, createSuccessResult } from "./response.js";

/**
 * Helper function to handle CrudResult responses consistently
 */
export function handleCrudResponse<T>(
	response: any,
	errorMessage: string = "Operation failed"
): CallToolResult {
	if ('error' in response && response.error) {
		return createErrorResult(`${errorMessage}: ${response.error}`);
	}
	return createSuccessResult(response.data);
}

/**
 * Helper function to parse pagination parameters
 */
export function parsePaginationParams(args: any): PaginationParams {
	return {
		page: args.page || 1,
		per_page: args.per_page || 20,
	};
}

/**
 * Helper function to safely parse number from string
 */
export function parseId(id: unknown): number {
	const parsed = typeof id === 'string' ? Number(id) : Number(id);
	if (isNaN(parsed)) {
		throw new Error(`Invalid ID: ${id}`);
	}
	return parsed;
}

/**
 * Helper function to create a standardized error handler wrapper
 */
export function withErrorHandler<T extends any[]>(
	handler: (...args: T) => Promise<CallToolResult>
): (...args: T) => Promise<CallToolResult> {
	return async (...args: T): Promise<CallToolResult> => {
		try {
			return await handler(...args);
		} catch (error) {
			return createErrorResult(
				`Error: ${error instanceof Error ? error.message : String(error)}`
			);
		}
	};
}

/**
 * Helper function to build filter objects for API calls
 */
export function buildFilterQuery(args: any, allowedFilters: string[]): Record<string, any> {
	const filters: Record<string, any> = {};
	
	for (const filter of allowedFilters) {
		if (args[filter] !== undefined) {
			filters[filter] = args[filter];
		}
	}
	
	return filters;
}

/**
 * Type-safe parameter extraction helper
 */
export function extractParams<T>(args: any, requiredKeys: (keyof T)[], optionalKeys: (keyof T)[] = []): T {
	const result = {} as T;
	
	// Add required parameters
	for (const key of requiredKeys) {
		if (args[key] === undefined) {
			throw new Error(`Required parameter '${String(key)}' is missing`);
		}
		result[key] = args[key];
	}
	
	// Add optional parameters
	for (const key of optionalKeys) {
		if (args[key] !== undefined) {
			result[key] = args[key];
		}
	}
	
	return result;
}

/**
 * Helper to convert array parameters to comma-separated strings for API calls
 */
export function arrayToCommaString(arr: any): string | undefined {
	if (!Array.isArray(arr)) return undefined;
	return arr.join(',');
}

/**
 * Helper to safely cast status parameters
 */
export function castCampaignStatus(status: any): "scheduled" | "running" | "paused" | "cancelled" {
	const validStatuses = ["scheduled", "running", "paused", "cancelled"];
	if (!validStatuses.includes(status)) {
		throw new Error(`Invalid campaign status: ${status}. Valid statuses: ${validStatuses.join(', ')}`);
	}
	return status as "scheduled" | "running" | "paused" | "cancelled";
}

/**
 * Helper to safely cast list types
 */
export function castListType(type: any): "public" | "private" {
	const validTypes = ["public", "private"];
	if (!validTypes.includes(type)) {
		throw new Error(`Invalid list type: ${type}. Valid types: ${validTypes.join(', ')}`);
	}
	return type as "public" | "private";
}

/**
 * Helper to safely cast optin types
 */
export function castOptinType(optin: any): "single" | "double" {
	const validOptins = ["single", "double"];
	if (!validOptins.includes(optin)) {
		throw new Error(`Invalid optin type: ${optin}. Valid types: ${validOptins.join(', ')}`);
	}
	return optin as "single" | "double";
}