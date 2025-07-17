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

				const body: Record<string, unknown> = {
					template_id: args.template_id,
					data: args.data || {},
					headers: args.headers || {},
				};

				if (args.subscriber_email) {
					body.subscriber_email = args.subscriber_email;
				}
				if (args.subscriber_id) {
					body.subscriber_id = args.subscriber_id;
				}
				if (args.from_email) {
					body.from_email = args.from_email;
				}

				const response = await client.transactional.send(body as any);
				return createSuccessResult(response.data);
			}

			case "listmonk_get_transactional_message": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				// Note: This endpoint is not available in the current OpenAPI client
				// Would need to be added to the client if needed
				return createErrorResult("Get transactional message not implemented in current client");
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
