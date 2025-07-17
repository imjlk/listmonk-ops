import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { BounceFilterParams, HandlerFunction } from "../types/shared.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import {
	handleCrudResponse,
	parsePaginationParams,
	parseId,
	withErrorHandler,
	arrayToCommaString,
} from "../utils/typeHelpers.js";

export const bouncesTools: MCPTool[] = [
	{
		name: "listmonk_get_bounces",
		description: "Get all bounces from Listmonk",
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
				campaign_id: {
					type: "string",
					description: "Filter by campaign ID",
				},
				subscriber_id: {
					type: "string",
					description: "Filter by subscriber ID",
				},
				source: {
					type: "string",
					description: "Filter by bounce source",
				},
			},
		},
	},
	{
		name: "listmonk_get_bounce",
		description: "Get a specific bounce by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Bounce ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_bounce",
		description: "Delete a bounce record",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Bounce ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_bounces",
		description: "Delete multiple bounce records",
		inputSchema: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Array of bounce IDs to delete",
				},
				all: {
					type: "boolean",
					description: "Delete all bounces",
					default: false,
				},
			},
		},
	},
];

export const handleBouncesTools: HandlerFunction = withErrorHandler(
	async (request: CallToolRequest, client: ListmonkClient): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case "listmonk_get_bounces": {
				const options: any = {
					...parsePaginationParams(args),
				};

				if (args.campaign_id) {
					options.campaign_id = Number(args.campaign_id);
				}
				if (args.source) {
					options.source = String(args.source);
				}

				const response = await client.bounce.list(options);
				return createSuccessResult(response.data);
			}

			case "listmonk_get_bounce": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.bounce.getById({
					path: { id: parseId(args.id) },
				});

				return handleCrudResponse(response, "Failed to fetch bounce");
			}

			case "listmonk_delete_bounce": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				await client.bounce.deleteById({
					path: { id: parseId(args.id) },
				});
				return createSuccessResult("Bounce deleted successfully");
			}

			case "listmonk_delete_bounces": {
				const query: { all?: boolean; id?: string } = {};

				if (args.all) {
					query.all = true;
				} else if (args.ids && Array.isArray(args.ids)) {
					query.id = arrayToCommaString(args.ids);
				} else {
					return createErrorResult(
						"Either 'ids' array or 'all=true' must be provided",
					);
				}

				await client.bounce.delete({ query });
				return createSuccessResult("Bounces deleted successfully");
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	}
);
