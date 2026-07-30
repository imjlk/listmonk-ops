import {
	campaignSafeStartPlaybook,
	highRiskOperationSpecs,
	messageResource,
} from "./high-risk";
import {
	controlResource,
	discoveryOperationSpecs,
	playbookResource,
	specResource,
} from "./discovery";
import {
	campaignResource,
	pilotOperationSpecs,
	subscriberResource,
} from "./pilot";
import { providerOperationSpecs, providerResource } from "./providers";
import { defineEmailOperationsSpec } from "./schema";
import { sequenceOperationSpecs, sequenceResource } from "./sequences";
import {
	experimentResource,
	operationResource,
	outboundWebhookEventSpecs,
	webhookOperationSpecs,
	webhookResource,
} from "./webhooks";

export const operationSpecs = [
	...pilotOperationSpecs,
	...highRiskOperationSpecs,
	...discoveryOperationSpecs,
	...webhookOperationSpecs,
	...sequenceOperationSpecs,
	...providerOperationSpecs,
] as const;

export const emailOperationsSpec =
	defineEmailOperationsSpec({
		schemaVersion: "1.7.0",
		title: "listmonk-ops Email Operations Specification",
		description:
			"Typed, policy-aware, and verifiable email operations for humans and AI agents.",
		resources: [
			campaignResource,
			subscriberResource,
			messageResource,
			specResource,
			playbookResource,
			controlResource,
			operationResource,
			webhookResource,
			experimentResource,
			sequenceResource,
			providerResource,
		],
		operations: operationSpecs,
		events: outboundWebhookEventSpecs,
		playbooks: [campaignSafeStartPlaybook],
	});
