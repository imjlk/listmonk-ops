import type { MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { abtestTools, handleAbTestTools } from "./abtest.js";
import { bouncesTools, handleBouncesTools } from "./bounces.js";
import { campaignsTools, handleCampaignsTools } from "./campaigns.js";
import { dashboardTools, handleDashboardTools } from "./dashboard.js";
import { systemTools, handleSystemTools } from "./system.js";
import {
	handleOperationCatalogTools,
	operationCatalogTools,
} from "./catalog.js";
import { discoveryTools, handleDiscoveryTools } from "./discovery.js";
import { handleListsTools, listsTools } from "./lists.js";
import { handleMediaTools, mediaTools } from "./media.js";
import { handleOpsTools, opsTools } from "./ops.js";
import { handleProviderTools, providerTools } from "./providers.js";
import { handleSettingsTools, settingsTools } from "./settings.js";
import { handleSequenceTools, sequenceTools } from "./sequences.js";
import { handleSubscribersTools, subscribersTools } from "./subscribers.js";
import { handleTemplatesTools, templatesTools } from "./templates.js";
import {
	handleTransactionalTools,
	transactionalTools,
} from "./transactional.js";
import { handleUserRolesTools, userRolesTools } from "./user-roles.js";
import { handleWebhookTools, webhookTools } from "./webhooks.js";

export * from "./abtest.js";
export * from "./bounces.js";
export * from "./campaigns.js";
export * from "./dashboard.js";
export * from "./system.js";
export * from "./catalog.js";
export * from "./discovery.js";
export * from "./lists.js";
export * from "./media.js";
export * from "./ops.js";
export * from "./providers.js";
export * from "./settings.js";
export * from "./sequences.js";
export * from "./subscribers.js";
export * from "./templates.js";
export * from "./transactional.js";
export * from "./user-roles.js";
export * from "./webhooks.js";

export const allTools: readonly MCPTool[] = [
	...listsTools,
	...subscribersTools,
	...campaignsTools,
	...templatesTools,
	...operationCatalogTools,
	...discoveryTools,
	...mediaTools,
	...dashboardTools,
	...systemTools,
	...opsTools,
	...providerTools,
	...bouncesTools,
	...settingsTools,
	...sequenceTools,
	...transactionalTools,
	...abtestTools,
	...webhookTools,
	...userRolesTools,
];

function createToolNameSet(tools: readonly MCPTool[]): ReadonlySet<string> {
	return new Set(tools.map((tool) => tool.name));
}

export const toolNameSets = {
	abtest: createToolNameSet(abtestTools),
	bounces: createToolNameSet(bouncesTools),
	campaigns: createToolNameSet(campaignsTools),
	catalog: createToolNameSet(operationCatalogTools),
	discovery: createToolNameSet(discoveryTools),
	lists: createToolNameSet(listsTools),
	media: createToolNameSet(mediaTools),
	dashboard: createToolNameSet(dashboardTools),
	system: createToolNameSet(systemTools),
	ops: createToolNameSet(opsTools),
	providers: createToolNameSet(providerTools),
	settings: createToolNameSet(settingsTools),
	sequences: createToolNameSet(sequenceTools),
	subscribers: createToolNameSet(subscribersTools),
	templates: createToolNameSet(templatesTools),
	transactional: createToolNameSet(transactionalTools),
	userRoles: createToolNameSet(userRolesTools),
	webhooks: createToolNameSet(webhookTools),
} as const;

export type ToolRegistration = {
	tools: readonly MCPTool[];
	handler: HandlerFunction;
};

export const toolRegistrations: readonly ToolRegistration[] = [
	{ tools: listsTools, handler: handleListsTools },
	{ tools: subscribersTools, handler: handleSubscribersTools },
	{ tools: campaignsTools, handler: handleCampaignsTools },
	{ tools: templatesTools, handler: handleTemplatesTools },
	{ tools: operationCatalogTools, handler: handleOperationCatalogTools },
	{ tools: discoveryTools, handler: handleDiscoveryTools },
	{ tools: mediaTools, handler: handleMediaTools },
	{ tools: dashboardTools, handler: handleDashboardTools },
	{ tools: systemTools, handler: handleSystemTools },
	{ tools: opsTools, handler: handleOpsTools },
	{ tools: providerTools, handler: handleProviderTools },
	{ tools: bouncesTools, handler: handleBouncesTools },
	{ tools: settingsTools, handler: handleSettingsTools },
	{ tools: sequenceTools, handler: handleSequenceTools },
	{ tools: transactionalTools, handler: handleTransactionalTools },
	{ tools: abtestTools, handler: handleAbTestTools },
	{ tools: webhookTools, handler: handleWebhookTools },
	{ tools: userRolesTools, handler: handleUserRolesTools },
];

export function assertUniqueToolNames(
	tools: readonly MCPTool[] = allTools,
): void {
	const seen = new Set<string>();
	const duplicates = new Set<string>();

	for (const tool of tools) {
		if (seen.has(tool.name)) {
			duplicates.add(tool.name);
		}
		seen.add(tool.name);
	}

	if (duplicates.size > 0) {
		throw new Error(
			`Duplicate MCP tool names: ${[...duplicates].sort().join(", ")}`,
		);
	}
}
