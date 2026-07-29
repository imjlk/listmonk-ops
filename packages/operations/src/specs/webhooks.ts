import {
	webhookCreateInputContract,
	webhookCreateOutputContract,
	webhookDeleteInputContract,
	webhookDeleteOutputContract,
	webhookDeliveryListInputContract,
	webhookDeliveryListOutputContract,
	webhookDeliveryRetryInputContract,
	webhookDeliveryRetryOutputContract,
	webhookDispatchInputContract,
	webhookDispatchOutputContract,
	webhookListInputContract,
	webhookListOutputContract,
	webhookTestInputContract,
	webhookTestOutputContract,
	webhookUpdateInputContract,
	webhookUpdateOutputContract,
} from "./contract-schemas";
import type { OperationEventSpec } from "./event";
import { defineOperationSpec } from "./operation";
import { defineOperationResourceSpec } from "./resource";

export const operationResource = defineOperationResourceSpec({
	id: "operation",
	title: "Operation execution",
	states: ["started", "blocked", "succeeded", "failed"],
	transitions: {
		started: ["blocked", "succeeded", "failed"],
		blocked: [],
		succeeded: [],
		failed: [],
	},
	terminalStates: ["blocked", "succeeded", "failed"],
});

export const webhookResource = defineOperationResourceSpec({
	id: "webhook",
	title: "Outbound webhook",
	states: ["enabled", "disabled"],
	transitions: {
		enabled: ["disabled"],
		disabled: ["enabled"],
	},
	terminalStates: [],
});

export const experimentResource = defineOperationResourceSpec({
	id: "experiment",
	title: "Email experiment",
	states: [
		"draft",
		"running",
		"analyzing",
		"deploying",
		"completed",
		"inconclusive",
		"failed",
		"cancelled",
	],
	transitions: {
		draft: ["running", "cancelled"],
		running: ["analyzing", "failed", "cancelled"],
		analyzing: ["deploying", "inconclusive", "failed"],
		deploying: ["completed", "failed"],
		completed: [],
		inconclusive: [],
		failed: [],
		cancelled: [],
	},
	terminalStates: ["completed", "inconclusive", "failed", "cancelled"],
});

export const outboundWebhookEventSpecs = [
	{
		type: "operation.started",
		title: "Operation started",
		description: "A shared CLI or MCP operation entered its audited execution.",
		source: "operation",
		subject: "operation",
		schemaVersion: 1,
	},
	{
		type: "operation.blocked",
		title: "Operation blocked",
		description: "A shared operation was blocked by confirmation or safety policy.",
		source: "operation",
		subject: "operation",
		schemaVersion: 1,
	},
	{
		type: "operation.succeeded",
		title: "Operation succeeded",
		description: "A shared operation completed successfully.",
		source: "operation",
		subject: "operation",
		schemaVersion: 1,
	},
	{
		type: "operation.failed",
		title: "Operation failed",
		description: "A shared operation completed with an error.",
		source: "operation",
		subject: "operation",
		schemaVersion: 1,
	},
	{
		type: "campaign.scheduled",
		title: "Campaign scheduled",
		description: "A campaign was scheduled for future delivery.",
		source: "listmonk",
		subject: "campaign",
		schemaVersion: 1,
	},
	{
		type: "campaign.started",
		title: "Campaign started",
		description: "A campaign entered active delivery.",
		source: "listmonk",
		subject: "campaign",
		schemaVersion: 1,
	},
	{
		type: "campaign.paused",
		title: "Campaign paused",
		description: "A running or scheduled campaign was paused.",
		source: "listmonk",
		subject: "campaign",
		schemaVersion: 1,
	},
	{
		type: "campaign.cancelled",
		title: "Campaign cancelled",
		description: "A campaign was cancelled.",
		source: "listmonk",
		subject: "campaign",
		schemaVersion: 1,
	},
	{
		type: "campaign.finished",
		title: "Campaign finished",
		description: "A campaign completed delivery.",
		source: "listmonk",
		subject: "campaign",
		schemaVersion: 1,
	},
	{
		type: "subscriber.created",
		title: "Subscriber created",
		description: "A subscriber record was created.",
		source: "listmonk",
		subject: "subscriber",
		schemaVersion: 1,
	},
	{
		type: "subscriber.updated",
		title: "Subscriber updated",
		description: "A subscriber record changed.",
		source: "listmonk",
		subject: "subscriber",
		schemaVersion: 1,
	},
	{
		type: "subscriber.blocklisted",
		title: "Subscriber blocklisted",
		description: "A subscriber was added to the blocklist.",
		source: "listmonk",
		subject: "subscriber",
		schemaVersion: 1,
	},
	{
		type: "subscriber.unsubscribed",
		title: "Subscriber unsubscribed",
		description: "A subscriber opted out of one or more lists.",
		source: "listmonk",
		subject: "subscriber",
		schemaVersion: 1,
	},
	{
		type: "delivery.delivered",
		title: "Message delivered",
		description: "A provider reported successful message delivery.",
		source: "provider",
		subject: "message",
		schemaVersion: 1,
	},
	{
		type: "delivery.bounced",
		title: "Message bounced",
		description: "A provider reported a message bounce.",
		source: "provider",
		subject: "message",
		schemaVersion: 1,
	},
	{
		type: "delivery.complained",
		title: "Message complaint",
		description: "A provider reported a recipient complaint.",
		source: "provider",
		subject: "message",
		schemaVersion: 1,
	},
	{
		type: "delivery.delayed",
		title: "Message delayed",
		description: "A provider reported delayed message delivery.",
		source: "provider",
		subject: "message",
		schemaVersion: 1,
	},
	{
		type: "abtest.started",
		title: "A/B test started",
		description: "An experiment began sending variants.",
		source: "abtest",
		subject: "experiment",
		schemaVersion: 1,
	},
	{
		type: "abtest.ready-for-analysis",
		title: "A/B test ready for analysis",
		description: "An experiment reached its fixed-horizon analysis gate.",
		source: "abtest",
		subject: "experiment",
		schemaVersion: 1,
	},
	{
		type: "abtest.winner-selected",
		title: "A/B test winner selected",
		description: "An experiment selected a statistically valid winner.",
		source: "abtest",
		subject: "experiment",
		schemaVersion: 1,
	},
	{
		type: "abtest.inconclusive",
		title: "A/B test inconclusive",
		description: "An experiment completed without a valid winner.",
		source: "abtest",
		subject: "experiment",
		schemaVersion: 1,
	},
	{
		type: "abtest.failed",
		title: "A/B test failed",
		description: "An experiment entered an unrecoverable failure state.",
		source: "abtest",
		subject: "experiment",
		schemaVersion: 1,
	},
	{
		type: "webhook.test",
		title: "Webhook test",
		description: "A signed test event was sent to one configured endpoint.",
		source: "webhook",
		subject: "webhook",
		schemaVersion: 1,
	},
] as const satisfies readonly OperationEventSpec[];

export const webhookListOperationSpec = defineOperationSpec({
	id: "webhooks.list",
	resource: "webhook",
	verb: "list",
	title: "List outbound webhook endpoints",
	description:
		"List configured outbound webhook endpoints without exposing signing secret values.",
	contract: {
		input: webhookListInputContract,
		output: webhookListOutputContract,
	},
	effects: [{ kind: "read", resource: "webhook" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The operation only reads the local endpoint registry.",
	},
	agent: {
		useWhen: ["Configured webhook endpoints or their filters must be inspected."],
		avoidWhen: ["Delivery attempts rather than endpoint configuration are needed."],
		prerequisites: [],
		verifyWith: [],
		related: ["webhooks.create", "webhooks.delivery.list"],
		retryGuidance: "Retrying the same read is safe.",
	},
	projection: {
		mcpName: "listmonk_webhooks_list",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookListOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookListOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookListOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookCreateOperationSpec = defineOperationSpec({
	id: "webhooks.create",
	resource: "webhook",
	verb: "create",
	title: "Create outbound webhook endpoint",
	description:
		"Create an HTTPS endpoint using an environment-variable secret reference and typed event filters.",
	contract: {
		input: webhookCreateInputContract,
		output: webhookCreateOutputContract,
	},
	effects: [{ kind: "write", resource: "webhook", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "webhooks.list",
		idempotent: false,
		reason:
			"A completed create is visible by name; blindly repeating an ambiguous create is not safe.",
	},
	agent: {
		useWhen: ["A new signed outbound event destination must be registered."],
		avoidWhen: ["The signing secret value would need to be stored in the request."],
		prerequisites: [],
		verifyWith: ["webhooks.list"],
		related: ["webhooks.test", "webhooks.update"],
		retryGuidance:
			"List endpoints by name after an ambiguous result before creating again.",
	},
	projection: {
		mcpName: "listmonk_webhooks_create",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookCreateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookCreateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookCreateOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookCreateOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookCreateOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookUpdateOperationSpec = defineOperationSpec({
	id: "webhooks.update",
	resource: "webhook",
	verb: "update",
	title: "Update outbound webhook endpoint",
	description:
		"Update endpoint metadata, delivery policy, enabled state, or event filters without storing a secret value.",
	contract: {
		input: webhookUpdateInputContract,
		output: webhookUpdateOutputContract,
	},
	effects: [{ kind: "write", resource: "webhook", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason: "Applying the same endpoint field values is idempotent.",
	},
	agent: {
		useWhen: ["An existing endpoint configuration or enabled state must change."],
		avoidWhen: ["A delivery attempt rather than endpoint configuration must change."],
		prerequisites: ["webhooks.list"],
		verifyWith: ["webhooks.list"],
		related: ["webhooks.test", "webhooks.delete"],
		retryGuidance: "Retrying the same field update is safe.",
	},
	projection: {
		mcpName: "listmonk_webhooks_update",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookUpdateOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookUpdateOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookUpdateOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookUpdateOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookUpdateOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookDeleteOperationSpec = defineOperationSpec({
	id: "webhooks.delete",
	resource: "webhook",
	verb: "delete",
	title: "Delete outbound webhook endpoint",
	description:
		"Delete an endpoint and exhaust its unfinished delivery records.",
	contract: {
		input: webhookDeleteInputContract,
		output: webhookDeleteOutputContract,
	},
	effects: [{ kind: "delete", resource: "webhook", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "webhooks.list",
		idempotent: false,
		reason:
			"After an ambiguous delete, inspect the endpoint registry before repeating it.",
	},
	agent: {
		useWhen: ["An endpoint must be permanently removed and pending work abandoned."],
		avoidWhen: ["Temporarily stopping deliveries is sufficient; disable the endpoint instead."],
		prerequisites: ["webhooks.list"],
		verifyWith: ["webhooks.list", "webhooks.delivery.list"],
		related: ["webhooks.update"],
		retryGuidance:
			"List endpoints after an ambiguous result; do not blindly repeat deletion.",
	},
	projection: {
		mcpName: "listmonk_webhooks_delete",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookDeleteOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookDeleteOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookDeleteOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookDeleteOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookDeleteOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookTestOperationSpec = defineOperationSpec({
	id: "webhooks.test",
	resource: "webhook",
	verb: "test",
	title: "Send outbound webhook test",
	description:
		"Queue and immediately send one signed webhook.test event to a selected endpoint.",
	contract: {
		input: webhookTestInputContract,
		output: webhookTestOutputContract,
	},
	effects: [{ kind: "webhook", resource: "webhook", audience: "single" }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "unsafe",
		reason:
			"A timeout can occur after the endpoint accepted the test, so an automatic retry may duplicate it.",
	},
	agent: {
		useWhen: ["A configured endpoint and signing secret must be verified end to end."],
		avoidWhen: ["The endpoint owner has not approved an external test request."],
		prerequisites: ["webhooks.list"],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.dispatch"],
		retryGuidance:
			"Inspect the delivery log and endpoint system before sending another test.",
	},
	projection: {
		mcpName: "listmonk_webhooks_test",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookTestOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookTestOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookTestOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookTestOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookTestOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookDispatchOperationSpec = defineOperationSpec({
	id: "webhooks.dispatch",
	resource: "webhook",
	verb: "dispatch",
	title: "Dispatch outbound webhooks",
	description:
		"Claim due outbox deliveries and send signed HTTPS requests with bounded retries.",
	contract: {
		input: webhookDispatchInputContract,
		output: webhookDispatchOutputContract,
	},
	effects: [{ kind: "webhook", resource: "webhook", audience: "batch" }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "webhooks.delivery.list",
		idempotent: false,
		reason:
			"Delivery is at least once; stable event IDs support receiver deduplication but do not make blind retries safe.",
	},
	agent: {
		useWhen: ["Due outbox deliveries should be processed by a worker or scheduled tick."],
		avoidWhen: ["The operator has not approved external network delivery."],
		prerequisites: ["webhooks.list"],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.test", "webhooks.delivery.retry"],
		retryGuidance:
			"Inspect delivery statuses after a timeout and rely on stable event IDs for receiver deduplication.",
	},
	projection: {
		mcpName: "listmonk_webhooks_dispatch",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookDispatchOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookDispatchOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookDispatchOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookDispatchOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookDispatchOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookDeliveryListOperationSpec = defineOperationSpec({
	id: "webhooks.delivery.list",
	resource: "webhook",
	verb: "list",
	title: "List outbound webhook deliveries",
	description:
		"Inspect redacted outbox delivery state, attempts, status codes, and exhausted errors.",
	contract: {
		input: webhookDeliveryListInputContract,
		output: webhookDeliveryListOutputContract,
	},
	effects: [{ kind: "read", resource: "webhook" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The operation only reads redacted delivery records.",
	},
	agent: {
		useWhen: ["Delivery progress, retries, or exhausted events must be inspected."],
		avoidWhen: ["Endpoint configuration rather than delivery state is needed."],
		prerequisites: [],
		verifyWith: [],
		related: ["webhooks.dispatch", "webhooks.delivery.retry"],
		retryGuidance: "Retrying the same read is safe.",
	},
	projection: {
		mcpName: "listmonk_webhook_deliveries_list",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookDeliveryListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookDeliveryListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookDeliveryListOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookDeliveryListOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookDeliveryListOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookDeliveryRetryOperationSpec = defineOperationSpec({
	id: "webhooks.delivery.retry",
	resource: "webhook",
	verb: "retry",
	title: "Retry outbound webhook delivery",
	description:
		"Requeue one retryable or exhausted delivery for a fresh bounded attempt cycle.",
	contract: {
		input: webhookDeliveryRetryInputContract,
		output: webhookDeliveryRetryOutputContract,
	},
	effects: [{ kind: "write", resource: "webhook", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "webhooks.delivery.list",
		idempotent: false,
		reason:
			"Repeating the retry action after success is not a no-op because the delivery is already pending.",
	},
	agent: {
		useWhen: ["An operator has reviewed a failed delivery and wants another attempt cycle."],
		avoidWhen: ["The endpoint is disabled, missing, or the failure has not been investigated."],
		prerequisites: ["webhooks.delivery.list"],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.dispatch", "webhooks.update"],
		retryGuidance:
			"Inspect the delivery status after an ambiguous result before requeueing again.",
	},
	projection: {
		mcpName: "listmonk_webhook_delivery_retry",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookDeliveryRetryOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookDeliveryRetryOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookDeliveryRetryOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookDeliveryRetryOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookDeliveryRetryOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookOperationSpecs = [
	webhookListOperationSpec,
	webhookCreateOperationSpec,
	webhookUpdateOperationSpec,
	webhookDeleteOperationSpec,
	webhookTestOperationSpec,
	webhookDispatchOperationSpec,
	webhookDeliveryListOperationSpec,
	webhookDeliveryRetryOperationSpec,
] as const;

export function bindWebhookListOperationSpec(): typeof webhookListOperationSpec {
	return webhookListOperationSpec;
}

export function bindWebhookCreateOperationSpec(): typeof webhookCreateOperationSpec {
	return webhookCreateOperationSpec;
}

export function bindWebhookUpdateOperationSpec(): typeof webhookUpdateOperationSpec {
	return webhookUpdateOperationSpec;
}

export function bindWebhookDeleteOperationSpec(): typeof webhookDeleteOperationSpec {
	return webhookDeleteOperationSpec;
}

export function bindWebhookTestOperationSpec(): typeof webhookTestOperationSpec {
	return webhookTestOperationSpec;
}

export function bindWebhookDispatchOperationSpec(): typeof webhookDispatchOperationSpec {
	return webhookDispatchOperationSpec;
}

export function bindWebhookDeliveryListOperationSpec(): typeof webhookDeliveryListOperationSpec {
	return webhookDeliveryListOperationSpec;
}

export function bindWebhookDeliveryRetryOperationSpec(): typeof webhookDeliveryRetryOperationSpec {
	return webhookDeliveryRetryOperationSpec;
}
