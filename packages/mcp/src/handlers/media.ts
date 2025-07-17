import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import {
	parseId,
	parsePaginationParams,
	withErrorHandler,
} from "../utils/typeHelpers.js";

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

export const handleMediaTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case "listmonk_get_media": {
				const options: any = parsePaginationParams(args);

				const response = await client.media.list(options);
				return createSuccessResult(response.data);
			}

			case "listmonk_get_media_file": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.media.getById({
					path: { id: parseId(args.id) },
				});

				if ("error" in response) {
					return createErrorResult(
						`Failed to fetch media file: ${response.error}`,
					);
				}

				return createSuccessResult(response.data);
			}

			case "listmonk_delete_media": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				await client.media.deleteById({
					path: { id: parseId(args.id) },
				});

				return createSuccessResult("Media file deleted successfully");
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
