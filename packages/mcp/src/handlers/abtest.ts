import {
	AbTestNotFoundError,
	type CreateAbTestInput,
	createAbTestExecutors,
	withStoredAbTestExecutors,
} from "@listmonk-ops/abtest";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import type { CallToolRequest, CallToolResult, MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import {
	createErrorResult,
	createSuccessResult,
	validateRequiredParams,
} from "../utils/response.js";
import { withErrorHandler } from "../utils/typeHelpers.js";

const ABTEST_STATUSES = [
	"draft",
	"testing",
	"running",
	"analyzing",
	"deploying",
	"completed",
	"cancelled",
] as const;

type AbTestStatus = (typeof ABTEST_STATUSES)[number];

export const abtestTools: MCPTool[] = [
	{
		name: "listmonk_abtest_list",
		description: "List persisted A/B tests",
		inputSchema: {
			type: "object",
			properties: {
				status: {
					type: "string",
					enum: [...ABTEST_STATUSES],
					description: "Filter by test status",
				},
			},
		},
	},
	{
		name: "listmonk_abtest_get",
		description: "Get A/B test details",
		inputSchema: {
			type: "object",
			properties: {
				test_id: {
					type: "string",
					description: "A/B test ID",
				},
			},
			required: ["test_id"],
		},
	},
	{
		name: "listmonk_abtest_create",
		description:
			"Create an A/B test and persist it for follow-up launch/analyze/stop",
		inputSchema: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "A/B test name",
				},
				campaign_id: {
					type: "string",
					description: "Base campaign ID",
				},
				lists: {
					type: "array",
					items: { type: "number" },
					description: "Target list IDs",
				},
				variants: {
					type: "array",
					description:
						'Variants in the format: [{"name":"A","percentage":50,"campaign_config":{"subject":"...","body":"..."}}]',
					items: {
						type: "object",
						properties: {
							name: { type: "string" },
							percentage: { type: "number" },
							campaign_config: {
								type: "object",
								properties: {
									subject: { type: "string" },
									body: { type: "string" },
									template_id: { type: "number" },
								},
							},
						},
					},
				},
				testing_mode: {
					type: "string",
					enum: ["holdout", "full-split"],
					description: "Testing mode",
				},
				test_group_percentage: {
					type: "number",
					description: "Test group percentage (1-100)",
				},
				confidence_threshold: {
					type: "number",
					description: "Statistical confidence threshold (default 0.95)",
				},
				auto_deploy_winner: {
					type: "boolean",
					description: "Auto deploy winner for holdout tests",
				},
				ignore_sample_size_warnings: {
					type: "boolean",
					description: "Ignore sample size warnings",
				},
			},
			required: ["name", "lists", "variants"],
		},
	},
	{
		name: "listmonk_abtest_analyze",
		description: "Analyze A/B test statistical results",
		inputSchema: {
			type: "object",
			properties: {
				test_id: {
					type: "string",
					description: "A/B test ID",
				},
			},
			required: ["test_id"],
		},
	},
	{
		name: "listmonk_abtest_launch",
		description: "Launch a draft A/B test",
		inputSchema: {
			type: "object",
			properties: {
				test_id: {
					type: "string",
					description: "A/B test ID",
				},
			},
			required: ["test_id"],
		},
	},
	{
		name: "listmonk_abtest_stop",
		description: "Stop a running A/B test",
		inputSchema: {
			type: "object",
			properties: {
				test_id: {
					type: "string",
					description: "A/B test ID",
				},
			},
			required: ["test_id"],
		},
	},
	{
		name: "listmonk_abtest_delete",
		description: "Delete an A/B test from persisted store",
		inputSchema: {
			type: "object",
			properties: {
				test_id: {
					type: "string",
					description: "A/B test ID",
				},
			},
			required: ["test_id"],
		},
	},
	{
		name: "listmonk_abtest_recommend_sample_size",
		description:
			"Get statistical recommendation for test-group percentage and sample size",
		inputSchema: {
			type: "object",
			properties: {
				lists: {
					type: "array",
					items: { type: "number" },
					description: "Target list IDs",
				},
				test_group_percentage: {
					type: "number",
					description: "Planned test-group percentage",
				},
				variant_count: {
					type: "number",
					description: "Variant count (2-3)",
					default: 2,
				},
			},
			required: ["lists", "test_group_percentage"],
		},
	},
	{
		name: "listmonk_abtest_deploy_winner",
		description: "Deploy statistically significant winner to holdout audience",
		inputSchema: {
			type: "object",
			properties: {
				test_id: {
					type: "string",
					description: "A/B test ID",
				},
			},
			required: ["test_id"],
		},
	},
];

function getTestId(args: Record<string, unknown>): string {
	const value = args.test_id;
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("test_id must be a non-empty string");
	}
	return value.trim();
}

function parseOptionalBoolean(
	value: unknown,
	fieldName: string,
): boolean | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		if (value === "true") {
			return true;
		}
		if (value === "false") {
			return false;
		}
	}
	throw new Error(`${fieldName} must be a boolean`);
}

function parseOptionalNumber(
	value: unknown,
	fieldName: string,
): number | undefined {
	if (value === undefined || value === null || value === "") {
		return undefined;
	}
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) {
		throw new Error(`${fieldName} must be a number`);
	}
	return parsed;
}

function parseIntegerArray(value: unknown, fieldName: string): number[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new Error(`${fieldName} must be a non-empty array`);
	}

	return value.map((entry, index) => {
		const parsed = typeof entry === "number" ? entry : Number(entry);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			throw new Error(`${fieldName}[${index}] must be a positive integer`);
		}
		return parsed;
	});
}

function parseVariants(value: unknown): CreateAbTestInput["variants"] {
	if (!Array.isArray(value) || value.length < 2 || value.length > 3) {
		throw new Error("variants must be an array with 2-3 entries");
	}

	return value.map((variantValue, index) => {
		if (
			typeof variantValue !== "object" ||
			variantValue === null ||
			Array.isArray(variantValue)
		) {
			throw new Error(`variants[${index}] must be an object`);
		}

		const variant = variantValue as Record<string, unknown>;
		const name = variant.name;
		if (typeof name !== "string" || name.trim().length === 0) {
			throw new Error(`variants[${index}].name must be a non-empty string`);
		}

		const percentageRaw = variant.percentage;
		const percentage =
			typeof percentageRaw === "number" ? percentageRaw : Number(percentageRaw);
		if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
			throw new Error(
				`variants[${index}].percentage must be between 0 and 100`,
			);
		}

		const campaignConfigRaw = variant.campaign_config;
		const campaignConfig =
			typeof campaignConfigRaw === "object" &&
			campaignConfigRaw !== null &&
			!Array.isArray(campaignConfigRaw)
				? (campaignConfigRaw as Record<string, unknown>)
				: {};

		const subject =
			typeof campaignConfig.subject === "string"
				? campaignConfig.subject
				: undefined;
		const body =
			typeof campaignConfig.body === "string" ? campaignConfig.body : undefined;
		const templateIdRaw = campaignConfig.template_id;
		const templateId =
			templateIdRaw === undefined || templateIdRaw === null
				? undefined
				: Number(templateIdRaw);
		if (
			templateId !== undefined &&
			(!Number.isInteger(templateId) || templateId <= 0)
		) {
			throw new Error(
				`variants[${index}].campaign_config.template_id must be a positive integer`,
			);
		}

		return {
			name: name.trim(),
			percentage,
			campaign_config: {
				subject,
				body,
				template_id: templateId,
			},
		};
	});
}

function parseCreateInput(args: Record<string, unknown>): CreateAbTestInput {
	const name = args.name;
	if (typeof name !== "string" || name.trim().length === 0) {
		throw new Error("name must be a non-empty string");
	}

	const campaignIdValue = args.campaign_id;
	if (
		campaignIdValue !== undefined &&
		campaignIdValue !== null &&
		typeof campaignIdValue !== "string" &&
		typeof campaignIdValue !== "number"
	) {
		throw new Error("campaign_id must be a string or number");
	}

	const testingMode = args.testing_mode;
	if (
		testingMode !== undefined &&
		testingMode !== "holdout" &&
		testingMode !== "full-split"
	) {
		throw new Error("testing_mode must be holdout or full-split");
	}

	const testGroupPercentage = parseOptionalNumber(
		args.test_group_percentage,
		"test_group_percentage",
	);
	if (
		testGroupPercentage !== undefined &&
		(testGroupPercentage <= 0 || testGroupPercentage > 100)
	) {
		throw new Error("test_group_percentage must be between 1 and 100");
	}

	const confidenceThreshold = parseOptionalNumber(
		args.confidence_threshold,
		"confidence_threshold",
	);
	if (
		confidenceThreshold !== undefined &&
		(confidenceThreshold <= 0 || confidenceThreshold >= 1)
	) {
		throw new Error("confidence_threshold must be between 0 and 1");
	}

	const durationHours = parseOptionalNumber(
		args.duration_hours,
		"duration_hours",
	);
	if (durationHours !== undefined && durationHours <= 0) {
		throw new Error("duration_hours must be a positive number");
	}

	return {
		name: name.trim(),
		campaign_id:
			campaignIdValue === undefined || campaignIdValue === null
				? undefined
				: String(campaignIdValue),
		lists: parseIntegerArray(args.lists, "lists"),
		variants: parseVariants(args.variants),
		testing_mode: testingMode as CreateAbTestInput["testing_mode"] | undefined,
		test_group_percentage: testGroupPercentage,
		confidence_threshold: confidenceThreshold,
		duration_hours: durationHours,
		auto_deploy_winner: parseOptionalBoolean(
			args.auto_deploy_winner,
			"auto_deploy_winner",
		),
		ignore_sample_size_warnings: parseOptionalBoolean(
			args.ignore_sample_size_warnings,
			"ignore_sample_size_warnings",
		),
	};
}

function parseStatus(args: Record<string, unknown>): AbTestStatus | undefined {
	if (args.status === undefined || args.status === null) {
		return undefined;
	}
	if (typeof args.status !== "string") {
		throw new Error("status must be a string");
	}

	if (
		!ABTEST_STATUSES.includes(args.status as (typeof ABTEST_STATUSES)[number])
	) {
		throw new Error(`status must be one of: ${ABTEST_STATUSES.join(", ")}`);
	}

	return args.status as AbTestStatus;
}

export const handleAbTestTools: HandlerFunction = withErrorHandler(
	async (
		request: CallToolRequest,
		client: ListmonkClient,
	): Promise<CallToolResult> => {
		const { name, arguments: args = {} } = request.params;

		switch (name) {
			case "listmonk_abtest_list": {
				const status = parseStatus(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "read" },
					async (executors) => {
						const tests = await executors.listAbTests();
						const filteredTests = status
							? tests.filter((test) => test.status === status)
							: tests;
						return createSuccessResult(filteredTests);
					},
				);
			}

			case "listmonk_abtest_get": {
				const validation = validateRequiredParams(request, ["test_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const testId = getTestId(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "read" },
					async (executors) =>
						createSuccessResult(await executors.getAbTest(testId)),
				);
			}

			case "listmonk_abtest_create": {
				const validation = validateRequiredParams(request, [
					"name",
					"lists",
					"variants",
				]);
				if (validation) {
					return createErrorResult(validation);
				}

				const input = parseCreateInput(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "write" },
					async (executors) =>
						createSuccessResult(await executors.createAbTest(input)),
				);
			}

			case "listmonk_abtest_analyze": {
				const validation = validateRequiredParams(request, ["test_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const testId = getTestId(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "read" },
					async (executors) =>
						createSuccessResult(
							await executors.analyzeAbTest({
								test_id: testId,
								include_recommendations: true,
							}),
						),
				);
			}

			case "listmonk_abtest_launch": {
				const validation = validateRequiredParams(request, ["test_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const testId = getTestId(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "write" },
					async (executors) =>
						createSuccessResult(await executors.launchAbTest(testId)),
				);
			}

			case "listmonk_abtest_stop": {
				const validation = validateRequiredParams(request, ["test_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const testId = getTestId(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "write" },
					async (executors) =>
						createSuccessResult(await executors.stopAbTest(testId)),
				);
			}

			case "listmonk_abtest_delete": {
				const validation = validateRequiredParams(request, ["test_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const testId = getTestId(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "write" },
					async (executors) => {
						const deleted = await executors.deleteAbTest(testId);
						if (!deleted) {
							throw new AbTestNotFoundError(testId);
						}
						return createSuccessResult({ deleted: true });
					},
				);
			}

			case "listmonk_abtest_recommend_sample_size": {
				const validation = validateRequiredParams(request, [
					"lists",
					"test_group_percentage",
				]);
				if (validation) {
					return createErrorResult(validation);
				}

				const lists = parseIntegerArray(args.lists, "lists");
				const testGroupPercentage = parseOptionalNumber(
					args.test_group_percentage,
					"test_group_percentage",
				);
				if (
					testGroupPercentage === undefined ||
					testGroupPercentage <= 0 ||
					testGroupPercentage > 100
				) {
					return createErrorResult(
						"test_group_percentage must be a number between 1 and 100",
					);
				}

				const variantCount = parseOptionalNumber(
					args.variant_count,
					"variant_count",
				);
				if (
					variantCount !== undefined &&
					(!Number.isInteger(variantCount) ||
						variantCount < 2 ||
						variantCount > 3)
				) {
					return createErrorResult("variant_count must be 2 or 3");
				}

				// Sample-size advice only queries remote subscriber counts and does
				// not need the persisted A/B lifecycle state.
				const executors = createAbTestExecutors(client);
				const recommendation = await executors.getSampleSizeRecommendation(
					lists,
					testGroupPercentage,
					variantCount ?? 2,
				);
				return createSuccessResult(recommendation);
			}

			case "listmonk_abtest_deploy_winner": {
				const validation = validateRequiredParams(request, ["test_id"]);
				if (validation) {
					return createErrorResult(validation);
				}

				const testId = getTestId(args);
				return withStoredAbTestExecutors(
					client,
					{ mode: "write" },
					async (executors) => {
						await executors.deployWinner(testId);
						return createSuccessResult({ deployed: true });
					},
				);
			}

			default:
				return createErrorResult(`Unknown tool: ${name}`);
		}
	},
);
