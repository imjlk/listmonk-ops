import { defineCommand, defineGroup, option } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";

import { hasApiError, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

export default defineGroup({
	name: "lists",
	description: "Manage subscriber lists",
	commands: [
		defineCommand({
			name: "list",
			description: "List subscriber lists",
			handler: async (args) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.list.list();
					const lists = response.data.results ?? [];

					if (lists.length === 0) {
						OutputUtils.info("No lists found");
						return;
					}

					OutputUtils.table(lists as Record<string, unknown>[]);
				} catch (error) {
					throw new Error(`Failed to list lists: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "get",
			description: "Get list details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "List ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.list.getById({
						path: { list_id: flags.id },
					});

					if (hasApiError(response)) {
						throw new Error(String(response.error));
					}

					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(`Failed to get list: ${toErrorMessage(error)}`);
				}
			},
		}),
	],
});
