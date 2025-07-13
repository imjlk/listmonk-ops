import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import {
	createErrorResult,
	createSuccessResult,
	makeListmonkRequest,
	validateRequiredParams,
} from "../utils/response.js";

export const bouncesTools: MCPTool[] = [
	{
		name: "listmonk_get_bounces",
		description: "Get all bounces from Listmonk",
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
				campaign_id: {
					type: "string",
					description: "Filter by campaign ID",
				},
				subscriber_id: {
					type: "string",
					description: "Filter by subscriber ID",
				},
				source: {
					type: "string",
					description: "Filter by bounce source",
				},
			},
		},
	},
	{
		name: "listmonk_get_bounce",
		description: "Get a specific bounce by ID",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Bounce ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_bounce",
		description: "Delete a bounce record",
		inputSchema: {
			type: "object",
			properties: {
				id: {
					type: "string",
					description: "Bounce ID",
				},
			},
			required: ["id"],
		},
	},
	{
		name: "listmonk_delete_bounces",
		description: "Delete multiple bounce records",
		inputSchema: {
			type: "object",
			properties: {
				ids: {
					type: "array",
					items: { type: "string" },
					description: "Array of bounce IDs to delete",
				},
				all: {
					type: "boolean",
					description: "Delete all bounces",
					default: false,
				},
			},
		},
	},
];

export async function handleBouncesTools(
	request: CallToolRequest,
	baseUrl: string,
	auth: string,
): Promise<CallToolResult> {
	const { name, arguments: args = {} } = request.params;

	try {
		switch (name) {
			case "listmonk_get_bounces": {
				const page = args.page || 1;
				const perPage = args.per_page || 20;
				let url = `${baseUrl}/bounces?page=${page}&per_page=${perPage}`;

				if (args.campaign_id) {
					url += `&campaign_id=${args.campaign_id}`;
				}
				if (args.subscriber_id) {
					url += `&subscriber_id=${args.subscriber_id}`;
				}
				if (args.source) {
					url += `&source=${encodeURIComponent(args.source as string)}`;
				}

				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch bounces: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_get_bounce": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/bounces/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "GET" },
					auth,
				);
				const data = await response.json();

				if (!response.ok) {
					return createErrorResult(
						`Failed to fetch bounce: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult(data);
			}

			case "listmonk_delete_bounce": {
				const validation = validateRequiredParams(request, ["id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const url = `${baseUrl}/bounces/${args.id}`;
				const response = await makeListmonkRequest(
					url,
					{ method: "DELETE" },
					auth,
				);

				if (!response.ok) {
					const data = await response.json();
					return createErrorResult(
						`Failed to delete bounce: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult("Bounce deleted successfully");
			}

			case "listmonk_delete_bounces": {
				const url = `${baseUrl}/bounces`;
				const body: Record<string, unknown> = {};

				if (args.all) {
					body.all = true;
				} else if (args.ids && Array.isArray(args.ids)) {
					body.ids = args.ids;
				} else {
					return createErrorResult(
						"Either 'ids' array or 'all=true' must be provided",
					);
				}

				const response = await makeListmonkRequest(
					url,
					{
						method: "DELETE",
						body: JSON.stringify(body),
					},
					auth,
				);

				if (!response.ok) {
					const data = await response.json();
					return createErrorResult(
						`Failed to delete bounces: ${data.message || response.statusText}`,
					);
				}

				return createSuccessResult("Bounces deleted successfully");
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
