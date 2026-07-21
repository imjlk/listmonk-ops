import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	campaignOperations,
	invokeCampaignOperationByMcpName,
} from "@listmonk-ops/operations";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createOperationResult, toMcpTool } from "./operation-adapter.js";
import {
	createApiErrorResult,
	createErrorResult,
	handleDataResponse,
	validateRequiredParams,
} from "../utils/response.js";
import {
	castCampaignStatus,
	parseId,
	withErrorHandler,
} from "../utils/typeHelpers.js";

const campaignLegacyTools: MCPTool[] = [
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
				query: {
					type: "string",
					description: "SQL query expression to filter campaigns",
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
				tags: {
					type: "array",
					items: { type: "string" },
					description: "Filter by campaign tags",
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
	{
		name: "listmonk_get_campaign_running_stats",
		description: "Get live sending stats for a running campaign",
		inputSchema: {
			type: "object",
			properties: {
				campaign_id: {
					type: "string",
					description: "Campaign ID",
				},
			},
			required: ["campaign_id"],
		},
	},
	{
		name: "listmonk_get_campaign_analytics",
		description:
			"Get campaign analytics timeseries (links/views/clicks/bounces)",
		inputSchema: {
			type: "object",
			properties: {
				type: {
					type: "string",
					enum: ["links", "views", "clicks", "bounces"],
					description: "Analytics type",
				},
				from: {
					type: "string",
					description: "Start datetime (RFC3339)",
				},
				to: {
					type: "string",
					description: "End datetime (RFC3339)",
				},
				id: {
					type: "string",
					description:
						"Campaign ID(s), comma-separated if requesting multiple campaigns",
				},
			},
			required: ["type", "from", "to", "id"],
		},
	},
];

export const campaignsTools: MCPTool[] = [
	...campaignOperations.map(toMcpTool),
	...campaignLegacyTools.filter(
		(tool) => !campaignOperations.some((operation) => operation.mcp.name === tool.name),
	),
];

export const handleCampaignsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;
		const operationInvocation = await invokeCampaignOperationByMcpName(
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
			case "listmonk_update_campaign_status": {
				const validation = validateRequiredParams(request, ["id", "status"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.campaign.updateStatus({
					path: { id: parseId(args.id) },
					body: { status: castCampaignStatus(args.status) },
				});
				return handleDataResponse(response, "Failed to update campaign status");
			}

			case "listmonk_test_campaign": {
				const validation = validateRequiredParams(request, ["id", "emails"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const campaignId = parseId(args.id);
				const currentResponse = await client.campaign.getById({
					path: { id: campaignId },
				});
				if ("error" in currentResponse) {
					return createApiErrorResult(
						"Failed to load campaign before test send",
						currentResponse.error,
					);
				}

				const currentCampaign = currentResponse.data;
				if (!currentCampaign) {
					return createErrorResult("Campaign not found");
				}

				const response = await client.campaign.test({
					path: { id: campaignId },
					body: {
						name: currentCampaign.name ?? `campaign-${campaignId}`,
						subject: currentCampaign.subject ?? "",
						from_email: currentCampaign.from_email ?? "",
						body: currentCampaign.body ?? "",
						altbody: currentCampaign.altbody,
						content_type: currentCampaign.content_type ?? "html",
						template_id: currentCampaign.template_id,
						headers: currentCampaign.headers ?? [],
						lists:
							currentCampaign.lists
								?.map((list) => Number(list.id))
								.filter((id) => Number.isInteger(id) && id > 0) ?? [],
						media:
							currentCampaign.media
								?.map((item) => Number(item.id))
								.filter((id) => Number.isInteger(id) && id > 0) ?? [],
						subscribers: Array.isArray(args.emails)
							? args.emails.map((email) => String(email))
							: [],
						messenger: currentCampaign.messenger ?? "email",
						type: currentCampaign.type ?? "regular",
						tags: Array.isArray(currentCampaign.tags)
							? currentCampaign.tags
							: [],
					},
				});
				return handleDataResponse(response, "Failed to send test campaign");
			}

			case "listmonk_get_campaign_running_stats": {
				const validation = validateRequiredParams(request, ["campaign_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.campaign.getRunningStats({
					query: { campaign_id: parseId(args.campaign_id) },
				});
				return handleDataResponse(
					response,
					"Failed to fetch running campaign stats",
				);
			}

			case "listmonk_get_campaign_analytics": {
				const validation = validateRequiredParams(request, [
					"type",
					"from",
					"to",
					"id",
				]);
				if (validation) {
					return createErrorResult(validation);
				}

				const response = await client.campaign.getAnalytics({
					path: {
						type: String(args.type) as "links" | "views" | "clicks" | "bounces",
					},
					query: {
						from: String(args.from),
						to: String(args.to),
						id: String(args.id),
					},
				});
				return handleDataResponse(
					response,
					"Failed to fetch campaign analytics",
				);
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
