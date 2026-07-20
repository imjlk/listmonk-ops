import type { CallToolRequest, CallToolResult } from "../types/mcp.js";

export type DataResponse<T> = {
	data?: T;
	error?: unknown;
};

export function createSuccessResult(content: unknown): CallToolResult {
	let text: string;

	if (typeof content === "string") {
		text = content;
	} else if (content === undefined) {
		text = "undefined";
	} else {
		text = JSON.stringify(content, null, 2);
	}

	return {
		content: [
			{
				type: "text",
				text,
			},
		],
	};
}

export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (error && typeof error === "object") {
		if ("message" in error && typeof error.message === "string") {
			return error.message;
		}

		if ("error" in error && typeof error.error === "string") {
			return error.error;
		}

		try {
			return JSON.stringify(error);
		} catch {
			// Fall through to String conversion.
		}
	}

	return String(error);
}

export function createErrorResult(error: string): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text: `Error: ${error}`,
			},
		],
		isError: true,
	};
}

export function hasApiError<T>(
	response: DataResponse<T>,
): response is DataResponse<T> & { error: unknown } {
	return "error" in response && response.error !== undefined;
}

export function createApiErrorResult(
	context: string,
	error: unknown,
): CallToolResult {
	return createErrorResult(`${context}: ${toErrorMessage(error)}`);
}

export function handleDataResponse<T>(
	response: DataResponse<T>,
	context: string,
	emptyDataMessage = `${context}: received empty data`,
): CallToolResult {
	if (hasApiError(response)) {
		return createApiErrorResult(context, response.error);
	}

	if (response.data === undefined) {
		return createErrorResult(emptyDataMessage);
	}

	return createSuccessResult(response.data);
}

export function validateRequiredParams(
	request: CallToolRequest,
	requiredParams: string[],
): string | null {
	const args = request.params.arguments || {};

	const hasValue = (value: unknown): boolean => {
		if (value === null || value === undefined) {
			return false;
		}
		if (typeof value === "string") {
			return value.trim().length > 0;
		}
		if (Array.isArray(value)) {
			return value.length > 0;
		}
		return true;
	};

	for (const param of requiredParams) {
		if (!(param in args) || !hasValue(args[param])) {
			return `Missing required parameter: ${param}`;
		}
	}

	return null;
}
