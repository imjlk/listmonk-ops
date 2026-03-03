import { defineCommand, defineGroup, option } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";

import { hasApiError, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

const templateTypeSchema = z.enum(["campaign", "campaign_visual", "tx"]);

export default defineGroup({
	name: "templates",
	description: "Manage templates",
	commands: [
		defineCommand({
			name: "list",
			description: "List templates",
			handler: async (args) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.template.list();
					const templates = response.data.results ?? [];

					if (templates.length === 0) {
						OutputUtils.info("No templates found");
						return;
					}

					OutputUtils.table(templates as Record<string, unknown>[]);
				} catch (error) {
					throw new Error(`Failed to list templates: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "get",
			description: "Get template details",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.template.getById({
						path: { id: flags.id },
					});

					if (hasApiError(response)) {
						throw new Error(toErrorMessage(response.error));
					}

					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(`Failed to get template: ${toErrorMessage(error)}`);
				}
			},
		}),
		defineCommand({
			name: "create",
			description: "Create a template",
			options: {
				name: option(z.string().trim().min(1), {
					description: "Template name",
				}),
				type: option(templateTypeSchema.default("campaign"), {
					description: "Template type",
				}),
				subject: option(z.string().trim().optional(), {
					description: "Email subject",
				}),
				body: option(z.string().min(1), {
					description: "Template body",
				}),
				"body-source": option(z.string().optional(), {
					description: "Original source body",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.template.create({
						body: {
							name: flags.name,
							type: flags.type,
							subject: flags.subject,
							body: flags.body,
							body_source: flags["body-source"],
						},
					});
					if (hasApiError(response)) {
						throw new Error(toErrorMessage(response.error));
					}

					if (!response.data) {
						throw new Error("Template creation returned no data");
					}

					OutputUtils.success(`Template created: ${flags.name}`);
					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(
						`Failed to create template: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
		defineCommand({
			name: "set-default",
			description: "Set a template as default",
			options: {
				id: option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
			},
			handler: async ({ flags, ...args }) => {
				try {
					const client = await getListmonkClient(args);
					const response = await client.template.setAsDefault({
						path: { id: flags.id },
					});
					if (hasApiError(response)) {
						throw new Error(toErrorMessage(response.error));
					}

					OutputUtils.success(`Default template set: ${flags.id}`);
					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(
						`Failed to set default template: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
	],
});
