import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import { parseId } from "../utils/typeHelpers.js";

export const templatesTools: MCPTool[] = [
	{
		name: "listmonk_get_templates",
		description: "Get all templates from Listmonk",
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
		name: "listmonk_get_template",
		description: "Get a specific template by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Template ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_create_template",
		description: "Create a new template",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Template name",
				},
				type: {
					type: "string",
					enum: ["campaign", "tx"],
					description: "Template type",
					default: "campaign",
				},
				subject: {
					type: "string",
					description: "Email subject template",
				},
				body: {
					type: "string",
					description: "Email body template",
				},
			},
			required: ["name", "body"],
		},
	},
	{
		name: "listmonk_update_template",
		description: "Update an existing template",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Template ID",
				},
				name: {
					type: "string",
					description: "Template name",
				},
				type: {
					type: "string",
					enum: ["campaign", "tx"],
					description: "Template type",
				},
				subject: {
					type: "string",
					description: "Email subject template",
				},
				body: {
					type: "string",
					description: "Email body template",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_template",
		description: "Delete a template",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Template ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_set_default_template",
		description: "Set a template as default",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Template ID",
				},
			},
			required: ["id"],
		},
	},
];

export async function handleTemplatesTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_templates": {
				const options: any = {
					query: {
						page: args.page || 1,
						per_page: args.per_page || 20,
					},
				};

				const response = await client.template.list(options);
				return createSuccessResult(response.data);
			}

			case "listmonk_get_template": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.template.getById({
					path: { id: parseId(args.id) },
				});

				if ("error" in response) {
					return createErrorResult(
						`Failed to fetch template: ${response.error}`,
					);
				}

				return createSuccessResult(response.data);
			}

			case "listmonk_create_template": {
				const validation = validateRequiredParams(request, ["name", "body"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body = {
					name: args.name as string,
					type:
						(args.type as "campaign" | "campaign_visual" | "tx") || "campaign",
					subject: (args.subject as string) || "",
					body: args.body as string,
				};

				const response = await client.template.create({ body });
				return createSuccessResult(response.data);
			}

			case "listmonk_update_template": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body: Record<string, unknown> = {};
				if (args.name) body.name = args.name;
				if (args.type) body.type = args.type;
				if (args.subject !== undefined) body.subject = args.subject;
				if (args.body) body.body = args.body;

				const response = await client.template.update({
					path: { id: parseId(args.id) },
					body,
				});

				if ("error" in response) {
					return createErrorResult(
						`Failed to update template: ${response.error}`,
					);
				}

				return createSuccessResult(response.data);
			}

			case "listmonk_delete_template": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				await client.template.delete({
					path: { id: parseId(args.id) },
				});
				return createSuccessResult("Template deleted successfully");
			}

			case "listmonk_set_default_template": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				await client.template.setAsDefault({
					path: { id: parseId(args.id) },
				});
				return createSuccessResult("Default template set successfully");
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
