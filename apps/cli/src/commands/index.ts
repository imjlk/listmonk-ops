// Import command metadata only
import * as abtest from "./abtest";
import * as campaigns from "./campaigns";
import * as examples from "./examples";
import * as lists from "./lists";
import * as status from "./status";

// Re-export types for convenience
export type { CommandContext, CommandExecutors } from "./campaigns";
export type { StatusCommandConfig } from "./status";

// Standalone commands that are at the top level
export const standaloneCommands = [status.meta, examples.meta];

// Grouped commands for better CLI structure (e.g., `listmonk-cli campaigns list`)
export const commandGroups = [
	{
		name: "campaigns",
		description: "Manage campaigns",
		subCommands: [campaigns.listMeta, campaigns.getMeta],
	},
	{
		name: "lists",
		description: "Manage subscriber lists",
		subCommands: [lists.listMeta, lists.getMeta],
	},
	{
		name: "abtest",
		description: "Manage A/B tests",
		subCommands: [abtest.createMeta, abtest.analyzeMeta],
	},
];
