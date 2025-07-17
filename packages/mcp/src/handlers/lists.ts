import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import {
	castListType,
	castOptinType,
	handleCrudResponse,
	parseId,
	parsePaginationParams,
	withErrorHandler,
} from "../utils/typeHelpers.js";

export const listsTools: MCPTool[] = [
	{
		name: "listmonk_get_lists",
		description: "Get all subscriber lists from Listmonk",
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
		name: "listmonk_get_list",
		description: "Get a specific subscriber list by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "List ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_create_list",
		description: "Create a new subscriber list",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "List name",
				},
				type: {
					type: "string",
					enum: ["public", "private"],
					description: "List type",
					default: "private",
				},
				optin: {
					type: "string",
					enum: ["single", "double"],
					description: "Opt-in type",
					default: "single",
				},
				description: {
					type: "string",
					description: "List description",
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "List tags",
				},
			},
			required: ["name"],
		},
	},
	{
		name: "listmonk_update_list",
		description: "Update an existing subscriber list",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "List ID",
				},
				name: {
					type: "string",
					description: "List name",
				},
				type: {
					type: "string",
					enum: ["public", "private"],
					description: "List type",
				},
				optin: {
					type: "string",
					enum: ["single", "double"],
					description: "Opt-in type",
				},
				description: {
					type: "string",
					description: "List description",
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "List tags",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_list",
		description: "Delete a subscriber list",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "List ID",
				},
			},
			required: ["id"],
		},
	},
];

export const handleListsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case "listmonk_get_lists": {
				const options: any = parsePaginationParams(args);

				const response = await client.list.list(options);
				return createSuccessResult(response.data);
			}

			case "listmonk_get_list": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.list.getById({
					path: { list_id: parseId(args.id) },
				});

				return handleCrudResponse(response, "Failed to fetch list");
			}

			case "listmonk_create_list": {
				const validation = validateRequiredParams(request, ["name"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body: any = {
					name: String(args.name),
					type: args.type ? castListType(args.type) : "private",
					optin: args.optin ? castOptinType(args.optin) : "single",
					description: String(args.description || ""),
					tags: Array.isArray(args.tags) ? args.tags : [],
				};

				const response = await client.list.create({ body });
				return createSuccessResult(response.data);
			}

			case "listmonk_update_list": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body: any = {};
				if (args.name) body.name = String(args.name);
				if (args.type) body.type = castListType(args.type);
				if (args.optin) body.optin = castOptinType(args.optin);
				if (args.description !== undefined)
					body.description = String(args.description);
				if (args.tags) body.tags = Array.isArray(args.tags) ? args.tags : [];

				await client.list.update({
					path: { list_id: parseId(args.id) },
					body,
				});

				return createSuccessResult("List updated successfully");
			}

			case "listmonk_delete_list": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				await client.list.delete({
					path: { list_id: parseId(args.id) },
				});

				return createSuccessResult("List deleted successfully");
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
