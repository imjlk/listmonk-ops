import {
	campaignSafeStartPlaybook,
	highRiskOperationSpecs,
	messageResource,
} from "./high-risk";
import {
	campaignResource,
	pilotOperationSpecs,
	subscriberResource,
} from "./pilot";
import { defineEmailOperationsSpec } from "./schema";

export const operationSpecs = [
	...pilotOperationSpecs,
	...highRiskOperationSpecs,
] as const;

export const emailOperationsSpec =
	defineEmailOperationsSpec({
		schemaVersion: "1.1.0",
		title: "listmonk-ops Email Operations Specification",
		description:
			"Typed, policy-aware, and verifiable email operations for humans and AI agents.",
		resources: [campaignResource, subscriberResource, messageResource],
		operations: operationSpecs,
		events: [],
		playbooks: [campaignSafeStartPlaybook],
	});
