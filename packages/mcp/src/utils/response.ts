import type { CallToolRequest, CallToolResult } from "../types/mcp.js";

export function createSuccessResult(content: unknown): CallToolResult {
	return {
		content: [
			{
				type: "text",
				text:
					typeof content === "string"
						? content
						: JSON.stringify(content, null, 2),
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

export async function makeListmonkRequest(
	url: string,
	options: RequestInit,
	auth: string,
): Promise<Response> {
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...(options.headers as Record<string, string>),
	};

	// Check if auth is Basic auth
	if (auth.startsWith("Basic ")) {
		headers.Authorization = auth;
	} else {
		// Assume it's an API token - use 'token username:api_token' format for Listmonk
		headers.Authorization = `token ${auth}`;
	}

	console.log("Making request to:", url);
	console.log("Authorization header:", headers.Authorization);

	return fetch(url, {
		...options,
		headers,
	});
}
