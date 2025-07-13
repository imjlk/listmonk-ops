import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	makeListmonkRequest,
	validateRequiredParams,
} from "../utils/response.js";

export const mediaTools: MCPTool[] = [
	{
		name: "listmonk_get_media",
		description: "Get all media files from Listmonk",
		inputSchema: {
			type: "object",
			properties: {
				page: {
					type: "number",
					description: "Page number for pagination",
					default: 1,
				},
				per_page: {
					type: "number",
					description: "Number of items per page",
					default: 20,
				},
			},
		},
	},
	{
		name: "listmonk_get_media_file",
		description: "Get a specific media file by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Media file ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_media",
		description: "Delete a media file",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Media file ID",
				},
			},
			required: ["id"],
		},
	},
];

export async function handleMediaTools(
	request: CallToolRequest,
	baseUrl: string,
	auth: string,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_media": {
				const page = args.page || 1;
				const perPage = args.per_page || 20;
				const url = `${baseUrl}/media?page=${page}&per_page=${perPage}`;

				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch media: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_get_media_file": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/media/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch media file: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_delete_media": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/media/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "DELETE" },
					auth,
				);

				if (!response.ok) {
					const data = await response.json();
					return createErrorResult(
						`Failed to delete media file: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult("Media file deleted successfully");
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return createErrorResult(
			`Error: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
