import {
	invokeWebhookCreateOperation,
	invokeWebhookDeleteOperation,
	invokeWebhookDeliveryListOperation,
	invokeWebhookDeliveryRetryOperation,
	invokeWebhookDlqListOperation,
	invokeWebhookDlqReplayOperation,
	invokeWebhookDispatchOperation,
	invokeWebhookInboundIngestOperation,
	invokeWebhookListOperation,
	invokeWebhookPruneOperation,
	invokeWebhookReconcileOperation,
	invokeWebhookTestOperation,
	invokeWebhookTickOperation,
	invokeWebhookRuntimeStatusOperation,
	invokeWebhookCircuitResetOperation,
	invokeWebhookUpdateOperation,
	INBOUND_DELIVERY_EVENT_KINDS,
	OUTBOUND_WEBHOOK_EVENT_TYPES,
	OUTBOUND_WEBHOOK_SECRET_REF_PATTERN,
	runOutboundWebhookWorker,
	getOutboundWebhookStoreOptionsFromEnvironment,
} from "@listmonk-ops/automation";
import { z } from "zod";
import { defineCommand, defineGroup, option } from "../lib/command";
import { getOutput } from "../lib/output";

function parseCommaSeparatedList(value: string, label: string): string[] {
	const entries = value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (entries.length === 0) {
		throw new Error(`Expected one or more comma-separated ${label}`);
	}
	return entries;
}

function parseEventFilters(value: string): string[] {
	return parseCommaSeparatedList(value, "event filters");
}

function parseDeliveryIds(value: string): string[] {
	return parseCommaSeparatedList(value, "delivery ids");
}

function parseJsonObject(value: string | undefined): Record<string, unknown> {
	if (value === undefined) {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new TypeError("--metadata must contain a valid JSON object");
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed)
	) {
		throw new TypeError("--metadata must contain a JSON object");
	}
	return parsed as Record<string, unknown>;
}

const listCommand = defineCommand({
	name: "list",
	description: "List outbound webhook endpoints",
	operationId: "webhooks.list",
	options: {
		enabled: option(z.coerce.boolean().optional(), {
			description: "Filter by enabled state",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(await invokeWebhookListOperation({}, flags));
	},
});

const createCommand = defineCommand({
	name: "create",
	description: "Create an HTTPS outbound webhook endpoint",
	operationId: "webhooks.create",
	options: {
		name: option(z.string().trim().min(1), {
			description: "Unique endpoint name",
		}),
		url: option(z.url(), {
			description: "Public HTTPS endpoint URL",
		}),
		"secret-ref": option(
			z.string().trim().regex(OUTBOUND_WEBHOOK_SECRET_REF_PATTERN),
			{
				description:
					"Environment variable containing the HMAC signing secret",
			},
		),
		"event-filters": option(z.string().trim().min(1), {
			description:
				"Comma-separated exact types or wildcards (for example operation.*)",
		}),
		enabled: option(z.coerce.boolean().default(true), {
			description: "Enable the endpoint immediately",
		}),
		"timeout-ms": option(z.coerce.number().int().min(100).max(30_000).default(10_000), {
			description: "Per-request timeout in milliseconds",
		}),
		"max-attempts": option(z.coerce.number().int().min(1).max(12).default(6), {
			description: "Maximum automatic delivery attempts",
		}),
		"circuit-failure-threshold": option(
			z.coerce.number().int().min(1).max(100).default(5),
			{ description: "Consecutive failures before opening the circuit" },
		),
		"circuit-cooldown-ms": option(
			z.coerce.number().int().min(1_000).max(86_400_000).default(300_000),
			{ description: "Circuit cooldown in milliseconds" },
		),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookCreateOperation(
				{},
				{
					name: flags.name,
					url: flags.url,
					secret_ref: flags["secret-ref"],
					event_filters: parseEventFilters(flags["event-filters"]),
					enabled: flags.enabled,
					timeout_ms: flags["timeout-ms"],
					max_attempts: flags["max-attempts"],
					circuit_failure_threshold: flags["circuit-failure-threshold"],
					circuit_cooldown_ms: flags["circuit-cooldown-ms"],
				},
			),
		);
	},
});

const updateCommand = defineCommand({
	name: "update",
	description: "Update an outbound webhook endpoint",
	operationId: "webhooks.update",
	options: {
		id: option(z.uuid(), { description: "Endpoint ID" }),
		name: option(z.string().trim().min(1).optional(), {
			description: "New endpoint name",
		}),
		url: option(z.url().optional(), {
			description: "New public HTTPS URL",
		}),
		"secret-ref": option(
			z
				.string()
				.trim()
				.regex(OUTBOUND_WEBHOOK_SECRET_REF_PATTERN)
				.optional(),
			{
				description: "New signing-secret environment variable",
			},
		),
		"event-filters": option(z.string().trim().min(1).optional(), {
			description: "New comma-separated event filters",
		}),
		enabled: option(z.coerce.boolean().optional(), {
			description: "Enable or disable the endpoint",
		}),
		"timeout-ms": option(
			z.coerce.number().int().min(100).max(30_000).optional(),
			{ description: "New request timeout in milliseconds" },
		),
		"max-attempts": option(
			z.coerce.number().int().min(1).max(12).optional(),
			{ description: "New maximum attempt count" },
		),
		"circuit-failure-threshold": option(
			z.coerce.number().int().min(1).max(100).optional(),
			{ description: "New consecutive failure threshold" },
		),
		"circuit-cooldown-ms": option(
			z.coerce.number().int().min(1_000).max(86_400_000).optional(),
			{ description: "New circuit cooldown in milliseconds" },
		),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookUpdateOperation(
				{},
				{
					id: flags.id,
					name: flags.name,
					url: flags.url,
					secret_ref: flags["secret-ref"],
					event_filters: flags["event-filters"]
						? parseEventFilters(flags["event-filters"])
						: undefined,
					enabled: flags.enabled,
					timeout_ms: flags["timeout-ms"],
					max_attempts: flags["max-attempts"],
					circuit_failure_threshold: flags["circuit-failure-threshold"],
					circuit_cooldown_ms: flags["circuit-cooldown-ms"],
				},
			),
		);
	},
});

const deleteCommand = defineCommand({
	name: "delete",
	description: "Delete an endpoint and exhaust unfinished deliveries",
	operationId: "webhooks.delete",
	options: {
		id: option(z.uuid(), { description: "Endpoint ID" }),
	},
	handler: async ({ flags }) => {
		getOutput().json(await invokeWebhookDeleteOperation({}, flags));
	},
});

const testCommand = defineCommand({
	name: "test",
	description: "Send one signed webhook.test event",
	operationId: "webhooks.test",
	options: {
		id: option(z.uuid(), { description: "Endpoint ID" }),
		"correlation-id": option(z.string().trim().min(1).optional(), {
			description: "Optional correlation identifier",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookTestOperation(
				{},
				{
					id: flags.id,
					correlation_id: flags["correlation-id"],
				},
			),
		);
	},
});

const dispatchCommand = defineCommand({
	name: "dispatch",
	description: "Deliver due outbound webhook outbox records",
	operationId: "webhooks.dispatch",
	options: {
		limit: option(z.coerce.number().int().min(1).max(100).default(25), {
			description: "Maximum deliveries to claim",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(await invokeWebhookDispatchOperation({}, flags));
	},
});

const reconcileCommand = defineCommand({
	name: "reconcile",
	description: "Preview or recover expired outbound webhook worker leases",
	operationId: "webhooks.reconcile",
	options: {
		limit: option(z.coerce.number().int().min(1).max(1_000).default(100), {
			description: "Maximum delivering records to inspect",
		}),
		"dry-run": option(z.coerce.boolean().default(true), {
			description: "Report lease repairs without changing delivery state",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookReconcileOperation(
				{},
				{
					limit: flags.limit,
					dry_run: flags["dry-run"],
				},
			),
		);
	},
});

const pruneCommand = defineCommand({
	name: "prune",
	description: "Preview or delete old terminal webhook delivery history",
	operationId: "webhooks.prune",
	options: {
		"older-than-days": option(
			z.coerce.number().int().min(1).max(3_650).default(30),
			{ description: "Retention age in days" },
		),
		before: option(z.iso.datetime({ offset: true }).optional(), {
			description:
				"Explicit retention cutoff (takes precedence over --older-than-days) so retries reuse the exact confirmed deletion window",
		}),
		ids: option(z.string().trim().min(1).optional(), {
			description:
				"Comma-separated exact delivery ids a dry run reported; required with --no-dry-run",
		}),
		limit: option(z.coerce.number().int().min(1).max(1_000).default(100), {
			description: "Maximum terminal records to inspect or delete",
		}),
		"dry-run": option(z.coerce.boolean().default(true), {
			description: "Report eligible records without deleting them",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookPruneOperation(
				{},
				{
					older_than_days: flags["older-than-days"],
					before: flags.before,
					ids: flags.ids ? parseDeliveryIds(flags.ids) : undefined,
					limit: flags.limit,
					dry_run: flags["dry-run"],
				},
			),
		);
	},
});

const tickCommand = defineCommand({
	name: "tick",
	description: "Recover expired leases and deliver one bounded outbox batch",
	operationId: "webhooks.tick",
	options: {
		"dispatch-limit": option(
			z.coerce.number().int().min(1).max(100).default(25),
			{ description: "Maximum due deliveries to claim" },
		),
		"reconcile-limit": option(
			z.coerce.number().int().min(1).max(1_000).default(100),
			{ description: "Maximum delivering records to reconcile first" },
		),
		"recovery-set": option(z.string().optional(), {
			description:
				"Echoed claim set from a prior tick (JSON array of delivery_id and attempt_count pairs): recover exactly these deliveries at their originally claimed attempt counts instead of claiming new due work",
		}),
	},
	handler: async ({ flags }) => {
		let recoverySet:
			| Array<{ delivery_id: string; attempt_count: number }>
			| undefined;
		if (flags["recovery-set"] !== undefined) {
			try {
				recoverySet = JSON.parse(flags["recovery-set"]);
			} catch (error) {
				throw new Error(
					`--recovery-set must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		getOutput().json(
			await invokeWebhookTickOperation(
				{},
				{
					dispatch_limit: flags["dispatch-limit"],
					reconcile_limit: flags["reconcile-limit"],
					recovery_set: recoverySet,
				},
			),
		);
	},
});

const deliveryListCommand = defineCommand({
	name: "list",
	description: "List redacted outbound webhook delivery records",
	operationId: "webhooks.delivery.list",
	options: {
		"endpoint-id": option(z.uuid().optional(), {
			description: "Filter by endpoint ID",
		}),
		status: option(
			z
				.enum(["pending", "delivering", "retry", "succeeded", "exhausted"])
				.optional(),
			{ description: "Filter by delivery status" },
		),
		"event-type": option(z.enum(OUTBOUND_WEBHOOK_EVENT_TYPES).optional(), {
			description: "Filter by event type",
		}),
		limit: option(z.coerce.number().int().min(1).max(1_000).default(100), {
			description: "Maximum records",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookDeliveryListOperation(
				{},
				{
					endpoint_id: flags["endpoint-id"],
					status: flags.status,
					event_type: flags["event-type"],
					limit: flags.limit,
				},
			),
		);
	},
});

const deliveryRetryCommand = defineCommand({
	name: "retry",
	description: "Requeue one retryable or exhausted delivery",
	operationId: "webhooks.delivery.retry",
	options: {
		id: option(z.uuid(), { description: "Delivery ID" }),
	},
	handler: async ({ flags }) => {
		getOutput().json(await invokeWebhookDeliveryRetryOperation({}, flags));
	},
});

const runtimeStatusCommand = defineCommand({
	name: "status",
	description: "Inspect durable outbox, circuit, DLQ, and worker health",
	operationId: "webhooks.runtime.status",
	options: {
		"worker-stale-ms": option(
			z.coerce.number().int().min(1_000).max(86_400_000).default(90_000),
			{ description: "Heartbeat age considered stale" },
		),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookRuntimeStatusOperation(
				{},
				{ worker_stale_ms: flags["worker-stale-ms"] },
			),
		);
	},
});

const runtimeWorkerCommand = defineCommand({
	name: "worker",
	description: "Run the long-lived lease-safe outbound webhook worker",
	options: {
		"interval-ms": option(
			z.coerce.number().int().min(250).max(90_000).default(5_000),
			{ description: "Delay between worker ticks" },
		),
		"dispatch-limit": option(
			z.coerce.number().int().min(1).max(100).default(25),
			{ description: "Maximum deliveries per tick" },
		),
		"reconcile-limit": option(
			z.coerce.number().int().min(1).max(1_000).default(100),
			{ description: "Maximum expired leases per tick" },
		),
	},
	handler: async ({ flags }) => {
		if (flags.confirm !== true) {
			throw new Error(
				"The long-lived worker sends external webhooks; rerun with --confirm",
			);
		}
		const controller = new AbortController();
		const stop = () => controller.abort();
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		try {
			getOutput().info(
				"Outbound webhook worker started; press Ctrl+C for graceful shutdown",
			);
			getOutput().json(
				await runOutboundWebhookWorker({
					store: getOutboundWebhookStoreOptionsFromEnvironment(),
					signal: controller.signal,
					intervalMs: flags["interval-ms"],
					dispatchLimit: flags["dispatch-limit"],
					reconcileLimit: flags["reconcile-limit"],
					onTick: ({ dispatch, completedAt }) => {
						getOutput().info(
							`Webhook tick completed at ${completedAt}: ${dispatch.claimed} claimed, ${dispatch.succeeded} succeeded, ${dispatch.retried} retried, ${dispatch.exhausted} exhausted`,
						);
					},
					onTickError: ({
						error,
						consecutiveFailures,
						retryInMs,
					}) => {
						getOutput().warning(
							`Webhook tick failed (${consecutiveFailures} consecutive); retrying in ${retryInMs}ms: ${error}`,
						);
					},
				}),
			);
		} finally {
			process.off("SIGINT", stop);
			process.off("SIGTERM", stop);
		}
	},
});

const runtimeGroup = defineGroup({
	name: "runtime",
	description: "Inspect and run the durable webhook runtime",
	commands: [runtimeStatusCommand, runtimeWorkerCommand],
});

const inboundIngestCommand = defineCommand({
	name: "ingest",
	description: "Normalize a verified provider event into the shared outbox",
	operationId: "webhooks.inbound.ingest",
	options: {
		provider: option(z.string().trim().min(1), {
			description: "Provider identifier such as ses or postmark",
		}),
		"provider-event-id": option(z.string().trim().min(1).max(200), {
			description: "Stable provider event identifier",
		}),
		kind: option(z.enum(INBOUND_DELIVERY_EVENT_KINDS), {
			description: "Normalized delivery event kind",
		}),
		"occurred-at": option(z.iso.datetime({ offset: true }).optional(), {
			description: "Provider event timestamp",
		}),
		"message-id": option(z.string().trim().min(1).optional(), {
			description: "Provider message identifier",
		}),
		"subscriber-uuid": option(z.uuid().optional(), {
			description: "Listmonk subscriber UUID when known",
		}),
		"campaign-id": option(z.coerce.number().int().positive().optional(), {
			description: "Listmonk campaign ID when known",
		}),
		metadata: option(z.string().optional(), {
			description: "Additional JSON object; sensitive keys are redacted",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookInboundIngestOperation(
				{},
				{
					provider: flags.provider,
					provider_event_id: flags["provider-event-id"],
					kind: flags.kind,
					occurred_at: flags["occurred-at"],
					message_id: flags["message-id"],
					subscriber_uuid: flags["subscriber-uuid"],
					campaign_id: flags["campaign-id"],
					metadata: parseJsonObject(flags.metadata),
				},
			),
		);
	},
});

const inboundGroup = defineGroup({
	name: "inbound",
	description: "Ingest normalized provider delivery events",
	commands: [inboundIngestCommand],
});

const dlqListCommand = defineCommand({
	name: "list",
	description: "List exhausted webhook deliveries",
	operationId: "webhooks.dlq.list",
	options: {
		"endpoint-id": option(z.uuid().optional(), {
			description: "Filter by endpoint ID",
		}),
		limit: option(z.coerce.number().int().min(1).max(1_000).default(100), {
			description: "Maximum dead letters",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookDlqListOperation(
				{},
				{ endpoint_id: flags["endpoint-id"], limit: flags.limit },
			),
		);
	},
});

const dlqReplayCommand = defineCommand({
	name: "replay",
	description: "Preview or requeue reviewed dead-letter deliveries",
	operationId: "webhooks.dlq.replay",
	options: {
		"endpoint-id": option(z.uuid().optional(), {
			description: "Filter by endpoint ID",
		}),
		"delivery-ids": option(z.string().trim().min(1).optional(), {
			description:
				"Comma-separated exact dead-letter ids a dry run reported; required with --no-dry-run",
		}),
		limit: option(z.coerce.number().int().min(1).max(1_000).default(100), {
			description: "Maximum dead letters",
		}),
		"dry-run": option(z.coerce.boolean().default(true), {
			description: "Preview without requeueing",
		}),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookDlqReplayOperation(
				{},
				{
					endpoint_id: flags["endpoint-id"],
					delivery_ids: flags["delivery-ids"]
						? parseDeliveryIds(flags["delivery-ids"])
						: undefined,
					limit: flags.limit,
					dry_run: flags["dry-run"],
				},
			),
		);
	},
});

const dlqGroup = defineGroup({
	name: "dlq",
	description: "Inspect and replay dead-letter deliveries",
	commands: [dlqListCommand, dlqReplayCommand],
});

const circuitResetCommand = defineCommand({
	name: "reset",
	description: "Close one endpoint circuit after correcting the failure",
	operationId: "webhooks.circuit.reset",
	options: {
		id: option(z.uuid(), { description: "Endpoint ID" }),
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookCircuitResetOperation({}, { id: flags.id }),
		);
	},
});

const circuitGroup = defineGroup({
	name: "circuit",
	description: "Manage endpoint circuit breakers",
	commands: [circuitResetCommand],
});

const deliveriesGroup = defineGroup({
	name: "deliveries",
	description: "Inspect and manage outbound webhook delivery records",
	commands: [deliveryListCommand, deliveryRetryCommand],
});

export default defineGroup({
	name: "webhooks",
	description: "Manage signed outbound event webhooks and their outbox",
	commands: [
		listCommand,
		createCommand,
		updateCommand,
		deleteCommand,
		testCommand,
		dispatchCommand,
		reconcileCommand,
		pruneCommand,
		tickCommand,
		runtimeGroup,
		inboundGroup,
		dlqGroup,
		circuitGroup,
		deliveriesGroup,
	],
});
