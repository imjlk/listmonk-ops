import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	makeListmonkRequest,
	validateRequiredParams,
} from "../utils/response.js";

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
	baseUrl: string,
	auth: string,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_templates": {
				const page = args.page || 1;
				const perPage = args.per_page || 20;
				const url = `${baseUrl}/templates?page=${page}&per_page=${perPage}`;

				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch templates: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_get_template": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/templates/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch template: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_create_template": {
				const validation = validateRequiredParams(request, ["name", "body"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body = {
					name: args.name,
					type: args.type || "campaign",
					subject: args.subject || "",
					body: args.body,
				};

				const url = `${baseUrl}/templates`;
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
						`Failed to create template: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
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

				const url = `${baseUrl}/templates/${args.id}`;
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
						`Failed to update template: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_delete_template": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/templates/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "DELETE" },
					auth,
				);

				if (!response.ok) {
					const data = await response.json();
					return createErrorResult(
						`Failed to delete template: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult("Template deleted successfully");
			}

			case "listmonk_set_default_template": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/templates/${args.id}/default`;
				const response = await makeListmonkRequest(
					url,
					{ method: "PUT" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to set default template: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
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
