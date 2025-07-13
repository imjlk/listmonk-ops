#!/usr/bin/env bun

import { AbTestService } from "@listmonk-ops/abtest";
import {
	createAbTestExecutors,
	createCampaignExecutors,
	createListExecutors,
} from "@listmonk-ops/commands";
import { OutputUtils } from "@listmonk-ops/common";
import { cli } from "gunshi";
import { lazy } from "gunshi/definition";

import {
	type AbTestExecutors,
	type CampaignExecutors,
	type CommandExecutors,
	commandGroups,
	type ListExecutors,
	type StatusCommandConfig,
	standaloneCommands,
} from "./commands";
import { initializeListmonkClient } from "./lib/listmonk";

// Initialize services and dependencies
const listmonkClient = initializeListmonkClient();
const abTestService = new AbTestService();

// Create domain-specific command executors
const abTestExecutors = createAbTestExecutors(abTestService);
const campaignExecutors = createCampaignExecutors(listmonkClient);
const listExecutors = createListExecutors(listmonkClient);

// Combine all executors for backward compatibility with existing command structure
const executors: CommandExecutors = {
	...abTestExecutors,
	...campaignExecutors,
	...listExecutors,
};

// Status command configuration
const statusConfig: StatusCommandConfig = {
	listmonkUrl: Bun.env.LISTMONK_API_URL || "http://localhost:9000/api",
	apiToken: Bun.env.LISTMONK_API_TOKEN,
	listmonkClient,
};

// --- Generic Command Loader ---
const subCommands = new Map();

// Register standalone commands
for (const meta of standaloneCommands) {
	const loader = async () => {
		const module = await import(`./commands/${meta.name}`);
		const runFn = module.run;

		if (meta.runner === "config") {
			return () => runFn(statusConfig);
		}
		// simple runner
		return () => runFn();
	};
	const { runner, ...metaWithoutRunner } = meta;
	subCommands.set(meta.name, lazy(loader, metaWithoutRunner));
}

// Register grouped commands - flatten to top level with compound names
for (const group of commandGroups) {
	// Add each subcommand with compound name (e.g., "campaigns:list", "campaigns:get")
	for (const meta of group.subCommands) {
		const compoundName = `${group.name}:${meta.name}`;

		const loader = async () => {
			const module = await import(`./commands/${group.name}`);
			const runFnName = `${meta.name}Run`;
			const runFn = module[runFnName];

			// Choose the appropriate executor based on the command group
			let domainExecutor:
				| AbTestExecutors
				| CampaignExecutors
				| ListExecutors
				| CommandExecutors;
			switch (group.name) {
				case "abtest":
					domainExecutor = abTestExecutors;
					break;
				case "campaigns":
					domainExecutor = campaignExecutors;
					break;
				case "lists":
					domainExecutor = listExecutors;
					break;
				default:
					domainExecutor = executors; // fallback to combined executors
			}

			if (meta.args) {
				return (ctx: { values: Record<string, unknown> }) =>
					runFn(domainExecutor, ctx);
			}
			return () => runFn(domainExecutor);
		};

		// Remove runner property for gunshi compatibility
		const { runner, ...metaWithoutRunner } = meta;
		subCommands.set(
			compoundName,
			lazy(loader, {
				...metaWithoutRunner,
				name: compoundName,
				description: `${group.description} - ${meta.description}`,
			}),
		);
	}

	// Add group command that shows available subcommands
	subCommands.set(
		group.name,
		lazy(
			async () => {
				return () => {
					OutputUtils.info(`📋 ${group.description}`);
					OutputUtils.info("");
					OutputUtils.info("Available subcommands:");
					for (const meta of group.subCommands) {
						const compoundName = `${group.name}:${meta.name}`;
						OutputUtils.info(
							`  • ${compoundName.padEnd(18)} - ${meta.description || "No description"}`,
						);
					}
					OutputUtils.info("");
					OutputUtils.info(`Use \`[subcommand] --help\` for more information.`);
				};
			},
			{
				name: group.name,
				description: group.description,
			},
		),
	);
}

// --- Main CLI Definition ---
const mainCommand = {
	name: "listmonk-cli",
	description: "CLI for Listmonk email marketing operations powered by Bun",
	examples: `# Check system status
listmonk-cli status

# List campaigns
listmonk-cli campaigns:list

# Get campaign details
listmonk-cli campaigns:get --id 123

# Create A/B test
listmonk-cli abtest:create --name "Test" --campaign-id "123" --variants '[{"name":"Control"},{"name":"Variant B"}]'

# Show all examples
listmonk-cli examples`,
	run: async () => {
		OutputUtils.info("🏯 Listmonk CLI v0.1.0");
		OutputUtils.info("");
		OutputUtils.info("Available commands:");
		for (const cmd of standaloneCommands) {
			OutputUtils.info(`  • ${cmd.name.padEnd(10)} - ${cmd.description}`);
		}
		for (const group of commandGroups) {
			OutputUtils.info(`  • ${group.name.padEnd(10)} - ${group.description}`);
		}
		OutputUtils.info("");
		OutputUtils.info(
			"Use `[command] --help` for more information on a specific command.",
		);
	},
};

// Run the CLI
await cli(process.argv.slice(2), mainCommand, {
	name: "listmonk-cli",
	version: "0.1.0",
	description: "CLI for Listmonk email marketing operations",
	subCommands,
});
