import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import { parseId } from "../utils/typeHelpers.js";

export const subscribersTools: MCPTool[] = [
	{
		name: "listmonk_get_subscribers",
		description: "Get all subscribers from Listmonk",
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
				list_id: {
					type: "string",
					description: "Filter by list ID",
				},
				query: {
					type: "string",
					description: "Search query",
				},
			},
		},
	},
	{
		name: "listmonk_get_subscriber",
		description: "Get a specific subscriber by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Subscriber ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_create_subscriber",
		description: "Create a new subscriber",
		inputSchema: {
			type: "object",
			properties: {
				email: {
					type: "string",
					description: "Subscriber email",
				},
				name: {
					type: "string",
					description: "Subscriber name",
				},
				status: {
					type: "string",
					enum: ["enabled", "disabled", "blocklisted"],
					description: "Subscriber status",
					default: "enabled",
				},
				lists: {
					type: "array",
					items: { type: "number" },
					description: "List IDs to subscribe to",
				},
				attribs: {
					type: "object",
					description: "Custom attributes",
				},
			},
			required: ["email", "name"],
		},
	},
	{
		name: "listmonk_update_subscriber",
		description: "Update an existing subscriber",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Subscriber ID",
				},
				email: {
					type: "string",
					description: "Subscriber email",
				},
				name: {
					type: "string",
					description: "Subscriber name",
				},
				status: {
					type: "string",
					enum: ["enabled", "disabled", "blocklisted"],
					description: "Subscriber status",
				},
				lists: {
					type: "array",
					items: { type: "number" },
					description: "List IDs to subscribe to",
				},
				attribs: {
					type: "object",
					description: "Custom attributes",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_subscriber",
		description: "Delete a subscriber",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Subscriber ID",
				},
			},
			required: ["id"],
		},
	},
];

export async function handleSubscribersTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_subscribers": {
				const page = args.page || 1;
				const perPage = args.per_page || 20;
				const queryParams: Record<string, unknown> = {
					page,
					per_page: perPage,
				};

				if (args.list_id) {
					queryParams.list_id = args.list_id;
				}
				if (args.query) {
					queryParams.query = args.query;
				}

				const response = await client.subscriber.list({
					query: queryParams,
				});

				return createSuccessResult(response.data);
			}

			case "listmonk_get_subscriber": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.getById({
					path: { id: parseId(args.id) },
				});

				if ('error' in response) {
					return createErrorResult(`Failed to fetch subscriber: ${response.error}`);
				}

				return createSuccessResult(response.data);
			}

			case "listmonk_create_subscriber": {
				const validation = validateRequiredParams(request, ["email", "name"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body: any = {
					email: String(args.email),
					name: String(args.name),
					status: String(args.status || "enabled"),
					lists: Array.isArray(args.lists) ? args.lists : [],
					attribs: args.attribs || {},
				};

				const response = await client.subscriber.create({
					body,
				});

				return createSuccessResult(response.data);
			}

			case "listmonk_update_subscriber": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body: Record<string, unknown> = {};
				if (args.email) body.email = args.email;
				if (args.name) body.name = args.name;
				if (args.status) body.status = args.status;
				if (args.lists) body.lists = args.lists;
				if (args.attribs) body.attribs = args.attribs;

				const response = await client.subscriber.update({
					path: { id: parseId(args.id) },
					body,
				});

				if ('error' in response) {
					return createErrorResult(`Failed to update subscriber: ${response.error}`);
				}

				return createSuccessResult(response.data);
			}

			case "listmonk_delete_subscriber": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.delete({
					path: { id: parseId(args.id) },
				});

				return createSuccessResult("Subscriber deleted successfully");
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
