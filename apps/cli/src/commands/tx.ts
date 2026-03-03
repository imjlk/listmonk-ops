import { defineCommand, defineGroup, option } from "@bunli/core";
import { OutputUtils } from "@listmonk-ops/common";
import { z } from "zod";

import { hasApiError, parseJson, toErrorMessage } from "../lib/command-utils";
import { getListmonkClient } from "../lib/listmonk";

export default defineGroup({
	name: "tx",
	description: "Transactional email operations",
	commands: [
		defineCommand({
			name: "send",
			description: "Send a transactional email",
			options: {
				"template-id": option(z.coerce.number().int().positive(), {
					description: "Template ID",
				}),
				"subscriber-email": option(z.string().trim().email().optional(), {
					description: "Recipient subscriber email",
				}),
				"subscriber-id": option(z.coerce.number().int().positive().optional(), {
					description: "Recipient subscriber ID",
				}),
				"from-email": option(z.string().trim().email().optional(), {
					description: "From email address",
				}),
				data: option(z.string().optional(), {
					description: "JSON template variables",
				}),
				"content-type": option(
					z.enum(["html", "markdown", "plain"]).optional(),
					{
						description: "Message content type",
					},
				),
			},
			handler: async ({ flags, ...args }) => {
				try {
					if (!flags["subscriber-email"] && !flags["subscriber-id"]) {
						throw new Error(
							"Either --subscriber-email or --subscriber-id must be provided",
						);
					}

					const client = await getListmonkClient(args);
					const templateData = flags.data
						? parseJson<Record<string, unknown>>(flags.data, "data")
						: undefined;

					const response = await client.transactional.send({
						template_id: flags["template-id"],
						subscriber_email: flags["subscriber-email"],
						subscriber_id: flags["subscriber-id"],
						from_email: flags["from-email"],
						content_type: flags["content-type"],
						data: templateData,
					});
					if (hasApiError(response)) {
						throw new Error(toErrorMessage(response.error));
					}

					OutputUtils.success("Transactional message sent");
					OutputUtils.json(response.data);
				} catch (error) {
					throw new Error(
						`Failed to send transactional email: ${toErrorMessage(error)}`,
					);
				}
			},
		}),
	],
});
