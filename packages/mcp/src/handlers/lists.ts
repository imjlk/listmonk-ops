import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	makeListmonkRequest,
	validateRequiredParams,
} from "../utils/response.js";

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

export async function handleListsTools(
	request: CallToolRequest,
	baseUrl: string,
	auth: string,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_lists": {
				const page = args.page || 1;
				const perPage = args.per_page || 20;
				const url = `${baseUrl}/lists?page=${page}&per_page=${perPage}`;

				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch lists: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_get_list": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/lists/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch list: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_create_list": {
				const validation = validateRequiredParams(request, ["name"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body = {
					name: args.name,
					type: args.type || "private",
					optin: args.optin || "single",
					description: args.description || "",
					tags: args.tags || [],
				};

				const url = `${baseUrl}/lists`;
				const response = await makeListmonkRequest(
					url,
					{
						method: "POST",
						body: JSON.stringify(body),
					},
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to create list: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_update_list": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body: Record<string, unknown> = {};
				if (args.name) body.name = args.name;
				if (args.type) body.type = args.type;
				if (args.optin) body.optin = args.optin;
				if (args.description !== undefined) body.description = args.description;
				if (args.tags) body.tags = args.tags;

				const url = `${baseUrl}/lists/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{
						method: "PUT",
						body: JSON.stringify(body),
					},
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to update list: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_delete_list": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/lists/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "DELETE" },
					auth,
				);

				if (!response.ok) {
					const data = await response.json();
					return createErrorResult(
						`Failed to delete list: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult("List deleted successfully");
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
