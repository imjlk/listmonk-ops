import {
	listMcpOperationCatalogSummaries,
} from "../operation-catalog.js";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { createErrorResult } from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

const operationSummarySchema = {
	type: "object",
	properties: {
		family: { type: "string" },
		familyTitle: { type: "string" },
		id: { type: "string" },
		mcpName: { type: "string" },
		title: { type: "string" },
		description: { type: "string" },
		inputSchema: { type: "object" },
		outputSchema: { type: "object" },
		safety: {
			type: "object",
			properties: {
				readOnlyHint: { type: "boolean" },
				destructiveHint: { type: "boolean" },
				idempotentHint: { type: "boolean" },
				openWorldHint: { type: "boolean" },
			},
			required: [
				"readOnlyHint",
				"destructiveHint",
				"idempotentHint",
				"openWorldHint",
			],
		},
	},
	required: [
		"family",
		"familyTitle",
		"id",
		"mcpName",
		"title",
		"description",
		"inputSchema",
		"outputSchema",
		"safety",
	],
} as const;

export const operationCatalogTools: readonly MCPTool[] = [
	{
		name: "listmonk_list_operations",
		title: "List shared operations",
		description:
			"List typed operation contracts shared by the Listmonk CLI and MCP server",
		inputSchema: {
			type: "object",
			properties: {
				family: {
					type: "string",
					minLength: 1,
					description:
						"Optional exact family: lists, subscribers, campaigns, templates, transactional, ops, or abtest",
				},
			},
		},
		outputSchema: {
			type: "object",
			properties: {
				operations: {
					type: "array",
					items: operationSummarySchema,
				},
			},
			required: ["operations"],
		},
		annotations: {
			title: "List shared operations",
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false,
		},
	},
];

function parseFamily(input: unknown): string | undefined {
	if (input === undefined) {
		return undefined;
	}
	if (typeof input !== "string" || input.trim().length === 0) {
		throw new TypeError(
			"Invalid parameter family: expected a non-empty string",
		);
	}
	return input.trim();
}

export const handleOperationCatalogTools: HandlerFunction = withErrorHandler(
	async (request: CallToolRequest): Promise<CallToolResult> => {
		if (request.params.name !== "listmonk_list_operations") {
			return createErrorResult(`Unknown tool: ${request.params.name}`);
		}

		const family = parseFamily(request.params.arguments?.family);
		const operations = listMcpOperationCatalogSummaries(family);
		return {
			content: [
				{ type: "text", text: JSON.stringify({ operations }, null, 2) },
			],
			structuredContent: { operations },
		};
	},
);
