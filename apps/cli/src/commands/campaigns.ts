import { OutputUtils } from "@listmonk-ops/common";
import { defineCommand } from "../lib/definition";
import type { CampaignExecutors, CommandContext } from "./types";

export const listMeta = defineCommand({
	name: "list",
	description: "List all campaigns",
	runner: "executor",
});

export async function listRun(executors: CampaignExecutors) {
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
			`Failed to fetch campaigns: ${error instanceof Error ? error.message : String(error)
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

export async function getRun(executors: CampaignExecutors, ctx: CommandContext) {
	try {
		const { id } = ctx.values;
		OutputUtils.info(`📧 Fetching campaign: ${id}`);
		const campaign = await executors.getCampaign(id as string);
		OutputUtils.json(campaign);
	} catch (error) {
		OutputUtils.error(
			`Failed to fetch campaign: ${error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}
