import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	invokeTemplateOperationByMcpName,
	templateOperations,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import { parseId } from "../utils/typeHelpers.js";

const templateLegacyTools: MCPTool[] = [
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
				no_body: {
					type: "boolean",
					description: "Omit template body in response",
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
					enum: ["campaign", "campaign_visual", "tx"],
					description: "Template type",
					default: "campaign",
				},
				subject: {
					type: "string",
					description: "Email subject template",
				},
				body_source: {
					type: "string",
					description: "Optional visual editor source payload",
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
					enum: ["campaign", "campaign_visual", "tx"],
					description: "Template type",
				},
				subject: {
					type: "string",
					description: "Email subject template",
				},
				body_source: {
					type: "string",
					description: "Optional visual editor source payload",
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

export const templatesTools: MCPTool[] = [
	...templateOperations.map(toMcpTool),
	...templateLegacyTools.filter(
		(tool) =>
			!templateOperations.some((operation) => operation.mcp.name === tool.name),
	),
];

export async function handleTemplatesTools(
	request: CallToolRequest,
	client: ListmonkClient,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		const operationInvocation = await invokeTemplateOperationByMcpName(
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
			error instanceof Error ? error.message : String(error),
		);
	}
}
