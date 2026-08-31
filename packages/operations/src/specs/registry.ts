import {
	campaignSafeStartPlaybook,
	highRiskOperationSpecs,
	messageResource,
} from "./high-risk";
import {
	abTestSafeRunPlaybook,
	campaignDeliverabilityGuardPlaybook,
	campaignSafeSchedulePlaybook,
	providerHealthCheckPlaybook,
	templateSafePromotePlaybook,
	webhookRetentionPlaybook,
} from "./additional-playbooks";
import { bridgedOperationSpecs } from "./bridged";
import { coreReadOperationSpecs, standaloneOperationSpecs } from "./core-reads";
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
import {
	audienceResource,
	bounceResource,
	listResource,
	mediaResource,
	templateResource,
} from "./resources";
import { defineEmailOperationsSpec } from "./schema";
import { sequenceOperationSpecs, sequenceResource } from "./sequences";
import { userRoleOperationSpecs, userRoleResource } from "./user-roles";
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
	...coreReadOperationSpecs,
	...standaloneOperationSpecs,
	...bridgedOperationSpecs,
	...userRoleOperationSpecs,
] as const;

export const emailOperationsSpec =
	defineEmailOperationsSpec({
		schemaVersion: "2.0.0",
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
			listResource,
			templateResource,
			mediaResource,
			bounceResource,
			audienceResource,
			userRoleResource,
		],
		operations: operationSpecs,
		events: outboundWebhookEventSpecs,
		playbooks: [
			campaignSafeStartPlaybook,
			campaignSafeSchedulePlaybook,
			templateSafePromotePlaybook,
			abTestSafeRunPlaybook,
			campaignDeliverabilityGuardPlaybook,
			providerHealthCheckPlaybook,
			webhookRetentionPlaybook,
		],
	});
