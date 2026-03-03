import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	evaluateDeliverabilityGuard,
	generateDailyDigest,
	getOpsStorePaths,
	getTemplateRegistryHistory,
	promoteTemplateVersion,
	rollbackTemplateVersion,
	runCampaignPreflight,
	runSegmentDriftSnapshot,
	runSubscriberHygiene,
	syncTemplateRegistry,
} from "@listmonk-ops/ops";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import { parseId, withErrorHandler } from "../utils/typeHelpers.js";

function parseBoolean(value: unknown, fallback: boolean): boolean {
	if (value === undefined || value === null) return fallback;
	if (typeof value === "boolean") return value;
	if (typeof value === "string") {
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;
	}
	return fallback;
}

function parseNumber(value: unknown, fallback: number): number {
	if (value === undefined || value === null || value === "") {
		return fallback;
	}
	const parsed = typeof value === "number" ? value : Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalPositiveIntArray(value: unknown): number[] | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (!Array.isArray(value)) {
		throw new Error("Expected an array of positive integers");
	}

	const parsed = value
		.map((entry) => parseId(entry))
		.filter((entry) => Number.isInteger(entry) && entry > 0);

	return parsed.length > 0 ? parsed : undefined;
}

export const opsTools: MCPTool[] = [
	{
		name: "listmonk_ops_preflight",
		description: "Run pre-send campaign preflight checks",
		inputSchema: {
			type: "object",
			properties: {
				campaign_id: { type: "string", description: "Campaign ID" },
				max_audience: {
					type: "number",
					description: "Warning threshold for audience size",
				},
				check_links: {
					type: "boolean",
					description: "Check outbound links in campaign body",
				},
			},
			required: ["campaign_id"],
		},
	},
	{
		name: "listmonk_ops_deliverability_guard",
		description:
			"Evaluate deliverability guard and optionally pause campaign on breach",
		inputSchema: {
			type: "object",
			properties: {
				campaign_id: { type: "string", description: "Campaign ID" },
				bounce_threshold: { type: "number", description: "Max bounce rate" },
				open_threshold: { type: "number", description: "Min open rate" },
				click_threshold: { type: "number", description: "Min click rate" },
				pause_on_breach: {
					type: "boolean",
					description: "Pause campaign when breach detected",
				},
			},
			required: ["campaign_id"],
		},
	},
	{
		name: "listmonk_ops_subscriber_hygiene",
		description: "Run subscriber hygiene workflow (winback/sunset)",
		inputSchema: {
			type: "object",
			properties: {
				mode: {
					type: "string",
					enum: ["winback", "sunset"],
					description: "Hygiene mode",
				},
				inactivity_days: {
					type: "number",
					description: "Inactive threshold in days",
				},
				source_list_ids: {
					type: "array",
					items: { type: "number" },
					description: "Filter source list IDs",
				},
				target_list_id: {
					type: "number",
					description: "Target list ID",
				},
				blocklist: {
					type: "boolean",
					description: "Blocklist sunset candidates",
				},
				dry_run: {
					type: "boolean",
					description: "Preview candidates without mutations",
				},
				max_subscribers: {
					type: "number",
					description: "Max candidates to process",
				},
			},
		},
	},
	{
		name: "listmonk_ops_segment_drift",
		description: "Snapshot list sizes and detect segment drift",
		inputSchema: {
			type: "object",
			properties: {
				list_ids: {
					type: "array",
					items: { type: "number" },
					description: "Specific list IDs to monitor",
				},
				threshold: { type: "number", description: "Relative drift threshold" },
				min_absolute_change: {
					type: "number",
					description: "Min absolute delta for alerts",
				},
				lookback_days: {
					type: "number",
					description: "Lookback window for baseline",
				},
			},
		},
	},
	{
		name: "listmonk_ops_template_registry_sync",
		description: "Sync templates into local template registry",
		inputSchema: {
			type: "object",
			properties: {
				template_ids: {
					type: "array",
					items: { type: "number" },
					description: "Optional template IDs",
				},
				note: { type: "string", description: "Snapshot note" },
			},
		},
	},
	{
		name: "listmonk_ops_template_registry_history",
		description: "Read template version history from local registry",
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string", description: "Template ID" },
			},
			required: ["template_id"],
		},
	},
	{
		name: "listmonk_ops_template_registry_promote",
		description: "Promote a stored template version to active content",
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string", description: "Template ID" },
				version_id: { type: "string", description: "Stored version ID" },
			},
			required: ["template_id", "version_id"],
		},
	},
	{
		name: "listmonk_ops_template_registry_rollback",
		description: "Rollback template to previous stored version",
		inputSchema: {
			type: "object",
			properties: {
				template_id: { type: "string", description: "Template ID" },
			},
			required: ["template_id"],
		},
	},
	{
		name: "listmonk_ops_daily_digest",
		description: "Generate daily operations digest summary",
		inputSchema: {
			type: "object",
			properties: {
				hours: {
					type: "number",
					description: "Digest window in hours",
				},
			},
		},
	},
];

export const handleOpsTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case "listmonk_ops_preflight": {
				const validation = validateRequiredParams(request, ["campaign_id"]);
				if (validation) return createErrorResult(validation);

				const result = await runCampaignPreflight(
					client,
					parseId(args.campaign_id),
					{
						maxAudience: parseNumber(args.max_audience, 200000),
						checkLinks: parseBoolean(args.check_links, false),
					},
				);
				return createSuccessResult(result);
			}

			case "listmonk_ops_deliverability_guard": {
				const validation = validateRequiredParams(request, ["campaign_id"]);
				if (validation) return createErrorResult(validation);

				const result = await evaluateDeliverabilityGuard(
					client,
					parseId(args.campaign_id),
					{
						bounceThreshold: parseNumber(args.bounce_threshold, 0.05),
						openRateThreshold: parseNumber(args.open_threshold, 0.08),
						clickRateThreshold: parseNumber(args.click_threshold, 0.01),
						pauseOnBreach: parseBoolean(args.pause_on_breach, false),
					},
				);
				return createSuccessResult(result);
			}

			case "listmonk_ops_subscriber_hygiene": {
				const mode = String(args.mode || "winback");
				if (mode !== "winback" && mode !== "sunset") {
					return createErrorResult("mode must be winback or sunset");
				}

				const result = await runSubscriberHygiene(client, {
					mode,
					inactivityDays: Math.max(1, parseNumber(args.inactivity_days, 90)),
					sourceListIds: parseOptionalPositiveIntArray(args.source_list_ids),
					targetListId:
						args.target_list_id !== undefined && args.target_list_id !== null
							? parseId(args.target_list_id)
							: undefined,
					blocklist: parseBoolean(args.blocklist, false),
					dryRun: parseBoolean(args.dry_run, true),
					maxSubscribers: Math.max(1, parseNumber(args.max_subscribers, 500)),
				});
				return createSuccessResult(result);
			}

			case "listmonk_ops_segment_drift": {
				const result = await runSegmentDriftSnapshot(client, {
					listIds: parseOptionalPositiveIntArray(args.list_ids),
					threshold: Math.max(0, parseNumber(args.threshold, 0.2)),
					minAbsoluteChange: Math.max(
						0,
						Math.round(parseNumber(args.min_absolute_change, 50)),
					),
					lookbackDays: Math.max(
						1,
						Math.round(parseNumber(args.lookback_days, 14)),
					),
				});
				return createSuccessResult(result);
			}

			case "listmonk_ops_template_registry_sync": {
				const result = await syncTemplateRegistry(client, {
					templateIds: parseOptionalPositiveIntArray(args.template_ids),
					note: args.note ? String(args.note) : undefined,
				});
				return createSuccessResult({
					...result,
					storePaths: getOpsStorePaths(),
				});
			}

			case "listmonk_ops_template_registry_history": {
				const validation = validateRequiredParams(request, ["template_id"]);
				if (validation) return createErrorResult(validation);

				const result = await getTemplateRegistryHistory(
					parseId(args.template_id),
				);
				return createSuccessResult(result);
			}

			case "listmonk_ops_template_registry_promote": {
				const validation = validateRequiredParams(request, [
					"template_id",
					"version_id",
				]);
				if (validation) return createErrorResult(validation);

				const result = await promoteTemplateVersion(
					client,
					parseId(args.template_id),
					String(args.version_id),
				);
				return createSuccessResult(result);
			}

			case "listmonk_ops_template_registry_rollback": {
				const validation = validateRequiredParams(request, ["template_id"]);
				if (validation) return createErrorResult(validation);

				const result = await rollbackTemplateVersion(
					client,
					parseId(args.template_id),
				);
				return createSuccessResult(result);
			}

			case "listmonk_ops_daily_digest": {
				const result = await generateDailyDigest(client, {
					hours: Math.max(1, Math.round(parseNumber(args.hours, 24))),
				});
				return createSuccessResult({
					...result,
					storePaths: getOpsStorePaths(),
				});
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
