import type { CallToolResult } from "../types/mcp.js";
import type { PaginationParams } from "../types/shared.js";
import { createErrorResult, createSuccessResult } from "./response.js";

type CrudResponse<T> = {
	data?: T;
	error?: unknown;
};

/**
 * Helper function to handle CrudResult responses consistently
 */
export function handleCrudResponse<T>(
	response: CrudResponse<T>,
	errorMessage: string = "Operation failed",
): CallToolResult {
	if ("error" in response && response.error) {
		return createErrorResult(`${errorMessage}: ${response.error}`);
	}
	return createSuccessResult(response.data);
}

/**
 * Helper function to parse pagination parameters
 */
export function parsePaginationParams(
	args: Record<string, unknown> = {},
): PaginationParams {
	const rawPage = args.page;
	const rawPerPage = args.per_page;
	const page =
		typeof rawPage === "number"
			? rawPage
			: Number.isFinite(Number(rawPage))
				? Number(rawPage)
				: 1;
	const perPage =
		typeof rawPerPage === "number"
			? rawPerPage
			: Number.isFinite(Number(rawPerPage))
				? Number(rawPerPage)
				: 20;

	return {
		page: page > 0 ? page : 1,
		per_page: perPage > 0 ? perPage : 20,
	};
}

/**
 * Helper function to safely parse number from string
 */
export function parseId(id: unknown): number {
	const parsed = typeof id === "string" ? Number(id) : Number(id);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid ID: ${id}`);
	}
	return parsed;
}

/**
 * Helper function to create a standardized error handler wrapper
 */
export function withErrorHandler<T extends unknown[]>(
	handler: (...args: T) => Promise<CallToolResult>,
): (...args: T) => Promise<CallToolResult> {
	return async (...args: T): Promise<CallToolResult> => {
		try {
			return await handler(...args);
		} catch (error) {
			return createErrorResult(
				error instanceof Error ? error.message : String(error),
			);
		}
	};
}

/**
 * Helper to convert array parameters to comma-separated strings for API calls
 */
export function arrayToCommaString(arr: unknown): string | undefined {
	if (!Array.isArray(arr)) return undefined;
	return arr.map((entry) => String(entry)).join(",");
}

/**
 * Helper to safely cast status parameters
 */
export function castCampaignStatus(
	status: unknown,
): "scheduled" | "running" | "paused" | "cancelled" {
	const validStatuses = [
		"scheduled",
		"running",
		"paused",
		"cancelled",
	] as const;
	if (typeof status !== "string") {
		throw new Error(
			`Invalid campaign status: ${String(status)}. Valid statuses: ${validStatuses.join(", ")}`,
		);
	}
	if (!validStatuses.includes(status as (typeof validStatuses)[number])) {
		throw new Error(
			`Invalid campaign status: ${status}. Valid statuses: ${validStatuses.join(", ")}`,
		);
	}
	return status as "scheduled" | "running" | "paused" | "cancelled";
}

/**
 * Helper to safely cast list types
 */
export function castListType(type: unknown): "public" | "private" {
	const validTypes = ["public", "private"] as const;
	if (typeof type !== "string") {
		throw new Error(
			`Invalid list type: ${String(type)}. Valid types: ${validTypes.join(", ")}`,
		);
	}
	if (!validTypes.includes(type as (typeof validTypes)[number])) {
		throw new Error(
			`Invalid list type: ${type}. Valid types: ${validTypes.join(", ")}`,
		);
	}
	return type as "public" | "private";
}

/**
 * Helper to safely cast optin types
 */
export function castOptinType(optin: unknown): "single" | "double" {
	const validOptins = ["single", "double"] as const;
	if (typeof optin !== "string") {
		throw new Error(
			`Invalid optin type: ${String(optin)}. Valid types: ${validOptins.join(", ")}`,
		);
	}
	if (!validOptins.includes(optin as (typeof validOptins)[number])) {
		throw new Error(
			`Invalid optin type: ${optin}. Valid types: ${validOptins.join(", ")}`,
		);
	}
	return optin as "single" | "double";
}
