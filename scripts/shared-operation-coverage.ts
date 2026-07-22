import { abTestOperations } from "../packages/abtest/src/operations";
import { abtestTools } from "../packages/mcp/src/handlers/abtest";
import { campaignsTools } from "../packages/mcp/src/handlers/campaigns";
import { allTools } from "../packages/mcp/src/handlers/index";
import { listsTools } from "../packages/mcp/src/handlers/lists";
import { opsTools } from "../packages/mcp/src/handlers/ops";
import { subscribersTools } from "../packages/mcp/src/handlers/subscribers";
import { templatesTools } from "../packages/mcp/src/handlers/templates";
import { transactionalTools } from "../packages/mcp/src/handlers/transactional";
import { opsOperations } from "../packages/automation/src/ops-operations";
import { campaignOperations } from "../packages/operations/src/campaigns";
import { listOperations } from "../packages/operations/src/lists";
import { subscriberOperations } from "../packages/operations/src/subscribers";
import { templateOperations } from "../packages/operations/src/templates";
import { transactionalOperations } from "../packages/operations/src/transactional";
import type { MCPTool } from "../packages/mcp/src/types/mcp";

type SharedOperation =
	| (typeof abTestOperations)[number]
	| (typeof campaignOperations)[number]
	| (typeof listOperations)[number]
	| (typeof opsOperations)[number]
	| (typeof subscriberOperations)[number]
	| (typeof templateOperations)[number]
	| (typeof transactionalOperations)[number];

const safetyKeys = [
	"readOnlyHint",
	"destructiveHint",
	"idempotentHint",
	"openWorldHint",
] as const;
const allToolNames = new Set(allTools.map((tool) => tool.name));

function assertOperationFamilyPublished(
	family: string,
	operations: readonly SharedOperation[],
	tools: readonly MCPTool[],
): void {
	const expectedNames = operations.map((operation) => operation.mcp.name);
	const expectedNameSet = new Set(expectedNames);
	const publishedOperations = tools.filter(
		(tool) => expectedNameSet.has(tool.name),
	);

	if (expectedNames.length === 0) {
		throw new Error(`${family} has no registered shared operations`);
	}
	if (new Set(expectedNames).size !== expectedNames.length) {
		throw new Error(`${family} contains duplicate shared operation names`);
	}
	if (
		publishedOperations.length !== expectedNames.length ||
		publishedOperations.some(
			(tool, index) => tool.name !== expectedNames[index],
		)
	) {
		throw new Error(`${family} does not publish every shared operation once`);
	}

	for (const operation of operations) {
		const tool = tools.find(
			(candidate) => candidate.name === operation.mcp.name,
		);
		if (!allToolNames.has(operation.mcp.name)) {
			throw new Error(`${operation.mcp.name} is not registered globally`);
		}
		if (!tool) {
			throw new Error(`${operation.mcp.name} has no family tool`);
		}
		if (tool.title !== operation.title || tool.description !== operation.description) {
			throw new Error(`${operation.mcp.name} does not preserve MCP metadata`);
		}
		if (
			JSON.stringify(tool.inputSchema) !==
				JSON.stringify(operation.inputJsonSchema) ||
			JSON.stringify(tool.outputSchema) !==
				JSON.stringify(operation.outputJsonSchema)
		) {
			throw new Error(`${operation.mcp.name} does not preserve MCP schemas`);
		}
		for (const key of safetyKeys) {
			if (tool.annotations?.[key] !== operation.safety[key]) {
				throw new Error(`${operation.mcp.name} does not preserve ${key}`);
			}
		}
	}
}

export function assertListOperationsPublished(): void {
	assertOperationFamilyPublished(
		"subscriber lists",
		listOperations,
		listsTools,
	);
}

export function assertCampaignOperationsPublished(): void {
	assertOperationFamilyPublished(
		"campaigns",
		campaignOperations,
		campaignsTools,
	);
}

export function assertSubscriberOperationsPublished(): void {
	assertOperationFamilyPublished(
		"subscribers",
		subscriberOperations,
		subscribersTools,
	);
}

export function assertTemplateOperationsPublished(): void {
	assertOperationFamilyPublished(
		"templates",
		templateOperations,
		templatesTools,
	);
}

export function assertTransactionalOperationsPublished(): void {
	assertOperationFamilyPublished(
		"transactional mail",
		transactionalOperations,
		transactionalTools,
	);
}

export function assertOpsOperationsPublished(): void {
	assertOperationFamilyPublished(
		"operations workflows",
		opsOperations,
		opsTools,
	);
}

export function assertAbTestOperationsPublished(): void {
	assertOperationFamilyPublished("A/B tests", abTestOperations, abtestTools);
}
