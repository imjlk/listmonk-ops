import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";

export const transactionalTools: MCPTool[] = [
	{
		name: "listmonk_send_transactional",
		description: "Send a transactional email",
		inputSchema: {
			type: "object",
			properties: {
				subscriber_email: {
					type: "string",
					description: "Recipient email address",
				},
				subscriber_id: {
					type: "string",
					description: "Recipient subscriber ID (alternative to email)",
				},
				template_id: {
					type: "number",
					description: "Template ID to use",
				},
				from_email: {
					type: "string",
					description: "From email address",
				},
				data: {
					type: "object",
					description: "Template data/variables",
				},
				headers: {
					type: "object",
					description: "Additional email headers",
				},
			},
			required: ["template_id"],
		},
	},
	{
		name: "listmonk_get_transactional_message",
		description: "Get a transactional message by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Message ID",
				},
			},
			required: ["id"],
		},
	},
];

export async function handleTransactionalTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;
	type TransactionalSendInput = Parameters<
		ListmonkClient["transactional"]["send"]
	>[0];

	try {
		switch (name) {
			case "listmonk_send_transactional": {
				const validation = validateRequiredParams(request, ["template_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				if (!args.subscriber_email && !args.subscriber_id) {
					return createErrorResult(
						"Either 'subscriber_email' or 'subscriber_id' is required",
					);
				}

				const templateId = Number(args.template_id);
				if (!Number.isInteger(templateId) || templateId <= 0) {
					return createErrorResult("template_id must be a positive integer");
				}

				const body: TransactionalSendInput = {
					template_id: templateId,
					data:
						typeof args.data === "object" &&
						args.data !== null &&
						!Array.isArray(args.data)
							? (args.data as Record<string, unknown>)
							: {},
					headers: Array.isArray(args.headers)
						? args.headers.filter(
								(entry): entry is Record<string, string> =>
									typeof entry === "object" &&
									entry !== null &&
									!Array.isArray(entry),
							)
						: [],
				};

				if (args.subscriber_email) {
					body.subscriber_email = String(args.subscriber_email);
				}
				if (args.subscriber_id) {
					const subscriberId = Number(args.subscriber_id);
					if (!Number.isInteger(subscriberId) || subscriberId <= 0) {
						return createErrorResult(
							"subscriber_id must be a positive integer",
						);
					}
					body.subscriber_id = subscriberId;
				}
				if (args.from_email) {
					body.from_email = String(args.from_email);
				}

				const response = await client.transactional.send(body);
				return createSuccessResult(response.data);
			}

			case "listmonk_get_transactional_message": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				// Note: This endpoint is not available in the current OpenAPI client
				// Would need to be added to the client if needed
				return createErrorResult(
					"Get transactional message not implemented in current client",
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
