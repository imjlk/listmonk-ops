import type { CallToolRequest, CallToolResult } from "../types/mcp.js";

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

export function validateRequiredParams(
	request: CallToolRequest,
	requiredParams: string[],
): string | null {
	const args = request.params.arguments || {};

	for (const param of requiredParams) {
		if (!args[param]) {
			return `Missing required parameter: ${param}`;
		}
	}

	return null;
}

export function getBasicAuth(username: string, password: string): string {
	return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

