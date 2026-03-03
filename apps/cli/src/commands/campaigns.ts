import { defineCommand, defineGroup, option } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";

import { hasApiError, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

export default defineGroup({
	name: "campaigns",
	description: "Manage campaigns",
	commands: [
		defineCommand({
			name: "list",
			description: "List campaigns",
			options: {
				page: option(z.coerce.number().int().positive().optional(), {
					description: "Page number",
				}),
				"per-page": option(z.coerce.number().int().positive().optional(), {
					description: "Items per page",
				}),
				query: option(z.string().trim().optional(), {
					description: "Search query",
				}),
			},
			handler: async ({ flags, spinner, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const spin = spinner();
					spin.start("Fetching campaigns");

					const query: Record<string, unknown> = {};
					if (flags.page !== undefined) {
						query.page = flags.page;
					}
					if (flags["per-page"] !== undefined) {
						query.per_page = flags["per-page"];
					}
					if (flags.query) {
						query.query = flags.query;
					}

					const options =
						Object.keys(query).length > 0
							? ({ query } as Parameters<typeof client.campaign.list>[0])
							: undefined;
					const response = await client.campaign.list(options);

					spin.stop("Campaign list loaded", 0);

					const campaigns = response.data.results ?? [];
					if (campaigns.length === 0) {
						OutputUtils.info("No campaigns found");
						return;
					}

					OutputUtils.table(campaigns as Record<string, unknown>[]);
				} catch (error) {
					throw new Error(`Failed to list campaigns: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "get",
			description: "Get campaign details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Campaign ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.campaign.getById({
						path: { id: flags.id },
					});

					if (hasApiError(response)) {
						throw new Error(String(response.error));
					}

					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(`Failed to get campaign: ${toErrorMessage(error)}`);
				}
			},
		}),
	],
});
