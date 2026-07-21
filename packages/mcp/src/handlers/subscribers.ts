import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeSubscriberOperationByMcpName,
	subscriberOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import {
	createErrorResult,
	handleDataResponse,
	validateRequiredParams,
} from "../utils/response.js";
import { parseId } from "../utils/typeHelpers.js";

const subscriberLegacyTools: MCPTool[] = [
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
					type: "array",
					items: { type: "number" },
					description: "Filter by one or more list IDs",
				},
				query: {
					type: "string",
					description: "Search query",
				},
				order_by: {
					type: "string",
					enum: ["name", "status", "created_at", "updated_at"],
					description: "Sort field",
				},
				order: {
					type: "string",
					enum: ["ASC", "DESC"],
					description: "Sort order",
				},
				subscription_status: {
					type: "string",
					enum: ["confirmed", "unconfirmed", "unsubscribed"],
					description: "Subscription status filter when list_id is provided",
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
	{
		name: "listmonk_send_subscriber_optin",
		description: "Send double opt-in email to a subscriber by ID",
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
		name: "listmonk_delete_subscribers_by_query",
		description: "Delete subscribers matching an SQL query expression",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "SQL expression to match subscribers",
				},
			},
			required: ["query"],
		},
	},
	{
		name: "listmonk_blocklist_subscribers_by_query",
		description:
			"Add matching subscribers to blocklist using SQL query expression",
		inputSchema: {
			type: "object",
			properties: {
				query: {
					type: "string",
					description: "SQL expression to match subscribers",
				},
			},
			required: ["query"],
		},
	},
];

export const subscribersTools: MCPTool[] = [
	...subscriberOperations.map(toMcpTool),
	...subscriberLegacyTools.filter(
		(tool) =>
			!subscriberOperations.some((operation) => operation.mcp.name === tool.name),
	),
];

export async function handleSubscribersTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;
	try {
		const operationInvocation = await invokeSubscriberOperationByMcpName(
			{ client },
			name,
			args,
		);
		if (operationInvocation) {
			return createOperationResult(
				operationInvocation.operation,
				operationInvocation.output,
			);
		}

		switch (name) {
			case "listmonk_send_subscriber_optin": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.sendOptin({
					path: { id: parseId(args.id) },
				});

				return handleDataResponse(response, "Failed to send subscriber opt-in");
			}

			case "listmonk_delete_subscribers_by_query": {
				const validation = validateRequiredParams(request, ["query"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.deleteByQuery({
					body: { query: String(args.query) },
				});

				return handleDataResponse(
					response,
					"Failed to delete subscribers by query",
				);
			}

			case "listmonk_blocklist_subscribers_by_query": {
				const validation = validateRequiredParams(request, ["query"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.blocklistByQuery({
					body: { query: String(args.query) },
				});

				return handleDataResponse(
					response,
					"Failed to blocklist subscribers by query",
				);
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	} catch (error) {
		return createErrorResult(
			error instanceof Error ? error.message : String(error),
		);
	}
}
