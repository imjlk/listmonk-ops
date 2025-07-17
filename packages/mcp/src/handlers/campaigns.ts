import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import {
	castCampaignStatus,
	handleCrudResponse,
	parseId,
	parsePaginationParams,
	withErrorHandler,
} from "../utils/typeHelpers.js";

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

export const handleCampaignsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case "listmonk_get_campaigns": {
				const options: any = {
					...parsePaginationParams(args),
					...(args.status && { status: [args.status] }),
				};

				const response = await client.campaign.list(options);
				return createSuccessResult(response.data);
			}

			case "listmonk_get_campaign": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.campaign.getById({
					path: { id: parseId(args.id) },
				});

				return handleCrudResponse(response, "Failed to fetch campaign");
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

				const body: any = {
					name: String(args.name),
					subject: String(args.subject),
					from_email: String(args.from_email),
					body: String(args.body),
					altbody: String(args.altbody || ""),
					type: String(args.type || "regular"),
					template_id: Number(args.template_id),
					lists: Array.isArray(args.lists) ? args.lists : [],
					tags: Array.isArray(args.tags) ? args.tags : [],
					messenger: "email",
				};

				const response = await client.campaign.create({ body });
				return createSuccessResult(response.data);
			}

			case "listmonk_update_campaign_status": {
				const validation = validateRequiredParams(request, ["id", "status"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.campaign.updateStatus({
					path: { id: parseId(args.id) },
					body: { status: castCampaignStatus(args.status) },
				});
				return createSuccessResult(response.data);
			}

			case "listmonk_delete_campaign": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.campaign.delete({
					path: { id: parseId(args.id) },
				});
				return createSuccessResult(response.data);
			}

			case "listmonk_test_campaign": {
				const validation = validateRequiredParams(request, ["id", "emails"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.campaign.test({
					path: { id: parseId(args.id) },
					body: { subscribers: Array.isArray(args.emails) ? args.emails : [] },
				});
				return createSuccessResult(response.data);
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
