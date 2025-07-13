import { OutputUtils } from "@listmonk-ops/common";
import { defineCommand } from "../lib/definition";
import type { CommandContext, ListExecutors } from "./types";

export const listMeta = defineCommand({
	name: "list",
	description: "List all subscriber lists",
	runner: "executor",
});

export async function listRun(executors: ListExecutors) {
	try {
		OutputUtils.info("📝 Fetching lists...");

		const lists = await executors.listSubscriberLists();

		if (lists.length > 0) {
			OutputUtils.table(lists as Record<string, unknown>[]);
		} else {
			OutputUtils.info("No lists found");
		}
	} catch (error) {
		OutputUtils.error(
			`Failed to fetch lists: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}

export const getMeta = defineCommand({
	name: "get",
	description: "Get list details by ID",
	args: {
		id: {
			type: "string",
			description: "List ID",
			required: true,
		},
	},
	runner: "executor",
});

export async function getRun(executors: ListExecutors, ctx: CommandContext) {
	try {
		const { id } = ctx.values;
		OutputUtils.info(`📝 Fetching list: ${id}`);

		const list = await executors.getSubscriberList(id as string);

		OutputUtils.json(list);
	} catch (error) {
		OutputUtils.error(
			`Failed to fetch list: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
}
