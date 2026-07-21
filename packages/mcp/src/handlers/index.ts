import type { MCPTool } from "../types/mcp.js";
import type { HandlerFunction } from "../types/shared.js";
import { abtestTools, handleAbTestTools } from "./abtest.js";
import { bouncesTools, handleBouncesTools } from "./bounces.js";
import { campaignsTools, handleCampaignsTools } from "./campaigns.js";
import { handleListsTools, listsTools } from "./lists.js";
import { handleMediaTools, mediaTools } from "./media.js";
import { handleOpsTools, opsTools } from "./ops.js";
import { handleSettingsTools, settingsTools } from "./settings.js";
import { handleSubscribersTools, subscribersTools } from "./subscribers.js";
import { handleTemplatesTools, templatesTools } from "./templates.js";
import {
	handleTransactionalTools,
	transactionalTools,
} from "./transactional.js";

export * from "./abtest.js";
export * from "./bounces.js";
export * from "./campaigns.js";
export * from "./lists.js";
export * from "./media.js";
export * from "./ops.js";
export * from "./settings.js";
export * from "./subscribers.js";
export * from "./templates.js";
export * from "./transactional.js";

export const allTools: readonly MCPTool[] = [
	...listsTools,
	...subscribersTools,
	...campaignsTools,
	...templatesTools,
	...mediaTools,
	...opsTools,
	...bouncesTools,
	...settingsTools,
	...transactionalTools,
	...abtestTools,
];

function createToolNameSet(tools: readonly MCPTool[]): ReadonlySet<string> {
	return new Set(tools.map((tool) => tool.name));
}

export const toolNameSets = {
	abtest: createToolNameSet(abtestTools),
	bounces: createToolNameSet(bouncesTools),
	campaigns: createToolNameSet(campaignsTools),
	lists: createToolNameSet(listsTools),
	media: createToolNameSet(mediaTools),
	ops: createToolNameSet(opsTools),
	settings: createToolNameSet(settingsTools),
	subscribers: createToolNameSet(subscribersTools),
	templates: createToolNameSet(templatesTools),
	transactional: createToolNameSet(transactionalTools),
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
	{ tools: mediaTools, handler: handleMediaTools },
	{ tools: opsTools, handler: handleOpsTools },
	{ tools: bouncesTools, handler: handleBouncesTools },
	{ tools: settingsTools, handler: handleSettingsTools },
	{ tools: transactionalTools, handler: handleTransactionalTools },
	{ tools: abtestTools, handler: handleAbTestTools },
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
