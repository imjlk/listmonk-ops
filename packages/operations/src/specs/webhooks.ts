import {
	webhookCreateInputContract,
	webhookCreateOutputContract,
	webhookDeleteInputContract,
	webhookDeleteOutputContract,
	webhookCircuitResetInputContract,
	webhookCircuitResetOutputContract,
	webhookDeliveryListInputContract,
	webhookDeliveryListOutputContract,
	webhookDeliveryRetryInputContract,
	webhookDeliveryRetryOutputContract,
	webhookDlqListInputContract,
	webhookDlqListOutputContract,
	webhookDlqReplayInputContract,
	webhookDlqReplayOutputContract,
	webhookDispatchInputContract,
	webhookDispatchOutputContract,
	webhookListInputContract,
	webhookListOutputContract,
	webhookInboundIngestInputContract,
	webhookInboundIngestOutputContract,
	webhookPruneInputContract,
	webhookPruneOutputContract,
	webhookReconcileInputContract,
	webhookReconcileOutputContract,
	webhookTestInputContract,
	webhookTestOutputContract,
	webhookTickInputContract,
	webhookTickOutputContract,
	webhookRuntimeStatusInputContract,
	webhookRuntimeStatusOutputContract,
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
		"testing",
		"scheduled",
		"running",
		"analyzing",
		"deploying",
		"cancelling",
		"completed",
		"inconclusive",
		"failed",
		"cancelled",
	],
	transitions: {
		draft: ["testing", "scheduled", "cancelled", "failed"],
		testing: ["draft", "scheduled", "cancelling", "failed"],
		scheduled: ["running", "cancelling", "cancelled", "failed"],
		running: ["analyzing", "cancelling", "cancelled", "failed"],
		analyzing: [
			"deploying",
			"completed",
			"inconclusive",
			"cancelling",
			"failed",
		],
		deploying: ["analyzing", "completed", "cancelling", "failed"],
		cancelling: ["cancelled", "failed"],
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
		type: "delivery.rejected",
		title: "Message rejected",
		description: "A provider rejected a message before successful delivery.",
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
		type: "sequence.created",
		title: "Sequence created",
		description: "A durable sequence definition was created.",
		source: "sequence",
		subject: "sequence",
		schemaVersion: 1,
	},
	{
		type: "sequence.revised",
		title: "Sequence revised",
		description: "An immutable sequence revision was appended.",
		source: "sequence",
		subject: "sequence",
		schemaVersion: 1,
	},
	{
		type: "sequence.enrolled",
		title: "Subscriber enrolled",
		description: "A subscriber was pinned to a sequence revision.",
		source: "sequence",
		subject: "sequence",
		schemaVersion: 1,
	},
	{
		type: "sequence.paused",
		title: "Sequence paused",
		description: "A sequence stopped claiming due enrollments.",
		source: "sequence",
		subject: "sequence",
		schemaVersion: 1,
	},
	{
		type: "sequence.resumed",
		title: "Sequence resumed",
		description: "A paused sequence resumed claiming due enrollments.",
		source: "sequence",
		subject: "sequence",
		schemaVersion: 1,
	},
	{
		type: "sequence.reconciled",
		title: "Sequence enrollment reconciled",
		description: "An operator resolved an ambiguous sequence send outcome.",
		source: "sequence",
		subject: "sequence",
		schemaVersion: 1,
	},
	{
		type: "sequence.deleted",
		title: "Sequence deleted",
		description:
			"A sequence and its terminal enrollment history were deleted.",
		source: "sequence",
		subject: "sequence",
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
	stability: "stable",
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
		idempotent: true,
		reason:
			"Endpoint names are unique, so a retry after an ambiguous create conflicts and replays the persisted endpoint when it matches the requested intent, reporting created: false; a different configuration under the same name stays a conflict.",
	},
	agent: {
		useWhen: ["A new signed outbound event destination must be registered."],
		avoidWhen: ["The signing secret value would need to be stored in the request."],
		prerequisites: [],
		verifyWith: ["webhooks.list"],
		related: ["webhooks.test", "webhooks.update"],
		retryGuidance:
			"Replay the create after an ambiguous result: an identically configured endpoint returns the persisted record with created: false, while a conflicting configuration under the same name fails explicitly.",
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
	stability: "stable",
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
	stability: "stable",
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
		idempotent: true,
		reason:
			"Deleting an already-deleted endpoint is a documented no-op that reports deleted: false; verify with webhooks.list after an ambiguous result.",
	},
	agent: {
		useWhen: ["An endpoint must be permanently removed and pending work abandoned."],
		avoidWhen: ["Temporarily stopping deliveries is sufficient; disable the endpoint instead."],
		prerequisites: ["webhooks.list"],
		verifyWith: ["webhooks.list", "webhooks.delivery.list"],
		related: ["webhooks.update"],
		retryGuidance:
			"Verify the endpoint is gone with webhooks.list before retrying; an already-deleted endpoint reports deleted: false without error.",
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
	stability: "stable",
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
	effects: [{ kind: "webhook", resource: "webhook", audience: "bulk" }],
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
		"Inspect redacted outbox delivery state, attempts, status codes, and stored-error presence.",
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
	stability: "stable",
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

export const webhookReconcileOperationSpec = defineOperationSpec({
	id: "webhooks.reconcile",
	resource: "webhook",
	verb: "reconcile",
	title: "Reconcile outbound webhook leases",
	description:
		"Recover expired worker leases and exhaust deliveries whose endpoint is missing or disabled.",
	contract: {
		input: webhookReconcileInputContract,
		output: webhookReconcileOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "webhook",
			action: "recover",
			destructive: false,
		},
	],
	policy: { confirmation: "never", audit: "required", dryRun: true },
	retry: {
		kind: "reconcile",
		reconcileWith: "webhooks.reconcile",
		idempotent: false,
		reason:
			"Reconciliation is bounded by a per-call limit. When more expired deliveries exist than the limit, an ambiguous retry selects and mutates the next batch rather than being a pure no-op; re-run in dry-run mode to verify the remaining backlog before retrying.",
	},
	agent: {
		useWhen: [
			"A worker may have crashed with deliveries left in the delivering state.",
		],
		avoidWhen: ["Healthy non-expired workers are still processing the selected leases."],
		prerequisites: ["webhooks.delivery.list"],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.tick", "webhooks.dispatch"],
		retryGuidance: "Re-run in dry-run mode after an ambiguous result to verify whether more expired deliveries remain before retrying.",
	},
	projection: {
		mcpName: "listmonk_webhooks_reconcile",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookReconcileOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookReconcileOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookReconcileOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookReconcileOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookReconcileOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookPruneOperationSpec = defineOperationSpec({
	id: "webhooks.prune",
	resource: "webhook",
	verb: "prune",
	title: "Prune outbound webhook delivery history",
	description:
		"Preview or delete bounded terminal delivery records older than a retention cutoff. Destructive runs echo the exact delivery ids and `before` cutoff a dry run reported, so a retry deletes nothing new.",
	contract: {
		input: webhookPruneInputContract,
		output: webhookPruneOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "webhook",
			action: "prune",
			destructive: true,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "safe",
		reason:
			"Destructive runs delete exactly the echoed delivery set inside the echoed cutoff; a retry finds those records already removed and is a documented no-op. Dry runs only preview the bounded oldest batch.",
	},
	agent: {
		useWhen: ["Terminal delivery history has exceeded the retention policy."],
		avoidWhen: ["Delivery records are still pending, retrying, or delivering."],
		prerequisites: ["webhooks.delivery.list"],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.reconcile"],
		retryGuidance:
			"Run dry_run first, then echo the reported ids and before cutoff; repeating that exact request deletes nothing new.",
	},
	projection: {
		mcpName: "listmonk_webhooks_prune",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookPruneOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookPruneOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookPruneOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookPruneOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookPruneOperation:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const webhookTickOperationSpec = defineOperationSpec({
	id: "webhooks.tick",
	resource: "webhook",
	verb: "tick",
	title: "Run one outbound webhook worker tick",
	description:
		"Reconcile expired leases, claim due outbox records, and send one bounded delivery batch.",
	contract: {
		input: webhookTickInputContract,
		output: webhookTickOutputContract,
	},
	effects: [{ kind: "webhook", resource: "webhook", audience: "bulk" }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "reconcile",
		reconcileWith: "webhooks.delivery.list",
		idempotent: false,
		reason:
			"Delivery is at least once, so inspect lease and delivery state after an ambiguous worker result.",
	},
	agent: {
		useWhen: ["A scheduler or operator should process one durable outbox batch."],
		avoidWhen: ["External webhook delivery has not been approved."],
		prerequisites: ["webhooks.list"],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.reconcile", "webhooks.prune"],
		retryGuidance:
			"Inspect delivery state after a timeout before running another tick.",
	},
	projection: {
		mcpName: "listmonk_webhooks_tick",
		openWorld: true,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookTickOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookTickOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookTickOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookTickOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookTickOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookRuntimeStatusOperationSpec = defineOperationSpec({
	id: "webhooks.runtime.status",
	resource: "webhook",
	verb: "status",
	title: "Inspect outbound webhook runtime health",
	description:
		"Inspect durable schema, endpoint circuit, dead-letter, delivery, and worker heartbeat health.",
	contract: {
		input: webhookRuntimeStatusInputContract,
		output: webhookRuntimeStatusOutputContract,
	},
	effects: [{ kind: "read", resource: "webhook" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: {
		kind: "safe",
		reason: "The operation only reads durable runtime state.",
	},
	agent: {
		useWhen: ["Worker readiness, circuit state, or outbox backlog must be inspected."],
		avoidWhen: ["A specific delivery payload rather than aggregate health is needed."],
		prerequisites: [],
		verifyWith: [],
		related: ["webhooks.dlq.list", "webhooks.reconcile"],
		retryGuidance: "Retrying the same health read is safe.",
	},
	projection: {
		mcpName: "listmonk_webhooks_runtime_status",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookRuntimeStatusOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookRuntimeStatusOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookRuntimeStatusOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookRuntimeStatusOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookRuntimeStatusOperation:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const webhookInboundIngestOperationSpec = defineOperationSpec({
	id: "webhooks.inbound.ingest",
	resource: "webhook",
	verb: "ingest",
	title: "Ingest normalized provider delivery event",
	description:
		"Normalize a verified provider delivery event into the shared versioned event envelope and durable outbox; unsubscribe events require a subscriber UUID and metadata is limited to 16 KiB.",
	contract: {
		input: webhookInboundIngestInputContract,
		output: webhookInboundIngestOutputContract,
	},
	effects: [{ kind: "write", resource: "webhook", reversible: true }],
	policy: { confirmation: "never", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason:
			"Stable provider event IDs produce deterministic event IDs and duplicate outbox rows are ignored.",
	},
	agent: {
		useWhen: ["A verified provider event must enter the shared event stream."],
		avoidWhen: [
			"The raw provider payload has not been authenticated or normalized.",
			"An unsubscribe event cannot be resolved to a subscriber UUID.",
		],
		prerequisites: [],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.runtime.status", "webhooks.dlq.list"],
		retryGuidance:
			"Retry with the same provider and provider_event_id; ingestion is idempotent.",
	},
	projection: {
		mcpName: "listmonk_webhooks_inbound_ingest",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookInboundIngestOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookInboundIngestOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookInboundIngestOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookInboundIngestOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookInboundIngestOperation:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const webhookDlqListOperationSpec = defineOperationSpec({
	id: "webhooks.dlq.list",
	resource: "webhook",
	verb: "list",
	title: "List outbound webhook dead letters",
	description: "List exhausted delivery records that require operator review.",
	contract: {
		input: webhookDlqListInputContract,
		output: webhookDlqListOutputContract,
	},
	effects: [{ kind: "read", resource: "webhook" }],
	policy: { confirmation: "never", audit: "optional", dryRun: false },
	retry: { kind: "safe", reason: "The operation only reads exhausted deliveries." },
	agent: {
		useWhen: ["Exhausted deliveries must be reviewed before replay."],
		avoidWhen: ["Active retry or pending delivery state is needed."],
		prerequisites: [],
		verifyWith: [],
		related: ["webhooks.dlq.replay", "webhooks.runtime.status"],
		retryGuidance: "Retrying the same read is safe.",
	},
	projection: {
		mcpName: "listmonk_webhooks_dlq_list",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookDlqListOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookDlqListOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookDlqListOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookDlqListOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookDlqListOperation:function",
		},
	},
	stability: "stable",
	since: "0.8.0",
});

export const webhookDlqReplayOperationSpec = defineOperationSpec({
	id: "webhooks.dlq.replay",
	resource: "webhook",
	verb: "replay",
	title: "Replay outbound webhook dead letters",
	description:
		"Preview or requeue a bounded set of reviewed dead-letter deliveries.",
	contract: {
		input: webhookDlqReplayInputContract,
		output: webhookDlqReplayOutputContract,
	},
	effects: [
		{
			kind: "maintenance",
			resource: "webhook",
			action: "replay",
			destructive: true,
		},
	],
	policy: { confirmation: "required", audit: "required", dryRun: true },
	retry: {
		kind: "reconcile",
		reconcileWith: "webhooks.dlq.list",
		idempotent: false,
		reason:
			"Replayed deliveries leave the dead-letter set, so inspect state after an ambiguous result.",
	},
	agent: {
		useWhen: ["Reviewed dead letters should receive a fresh bounded attempt cycle."],
		avoidWhen: ["The endpoint remains unhealthy or its circuit remains open."],
		prerequisites: ["webhooks.dlq.list", "webhooks.runtime.status"],
		verifyWith: ["webhooks.delivery.list"],
		related: ["webhooks.circuit.reset", "webhooks.dispatch"],
		retryGuidance:
			"Run dry_run first and list dead letters after an ambiguous replay.",
	},
	projection: {
		mcpName: "listmonk_webhooks_dlq_replay",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookDlqReplayOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookDlqReplayOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookDlqReplayOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookDlqReplayOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookDlqReplayOperation:function",
		},
	},
	stability: "experimental",
	since: "0.8.0",
});

export const webhookCircuitResetOperationSpec = defineOperationSpec({
	id: "webhooks.circuit.reset",
	resource: "webhook",
	verb: "reset",
	title: "Reset outbound webhook circuit breaker",
	description:
		"Close one endpoint circuit after the operator has corrected its failure.",
	contract: {
		input: webhookCircuitResetInputContract,
		output: webhookCircuitResetOutputContract,
	},
	effects: [{ kind: "write", resource: "webhook", reversible: false }],
	policy: { confirmation: "required", audit: "required", dryRun: false },
	retry: {
		kind: "safe",
		reason: "Resetting an already closed circuit is an idempotent no-op.",
	},
	agent: {
		useWhen: ["An endpoint failure has been fixed and delivery may resume."],
		avoidWhen: ["The endpoint has not been tested or remains unhealthy."],
		prerequisites: ["webhooks.runtime.status", "webhooks.test"],
		verifyWith: ["webhooks.runtime.status"],
		related: ["webhooks.dlq.replay", "webhooks.dispatch"],
		retryGuidance: "Retrying the same reset is safe.",
	},
	projection: {
		mcpName: "listmonk_webhooks_circuit_reset",
		openWorld: false,
		graph: {
			descriptorNode:
				"packages/operations/src/specs/webhooks.ts#webhookCircuitResetOperationSpec:variable",
			bindingNode:
				"packages/operations/src/specs/webhooks.ts#bindWebhookCircuitResetOperationSpec:function",
			runtimeDefinitionNode:
				"packages/automation/src/webhook-operations.ts#webhookCircuitResetOperation:variable",
			invokerNode:
				"packages/automation/src/webhook-operations.ts#invokeWebhookCircuitResetOperation:function",
			executorNode:
				"packages/automation/src/webhook-operations.ts#executeWebhookCircuitResetOperation:function",
		},
	},
	stability: "stable",
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
	webhookReconcileOperationSpec,
	webhookPruneOperationSpec,
	webhookTickOperationSpec,
	webhookRuntimeStatusOperationSpec,
	webhookInboundIngestOperationSpec,
	webhookDlqListOperationSpec,
	webhookDlqReplayOperationSpec,
	webhookCircuitResetOperationSpec,
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

export function bindWebhookReconcileOperationSpec(): typeof webhookReconcileOperationSpec {
	return webhookReconcileOperationSpec;
}

export function bindWebhookPruneOperationSpec(): typeof webhookPruneOperationSpec {
	return webhookPruneOperationSpec;
}

export function bindWebhookTickOperationSpec(): typeof webhookTickOperationSpec {
	return webhookTickOperationSpec;
}

export function bindWebhookRuntimeStatusOperationSpec(): typeof webhookRuntimeStatusOperationSpec {
	return webhookRuntimeStatusOperationSpec;
}

export function bindWebhookInboundIngestOperationSpec(): typeof webhookInboundIngestOperationSpec {
	return webhookInboundIngestOperationSpec;
}

export function bindWebhookDlqListOperationSpec(): typeof webhookDlqListOperationSpec {
	return webhookDlqListOperationSpec;
}

export function bindWebhookDlqReplayOperationSpec(): typeof webhookDlqReplayOperationSpec {
	return webhookDlqReplayOperationSpec;
}

export function bindWebhookCircuitResetOperationSpec(): typeof webhookCircuitResetOperationSpec {
	return webhookCircuitResetOperationSpec;
}
