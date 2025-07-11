import type { AbTest, AbTestConfig, TestAnalysis } from "@listmonk-ops/abtest";
import { OutputUtils } from "@listmonk-ops/common";
import type { Campaign, List } from "@listmonk-ops/openapi";
import { defineCommand } from "../lib/definition";

// Command executors interface that matches createCommandExecutors return type
export interface CommandExecutors {
	listCampaigns(): Promise<Campaign[]>;
	getCampaign(id: string): Promise<Campaign>;
	listSubscriberLists(): Promise<List[]>;
	getSubscriberList(id: string): Promise<List>;
	createAbTest(config: AbTestConfig): Promise<AbTest>;
	analyzeAbTest(testId: string): Promise<TestAnalysis>;
}

export interface CommandContext {
	values: Record<string, unknown>;
}

export const listMeta = defineCommand({
	name: "list",
	description: "List all campaigns",
	runner: "executor",
});

export async function listRun(executors: CommandExecutors) {
	try {
		OutputUtils.info("📧 Fetching campaigns...");
		const campaigns = await executors.listCampaigns();
		if (campaigns.length > 0) {
			OutputUtils.table(campaigns as Record<string, unknown>[]);
		} else {
			OutputUtils.info("No campaigns found");
		}
	} catch (error) {
		OutputUtils.error(
			`Failed to fetch campaigns: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}

export const getMeta = defineCommand({
	name: "get",
	description: "Get campaign details by ID",
	args: {
		id: {
			type: "string",
			description: "Campaign ID",
			required: true,
		},
	},
	runner: "executor",
});

export async function getRun(executors: CommandExecutors, ctx: CommandContext) {
	try {
		const { id } = ctx.values;
		OutputUtils.info(`📧 Fetching campaign: ${id}`);
		const campaign = await executors.getCampaign(id as string);
		OutputUtils.json(campaign);
	} catch (error) {
		OutputUtils.error(
			`Failed to fetch campaign: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}
