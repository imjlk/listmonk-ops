import {
	invokeProviderListOperation,
	invokeProviderQuotaOperation,
	invokeProviderStatusOperation,
	invokeProviderTestOperation,
	invokeProviderWebhookStatusOperation,
} from "@listmonk-ops/automation";
import { z } from "zod";
import { defineCommand, defineGroup, option } from "../lib/command";
import { getOutput } from "../lib/output";
import {
	resolveProviderOperationContext,
	runProviderCliCommand,
} from "../lib/provider";

const providerIdOption = option(
	z.string().trim().min(1).max(80).regex(/^[a-z][a-z0-9._-]*$/),
	{ description: "Provider profile ID" },
);

const listCommand = defineCommand({
	name: "list",
	operationId: "providers.list",
	description: "List configured provider profiles",
	handler: async () => {
		getOutput().json(
			await runProviderCliCommand("Provider list", () =>
				invokeProviderListOperation({}, {}),
			),
		);
	},
});

const statusCommand = defineCommand({
	name: "status",
	operationId: "providers.status",
	description: "Inspect provider, identity, and Listmonk delivery status",
	options: { "provider-id": providerIdOption },
	handler: async ({ flags, ...args }) => {
		getOutput().json(
			await runProviderCliCommand("Provider status", async () =>
				invokeProviderStatusOperation(
					await resolveProviderOperationContext(args, true),
					{ provider_id: flags["provider-id"] },
				),
			),
		);
	},
});

const testCommand = defineCommand({
	name: "test",
	operationId: "providers.test",
	description: "Test read-only provider API access without sending mail",
	options: { "provider-id": providerIdOption },
	handler: async ({ flags, ...args }) => {
		getOutput().json(
			await runProviderCliCommand("Provider API test", async () =>
				invokeProviderTestOperation(
					await resolveProviderOperationContext(args, false),
					{ provider_id: flags["provider-id"] },
				),
			),
		);
	},
});

const quotaCommand = defineCommand({
	name: "quota",
	operationId: "providers.quota",
	description: "Inspect provider quota, usage, and account enforcement",
	options: { "provider-id": providerIdOption },
	handler: async ({ flags, ...args }) => {
		getOutput().json(
			await runProviderCliCommand("Provider quota", async () =>
				invokeProviderQuotaOperation(
					await resolveProviderOperationContext(args, false),
					{ provider_id: flags["provider-id"] },
				),
			),
		);
	},
});

const webhookStatusCommand = defineCommand({
	name: "webhook-status",
	operationId: "providers.webhook-status",
	description: "Inspect Listmonk provider webhook configuration and freshness",
	options: {
		"provider-id": providerIdOption,
		"max-age-hours": option(
			z.coerce.number().int().min(1).max(8_760).optional(),
			{ description: "Freshness threshold in hours" },
		),
	},
	handler: async ({ flags, ...args }) => {
		getOutput().json(
			await runProviderCliCommand("Provider webhook status", async () =>
				invokeProviderWebhookStatusOperation(
					await resolveProviderOperationContext(args, true),
					{
						provider_id: flags["provider-id"],
						max_age_hours: flags["max-age-hours"],
					},
				),
			),
		);
	},
});

export default defineGroup({
	name: "providers",
	description: "Delivery provider health and quota diagnostics",
	commands: [
		listCommand,
		statusCommand,
		testCommand,
		quotaCommand,
		webhookStatusCommand,
	],
});
