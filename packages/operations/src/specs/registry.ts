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
import { defineEmailOperationsSpec } from "./schema";
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
] as const;

export const emailOperationsSpec =
	defineEmailOperationsSpec({
		schemaVersion: "1.5.0",
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
		],
		operations: operationSpecs,
		events: outboundWebhookEventSpecs,
		playbooks: [campaignSafeStartPlaybook],
	});
