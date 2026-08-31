import { abTestOperations } from "../packages/abtest/src/operations";
import { bouncesTools } from "../packages/mcp/src/handlers/bounces";
import { abtestTools } from "../packages/mcp/src/handlers/abtest";
import { campaignsTools } from "../packages/mcp/src/handlers/campaigns";
import { discoveryTools } from "../packages/mcp/src/handlers/discovery";
import {
	allTools,
	toolRegistrations,
} from "../packages/mcp/src/handlers/index";
import { listsTools } from "../packages/mcp/src/handlers/lists";
import { mediaTools } from "../packages/mcp/src/handlers/media";
import { opsTools } from "../packages/mcp/src/handlers/ops";
import { providerTools } from "../packages/mcp/src/handlers/providers";
import { sequenceTools } from "../packages/mcp/src/handlers/sequences";
import { subscribersTools } from "../packages/mcp/src/handlers/subscribers";
import { templatesTools } from "../packages/mcp/src/handlers/templates";
import { transactionalTools } from "../packages/mcp/src/handlers/transactional";
import { webhookTools } from "../packages/mcp/src/handlers/webhooks";
import { withMcpOperationConfirmationInputSchema } from "../packages/mcp/src/operation-execution";
import { opsOperations } from "../packages/automation/src/ops-operations";
import { providerOperations } from "../packages/automation/src/provider-operations";
import { sequenceOperations } from "../packages/automation/src/sequence-operations";
import { webhookOperations } from "../packages/automation/src/webhook-operations";
import { campaignOperations } from "../packages/operations/src/campaigns";
import { discoveryOperations } from "../packages/operations/src/discovery";
import { listOperations } from "../packages/operations/src/lists";
import { mediaOperations } from "../packages/operations/src/media";
import { bouncesOperations } from "../packages/operations/src/bounces";
import { subscriberOperations } from "../packages/operations/src/subscribers";
import { templateOperations } from "../packages/operations/src/templates";
import { transactionalOperations } from "../packages/operations/src/transactional";
import { userRoleOperations } from "../packages/operations/src/user-roles";
import { userRolesTools } from "../packages/mcp/src/handlers/user-roles";
import type { MCPTool } from "../packages/mcp/src/types/mcp";

export type SharedOperation =
	| (typeof abTestOperations)[number]
	| (typeof bouncesOperations)[number]
	| (typeof campaignOperations)[number]
	| (typeof discoveryOperations)[number]
	| (typeof listOperations)[number]
	| (typeof mediaOperations)[number]
	| (typeof opsOperations)[number]
	| (typeof providerOperations)[number]
	| (typeof sequenceOperations)[number]
	| (typeof subscriberOperations)[number]
	| (typeof templateOperations)[number]
	| (typeof transactionalOperations)[number]
	| (typeof userRoleOperations)[number]
	| (typeof webhookOperations)[number];

const safetyKeys = [
	"readOnlyHint",
	"destructiveHint",
	"idempotentHint",
	"openWorldHint",
] as const;
const serverTools: readonly MCPTool[] = toolRegistrations.flatMap(
	(registration) => registration.tools,
);

function assertToolMatchesOperation(
	operation: SharedOperation,
	tool: MCPTool,
	registry: string,
): void {
	if (tool.title !== operation.title || tool.description !== operation.description) {
		throw new Error(
			`${operation.mcp.name} ${registry} does not preserve MCP metadata`,
		);
	}
	if (
		JSON.stringify(tool.inputSchema) !==
			JSON.stringify(
				withMcpOperationConfirmationInputSchema(
					operation.inputJsonSchema,
					operation.safety,
				),
			) ||
		JSON.stringify(tool.outputSchema) !==
			JSON.stringify(operation.outputJsonSchema)
	) {
		throw new Error(
			`${operation.mcp.name} ${registry} does not preserve MCP schemas`,
		);
	}
	for (const key of safetyKeys) {
		if (tool.annotations?.[key] !== operation.safety[key]) {
			throw new Error(
				`${operation.mcp.name} ${registry} does not preserve ${key}`,
			);
		}
	}
}

function assertRegistryToolMatchesOperation(
	operation: SharedOperation,
	tools: readonly MCPTool[],
	registry: string,
): void {
	const [tool, ...extraTools] = tools.filter(
		(candidate) => candidate.name === operation.mcp.name,
	);
	if (!tool || extraTools.length > 0) {
		throw new Error(
			`${operation.mcp.name} must have exactly one ${registry}, found ${extraTools.length + (tool ? 1 : 0)}`,
		);
	}

	assertToolMatchesOperation(operation, tool, registry);
}

export function assertOperationFamilyPublished(
	family: string,
	operations: readonly SharedOperation[],
	tools: readonly MCPTool[],
	globalTools: readonly MCPTool[] = allTools,
	registeredServerTools: readonly MCPTool[] = serverTools,
): void {
	const expectedNames = operations.map((operation) => operation.mcp.name);
	const expectedNameSet = new Set(expectedNames);
	const publishedOperations = tools.filter((tool) =>
		expectedNameSet.has(tool.name),
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
		if (!tool) {
			throw new Error(`${operation.mcp.name} has no family tool`);
		}
		assertToolMatchesOperation(operation, tool, "family tool");
		assertRegistryToolMatchesOperation(operation, globalTools, "global tool");
		assertRegistryToolMatchesOperation(
			operation,
			registeredServerTools,
			"server tool",
		);
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

export function assertMediaOperationsPublished(): void {
	assertOperationFamilyPublished("media", mediaOperations, mediaTools);
}

export function assertBouncesOperationsPublished(): void {
	assertOperationFamilyPublished("bounces", bouncesOperations, bouncesTools);
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

export function assertDiscoveryOperationsPublished(): void {
	assertOperationFamilyPublished(
		"agent discovery and readiness",
		discoveryOperations,
		discoveryTools,
	);
}

export function assertWebhookOperationsPublished(): void {
	assertOperationFamilyPublished(
		"outbound webhooks",
		webhookOperations,
		webhookTools,
	);
}

export function assertSequenceOperationsPublished(): void {
	assertOperationFamilyPublished(
		"sequences",
		sequenceOperations,
		sequenceTools,
	);
}

export function assertProviderOperationsPublished(): void {
	assertOperationFamilyPublished(
		"provider and deliverability diagnostics",
		providerOperations,
		providerTools,
	);
}

export function assertUserRoleOperationsPublished(): void {
	assertOperationFamilyPublished(
		"user roles",
		userRoleOperations,
		userRolesTools,
	);
}
