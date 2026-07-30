import {
	invokeDeliverabilityDnsCheckOperation,
	invokeDeliverabilityDoctorOperation,
	providerIdInput,
	providerWebhookMaxAgeHoursInput,
} from "@listmonk-ops/automation";
import { defineCommand, defineGroup, option } from "../lib/command";
import { getOutput } from "../lib/output";
import {
	resolveProviderOperationContext,
	runProviderCliCommand,
} from "../lib/provider";

const providerIdOption = option(providerIdInput, {
	description: "Provider profile ID",
});

const dnsCheckCommand = defineCommand({
	name: "dns-check",
	operationId: "deliverability.dns-check",
	description: "Check DMARC, DKIM, custom MAIL FROM, SPF, MX, and alignment",
	options: { "provider-id": providerIdOption },
	handler: async ({ flags, ...args }) => {
		getOutput().json(
			await runProviderCliCommand("Deliverability DNS check", async () =>
				invokeDeliverabilityDnsCheckOperation(
					await resolveProviderOperationContext(args, false),
					{ provider_id: flags["provider-id"] },
				),
			),
		);
	},
});

const doctorCommand = defineCommand({
	name: "doctor",
	operationId: "deliverability.doctor",
	description: "Run the complete provider deliverability readiness doctor",
	options: {
		"provider-id": providerIdOption,
		"max-age-hours": option(providerWebhookMaxAgeHoursInput, {
			description: "Provider webhook freshness threshold in hours",
		}),
	},
	handler: async ({ flags, ...args }) => {
		getOutput().json(
			await runProviderCliCommand("Deliverability doctor", async () =>
				invokeDeliverabilityDoctorOperation(
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
	name: "deliverability",
	description: "Email authentication and delivery readiness diagnostics",
	commands: [dnsCheckCommand, doctorCommand],
});
