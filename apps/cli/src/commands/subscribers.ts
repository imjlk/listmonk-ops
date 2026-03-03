import { defineCommand, defineGroup, option } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";

import {
	hasApiError,
	parseCsvNumbers,
	toErrorMessage,
} from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

export default defineGroup({
	name: "subscribers",
	description: "Manage subscribers",
	commands: [
		defineCommand({
			name: "list",
			description: "List subscribers",
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
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
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
							? ({ query } as Parameters<typeof client.subscriber.list>[0])
							: undefined;
					const response = await client.subscriber.list(options);

					const subscribers = response.data.results ?? [];
					if (subscribers.length === 0) {
						OutputUtils.info("No subscribers found");
						return;
					}

					OutputUtils.table(subscribers as Record<string, unknown>[]);
				} catch (error) {
					throw new Error(
						`Failed to list subscribers: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "get",
			description: "Get subscriber details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Subscriber ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.subscriber.getById({
						path: { id: flags.id },
					});

					if (hasApiError(response)) {
						throw new Error(String(response.error));
					}

					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(`Failed to get subscriber: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "create",
			description: "Create a subscriber",
			options: {
				email: option(z.string().trim().email(), {
					description: "Subscriber email",
				}),
				name: option(z.string().trim().optional(), {
					description: "Subscriber name",
				}),
				lists: option(z.string().trim().optional(), {
					description: "Comma-separated list IDs",
				}),
				status: option(z.string().trim().optional(), {
					description: "Subscriber status",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const listIds = parseCsvNumbers(flags.lists);

					const response = await client.subscriber.create({
						body: {
							email: flags.email,
							name: flags.name ?? "",
							status: flags.status ?? "enabled",
							lists: listIds,
						},
					});

					OutputUtils.success(`Subscriber created: ${flags.email}`);
					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(
						`Failed to create subscriber: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
	],
});
