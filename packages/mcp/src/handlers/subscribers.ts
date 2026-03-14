import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
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

export async function handleSubscribersTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;
	type CreateSubscriberBody = NonNullable<
		Parameters<ListmonkClient["subscriber"]["create"]>[0]
	>["body"];
	type SubscriberStatus = "enabled" | "disabled" | "blocklisted";

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
					if (Array.isArray(args.list_id)) {
						queryParams.list_id = args.list_id.map((id) => Number(id));
					} else {
						queryParams.list_id = [Number(args.list_id)];
					}
				}
				if (args.query) {
					queryParams.query = args.query;
				}
				if (args.order_by) {
					queryParams.order_by = String(args.order_by);
				}
				if (args.order) {
					queryParams.order = String(args.order);
				}
				if (args.subscription_status) {
					queryParams.subscription_status = String(args.subscription_status);
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

				if ("error" in response) {
					return createErrorResult(
						`Failed to fetch subscriber: ${response.error}`,
					);
				}

				return createSuccessResult(response.data);
			}

			case "listmonk_create_subscriber": {
				const validation = validateRequiredParams(request, ["email", "name"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const lists = Array.isArray(args.lists)
					? args.lists
							.map((id) => Number(id))
							.filter((id) => Number.isInteger(id) && id > 0)
					: [];
				const attribs =
					typeof args.attribs === "object" &&
					args.attribs !== null &&
					!Array.isArray(args.attribs)
						? (args.attribs as Record<string, unknown>)
						: {};
				const statusValue =
					args.status === "disabled" || args.status === "blocklisted"
						? args.status
						: "enabled";

				const body: CreateSubscriberBody = {
					email: String(args.email),
					name: String(args.name),
					status: statusValue as SubscriberStatus,
					lists,
					attribs,
				};

				const response = await client.subscriber.create({
					body,
				});

				const createdSubscriber =
					response.data ??
					(
						await client.subscriber.list({
							query: {
								page: 1,
								per_page: 100,
								query: String(args.email),
							},
						})
					).data?.results?.find(
						(subscriber) => subscriber.email === String(args.email),
					);

				if (!createdSubscriber) {
					return createErrorResult(
						"Subscriber was created but the created record could not be resolved",
					);
				}

				return createSuccessResult(createdSubscriber);
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

				if ("error" in response) {
					return createErrorResult(
						`Failed to update subscriber: ${response.error}`,
					);
				}

				return createSuccessResult(response.data);
			}

			case "listmonk_delete_subscriber": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				await client.subscriber.delete({
					path: { id: parseId(args.id) },
				});

				return createSuccessResult("Subscriber deleted successfully");
			}

			case "listmonk_send_subscriber_optin": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.sendOptin({
					path: { id: parseId(args.id) },
				});

				return createSuccessResult(response.data);
			}

			case "listmonk_delete_subscribers_by_query": {
				const validation = validateRequiredParams(request, ["query"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.deleteByQuery({
					body: { query: String(args.query) },
				});

				return createSuccessResult(response.data);
			}

			case "listmonk_blocklist_subscribers_by_query": {
				const validation = validateRequiredParams(request, ["query"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.subscriber.blocklistByQuery({
					body: { query: String(args.query) },
				});

				return createSuccessResult(response.data);
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
