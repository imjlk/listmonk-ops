import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	makeListmonkRequest,
	validateRequiredParams,
} from "../utils/response.js";

export const campaignsTools: MCPTool[] = [
	{
		name: "listmonk_get_campaigns",
		description: "Get all campaigns from Listmonk",
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
				status: {
					type: "string",
					enum: [
						"draft",
						"scheduled",
						"running",
						"paused",
						"finished",
						"cancelled",
					],
					description: "Filter by campaign status",
				},
			},
		},
	},
	{
		name: "listmonk_get_campaign",
		description: "Get a specific campaign by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Campaign ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_create_campaign",
		description: "Create a new campaign",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Campaign name",
				},
				subject: {
					type: "string",
					description: "Email subject",
				},
				from_email: {
					type: "string",
					description: "From email address",
				},
				body: {
					type: "string",
					description: "Campaign body/content",
				},
				altbody: {
					type: "string",
					description: "Plain text alternative body",
				},
				type: {
					type: "string",
					enum: ["regular", "optin"],
					description: "Campaign type",
					default: "regular",
				},
				template_id: {
					type: "number",
					description: "Template ID to use",
				},
				lists: {
					type: "array",
					items: { type: "number" },
					description: "List IDs to send to",
				},
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Campaign tags",
				},
			},
			required: [
				"name",
				"subject",
				"from_email",
				"body",
				"template_id",
				"lists",
			],
		},
	},
	{
		name: "listmonk_update_campaign_status",
		description: "Update campaign status (start, pause, cancel, etc.)",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Campaign ID",
				},
				status: {
					type: "string",
					enum: [
						"draft",
						"scheduled",
						"running",
						"paused",
						"finished",
						"cancelled",
					],
					description: "New campaign status",
				},
			},
			required: ["id", "status"],
		},
	},
	{
		name: "listmonk_delete_campaign",
		description: "Delete a campaign",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Campaign ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_test_campaign",
		description: "Send a test campaign to specified emails",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Campaign ID",
				},
				emails: {
					type: "array",
					items: { type: "string" },
					description: "Email addresses to send test to",
				},
			},
			required: ["id", "emails"],
		},
	},
];

export async function handleCampaignsTools(
	request: CallToolRequest,
	baseUrl: string,
	auth: string,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_campaigns": {
				const page = args.page || 1;
				const perPage = args.per_page || 20;
				let url = `${baseUrl}/campaigns?page=${page}&per_page=${perPage}`;

				if (args.status) {
					url += `&status=${args.status}`;
				}

				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch campaigns: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_get_campaign": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/campaigns/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch campaign: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_create_campaign": {
				const validation = validateRequiredParams(request, [
					"name",
					"subject",
					"from_email",
					"body",
					"template_id",
					"lists",
				]);
				if (validation) {
					return createErrorResult(validation);
				}

				const body = {
					name: args.name,
					subject: args.subject,
					from_email: args.from_email,
					body: args.body,
					altbody: args.altbody || "",
					type: args.type || "regular",
					template_id: args.template_id,
					lists: args.lists,
					tags: args.tags || [],
					messenger: "email",
				};

				const url = `${baseUrl}/campaigns`;
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
						`Failed to create campaign: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_update_campaign_status": {
				const validation = validateRequiredParams(request, ["id", "status"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/campaigns/${args.id}/status`;
				const response = await makeListmonkRequest(
					url,
					{
						method: "PUT",
						body: JSON.stringify({ status: args.status }),
					},
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to update campaign status: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_delete_campaign": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/campaigns/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "DELETE" },
					auth,
				);

				if (!response.ok) {
					const data = await response.json();
					return createErrorResult(
						`Failed to delete campaign: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult("Campaign deleted successfully");
			}

			case "listmonk_test_campaign": {
				const validation = validateRequiredParams(request, ["id", "emails"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/campaigns/${args.id}/test`;
				const response = await makeListmonkRequest(
					url,
					{
						method: "POST",
						body: JSON.stringify({ emails: args.emails }),
					},
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to send test campaign: ${data.message || response.statusText}`,
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
