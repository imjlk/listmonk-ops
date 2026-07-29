import {
	invokeWebhookCreateOperation,
	invokeWebhookDeleteOperation,
	invokeWebhookDeliveryListOperation,
	invokeWebhookDeliveryRetryOperation,
	invokeWebhookDispatchOperation,
	invokeWebhookListOperation,
	invokeWebhookPruneOperation,
	invokeWebhookReconcileOperation,
	invokeWebhookTestOperation,
	invokeWebhookTickOperation,
	invokeWebhookUpdateOperation,
	OUTBOUND_WEBHOOK_EVENT_TYPES,
	OUTBOUND_WEBHOOK_SECRET_REF_PATTERN,
} from "@listmonk-ops/automation";
import { z } from "zod";
import { defineCommand, defineGroup, option } from "../lib/command";
import { getOutput } from "../lib/output";

function parseEventFilters(value: string): string[] {
	const filters = value
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);
	if (filters.length === 0) {
		throw new Error("Expected one or more comma-separated event filters");
	}
	return filters;
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
	},
	handler: async ({ flags }) => {
		getOutput().json(
			await invokeWebhookTickOperation(
				{},
				{
					dispatch_limit: flags["dispatch-limit"],
					reconcile_limit: flags["reconcile-limit"],
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
		deliveriesGroup,
	],
});
