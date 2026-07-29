import {
	defineOperation,
	defineOperationCatalog,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "@listmonk-ops/operations";
import {
	bindWebhookCreateOperationSpec,
	bindWebhookDeleteOperationSpec,
	bindWebhookDeliveryListOperationSpec,
	bindWebhookDeliveryRetryOperationSpec,
	bindWebhookDispatchOperationSpec,
	bindWebhookListOperationSpec,
	bindWebhookTestOperationSpec,
	bindWebhookUpdateOperationSpec,
} from "@listmonk-ops/operations/specs";
import { z } from "zod";
import {
	createOutboundWebhookEndpoint,
	deleteOutboundWebhookEndpoint,
	dispatchOutboundWebhooks,
	enqueueOutboundWebhookEvent,
	getOutboundWebhookEndpoint,
	listOutboundWebhookDeliveries,
	listOutboundWebhookEndpoints,
	normalizeOutboundWebhookEndpointUrl,
	OUTBOUND_WEBHOOK_EVENT_TYPES,
	OUTBOUND_WEBHOOK_SECRET_REF_PATTERN,
	retryOutboundWebhookDelivery,
	type OutboundWebhookDelivery,
	type OutboundWebhookEndpoint,
	type OutboundWebhookStoreOptions,
	updateOutboundWebhookEndpoint,
} from "./outbound-webhooks";

export interface WebhookOperationContext {
	store?: OutboundWebhookStoreOptions;
	fetcher?: typeof fetch;
	resolveSecret?: (secretRef: string) => string | undefined;
}

const booleanInput = z.preprocess((value: unknown) => {
	if (typeof value !== "string") {
		return value;
	}
	if (value.toLowerCase() === "true") {
		return true;
	}
	if (value.toLowerCase() === "false") {
		return false;
	}
	return value;
}, z.boolean());
const positiveIntegerInput = z.preprocess(
	(value: unknown) =>
		value === null || value === "" || typeof value === "boolean"
			? Number.NaN
			: value,
	z.coerce.number().int().positive(),
);
const endpointIdInput = z.uuid().describe("Outbound webhook endpoint ID");
const eventFilterInput = z
	.string()
	.trim()
	.min(1)
	.describe("Exact event type, family wildcard such as operation.*, or *");
const eventTypeInput = z.enum(OUTBOUND_WEBHOOK_EVENT_TYPES);
const deliveryStatusInput = z.enum([
	"pending",
	"delivering",
	"retry",
	"succeeded",
	"exhausted",
]);
const endpointUrlInput = z.url().superRefine((value, context) => {
	try {
		normalizeOutboundWebhookEndpointUrl(value);
	} catch (error) {
		context.addIssue({
			code: "custom",
			message:
				error instanceof Error
					? error.message
					: "Invalid outbound webhook URL",
		});
	}
});
const webhookTimeoutInput = positiveIntegerInput.refine(
	(value) => value >= 100 && value <= 30_000,
	"timeout_ms must be between 100 and 30000",
);
const webhookMaxAttemptsInput = positiveIntegerInput.refine(
	(value) => value <= 12,
	"max_attempts must be between 1 and 12",
);
const webhookDispatchLimitInput = positiveIntegerInput.refine(
	(value) => value <= 100,
	"Dispatch limit must be between 1 and 100",
);
const webhookDeliveryListLimitInput = positiveIntegerInput.refine(
	(value) => value <= 1_000,
	"Delivery list limit must be between 1 and 1000",
);

const webhookListInputSchema = z.object({
	enabled: booleanInput.optional().describe("Filter by enabled state"),
});
const webhookCreateInputSchema = z.object({
	name: z.string().trim().min(1).max(120),
	url: endpointUrlInput.describe(
		"Public HTTPS endpoint without credentials, query, or fragment",
	),
	secret_ref: z
		.string()
		.trim()
		.regex(
			OUTBOUND_WEBHOOK_SECRET_REF_PATTERN,
			"secret_ref must be LISTMONK_OPS_WEBHOOK_SECRET or use its dedicated prefix",
		),
	event_filters: z.array(eventFilterInput).min(1),
	enabled: booleanInput.default(true),
	timeout_ms: webhookTimeoutInput.default(10_000),
	max_attempts: webhookMaxAttemptsInput.default(6),
});
const webhookUpdateInputSchema = z
	.object({
		id: endpointIdInput,
		name: z.string().trim().min(1).max(120).optional(),
		url: endpointUrlInput.optional(),
		secret_ref: z
			.string()
			.trim()
			.regex(
				OUTBOUND_WEBHOOK_SECRET_REF_PATTERN,
				"secret_ref must be LISTMONK_OPS_WEBHOOK_SECRET or use its dedicated prefix",
			)
			.optional(),
		event_filters: z.array(eventFilterInput).min(1).optional(),
		enabled: booleanInput.optional(),
		timeout_ms: webhookTimeoutInput.optional(),
		max_attempts: webhookMaxAttemptsInput.optional(),
	})
	.refine(
		(input) =>
			Object.keys(input).some((key) => key !== "id"),
		"At least one endpoint field must be provided",
	);
const webhookDeleteInputSchema = z.object({ id: endpointIdInput });
const webhookTestInputSchema = z.object({
	id: endpointIdInput,
	correlation_id: z.string().trim().min(1).max(200).optional(),
});
const webhookDispatchInputSchema = z.object({
	limit: webhookDispatchLimitInput.default(25),
});
const webhookDeliveryListInputSchema = z.object({
	endpoint_id: endpointIdInput.optional(),
	status: deliveryStatusInput.optional(),
	event_type: eventTypeInput.optional(),
	limit: webhookDeliveryListLimitInput.default(100),
});
const webhookDeliveryRetryInputSchema = z.object({
	id: z.uuid().describe("Outbound webhook delivery ID"),
});

const webhookEndpointOutputSchema = z.object({
	id: z.uuid(),
	name: z.string(),
	url: z.url(),
	secret_ref: z.string(),
	event_filters: z.array(z.string()),
	enabled: z.boolean(),
	timeout_ms: z.number().int().positive(),
	max_attempts: z.number().int().positive(),
	created_at: z.iso.datetime({ offset: true }),
	updated_at: z.iso.datetime({ offset: true }),
});
const webhookListOutputSchema = z.object({
	endpoints: z.array(webhookEndpointOutputSchema),
});
const webhookCreateOutputSchema = z.object({
	endpoint: webhookEndpointOutputSchema,
});
const webhookUpdateOutputSchema = z.object({
	endpoint: webhookEndpointOutputSchema,
});
const webhookDeleteOutputSchema = z.object({
	deleted: z.literal(true),
	endpoint: webhookEndpointOutputSchema,
});
const dispatchResultIdentitySchema = {
	delivery_id: z.uuid(),
	endpoint_id: z.uuid(),
};
const dispatchResultSchema = z.discriminatedUnion("status", [
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("succeeded"),
		status_code: z.number().int().min(100).max(599).optional(),
		error: z.string().optional(),
	}),
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("retry"),
		status_code: z.number().int().min(100).max(599).optional(),
		error: z.string().optional(),
	}),
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("exhausted"),
		status_code: z.number().int().min(100).max(599).optional(),
		error: z.string().optional(),
	}),
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("skipped"),
		error: z.string().min(1),
	}),
]);
const webhookDispatchOutputSchema = z.object({
	claimed: z.number().int().nonnegative(),
	succeeded: z.number().int().nonnegative(),
	retried: z.number().int().nonnegative(),
	exhausted: z.number().int().nonnegative(),
	skipped: z.number().int().nonnegative(),
	results: z.array(dispatchResultSchema),
});
const webhookTestOutputSchema = z.object({
	event_id: z.uuid(),
	delivery_id: z.uuid().optional(),
	dispatch: webhookDispatchOutputSchema,
});
const webhookEventSummarySchema = z.object({
	id: z.uuid(),
	type: eventTypeInput,
	schema_version: z.number().int().positive(),
	occurred_at: z.iso.datetime({ offset: true }),
	source: z.enum([
		"listmonk",
		"provider",
		"operation",
		"abtest",
		"sequence",
		"webhook",
	]),
	correlation_id: z.string().optional(),
	subject: z
		.object({
			kind: z.enum([
				"operation",
				"campaign",
				"subscriber",
				"message",
				"experiment",
				"webhook",
			]),
			key: z.string(),
		})
		.optional(),
});
const webhookDeliveryOutputSchema = z.object({
	id: z.uuid(),
	event_id: z.uuid(),
	endpoint_id: z.uuid(),
	event: webhookEventSummarySchema,
	status: deliveryStatusInput,
	attempt_count: z.number().int().nonnegative(),
	manual_retry_count: z.number().int().nonnegative(),
	next_attempt_at: z.iso.datetime({ offset: true }),
	last_attempt_at: z.iso.datetime({ offset: true }).optional(),
	completed_at: z.iso.datetime({ offset: true }).optional(),
	status_code: z.number().int().min(100).max(599).optional(),
	last_error: z.string().optional(),
});
const webhookDeliveryListOutputSchema = z.object({
	deliveries: z.array(webhookDeliveryOutputSchema),
});
const webhookDeliveryRetryOutputSchema = z.object({
	delivery: webhookDeliveryOutputSchema,
});

function toEndpointOutput(endpoint: OutboundWebhookEndpoint) {
	return {
		id: endpoint.id,
		name: endpoint.name,
		url: endpoint.url,
		secret_ref: endpoint.secretRef,
		event_filters: [...endpoint.eventFilters],
		enabled: endpoint.enabled,
		timeout_ms: endpoint.timeoutMs,
		max_attempts: endpoint.maxAttempts,
		created_at: endpoint.createdAt,
		updated_at: endpoint.updatedAt,
	};
}

function toDeliveryOutput(delivery: OutboundWebhookDelivery) {
	return {
		id: delivery.id,
		event_id: delivery.eventId,
		endpoint_id: delivery.endpointId,
		event: {
			id: delivery.event.id,
			type: delivery.event.type,
			schema_version: delivery.event.schemaVersion,
			occurred_at: delivery.event.occurredAt,
			source: delivery.event.source,
			correlation_id: delivery.event.correlationId,
			subject: delivery.event.subject,
		},
		status: delivery.status,
		attempt_count: delivery.attemptCount,
		manual_retry_count: delivery.manualRetryCount,
		next_attempt_at: delivery.nextAttemptAt,
		last_attempt_at: delivery.lastAttemptAt,
		completed_at: delivery.completedAt,
		status_code: delivery.statusCode,
		last_error: delivery.lastError,
	};
}

function toDispatchOutput(
	result: Awaited<ReturnType<typeof dispatchOutboundWebhooks>>,
) {
	return {
		claimed: result.claimed,
		succeeded: result.succeeded,
		retried: result.retried,
		exhausted: result.exhausted,
		skipped: result.skipped,
		results: result.results.map((entry) =>
			entry.status === "skipped"
				? {
						delivery_id: entry.deliveryId,
						endpoint_id: entry.endpointId,
						status: entry.status,
						error: entry.error,
					}
				: {
						delivery_id: entry.deliveryId,
						endpoint_id: entry.endpointId,
						status: entry.status,
						status_code: entry.statusCode,
						error: entry.error,
					},
		),
	};
}

export async function executeWebhookListOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookListInputSchema>,
) {
	const endpoints = await listOutboundWebhookEndpoints(context.store);
	return {
		endpoints: endpoints
			.filter(
				(endpoint) =>
					input.enabled === undefined || endpoint.enabled === input.enabled,
			)
			.map(toEndpointOutput),
	};
}

export async function executeWebhookCreateOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookCreateInputSchema>,
) {
	const endpoint = await createOutboundWebhookEndpoint(
		{
			name: input.name,
			url: input.url,
			secretRef: input.secret_ref,
			eventFilters: input.event_filters,
			enabled: input.enabled,
			timeoutMs: input.timeout_ms,
			maxAttempts: input.max_attempts,
		},
		context.store,
	);
	return { endpoint: toEndpointOutput(endpoint) };
}

export async function executeWebhookUpdateOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookUpdateInputSchema>,
) {
	const endpoint = await updateOutboundWebhookEndpoint(
		input.id,
		{
			name: input.name,
			url: input.url,
			secretRef: input.secret_ref,
			eventFilters: input.event_filters,
			enabled: input.enabled,
			timeoutMs: input.timeout_ms,
			maxAttempts: input.max_attempts,
		},
		context.store,
	);
	return { endpoint: toEndpointOutput(endpoint) };
}

export async function executeWebhookDeleteOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDeleteInputSchema>,
) {
	const endpoint = await deleteOutboundWebhookEndpoint(input.id, context.store);
	return { deleted: true as const, endpoint: toEndpointOutput(endpoint) };
}

export async function executeWebhookTestOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookTestInputSchema>,
) {
	const endpoint = await getOutboundWebhookEndpoint(input.id, context.store);
	const queued = await enqueueOutboundWebhookEvent(
		{
			type: "webhook.test",
			source: "webhook",
			correlationId: input.correlation_id,
			subject: { kind: "webhook", key: endpoint.id },
			data: { endpoint_id: endpoint.id, endpoint_name: endpoint.name },
		},
		{
			...context.store,
			endpointIds: [endpoint.id],
			bypassEventFilters: true,
		},
	);
	const deliveryId = queued.deliveryIds[0];
	const dispatch = await dispatchOutboundWebhooks({
		store: context.store,
		fetcher: context.fetcher,
		resolveSecret: context.resolveSecret,
		deliveryIds: deliveryId ? [deliveryId] : [],
		limit: 1,
	});
	return {
		event_id: queued.event.id,
		delivery_id: deliveryId,
		dispatch: toDispatchOutput(dispatch),
	};
}

export async function executeWebhookDispatchOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDispatchInputSchema>,
) {
	return toDispatchOutput(
		await dispatchOutboundWebhooks({
			store: context.store,
			fetcher: context.fetcher,
			resolveSecret: context.resolveSecret,
			limit: input.limit,
		}),
	);
}

export async function executeWebhookDeliveryListOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDeliveryListInputSchema>,
) {
	const deliveries = await listOutboundWebhookDeliveries({
		...context.store,
		endpointId: input.endpoint_id,
		status: input.status,
		eventType: input.event_type,
		limit: input.limit,
	});
	return { deliveries: deliveries.map(toDeliveryOutput) };
}

export async function executeWebhookDeliveryRetryOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDeliveryRetryInputSchema>,
) {
	const delivery = await retryOutboundWebhookDelivery(input.id, context.store);
	return { delivery: toDeliveryOutput(delivery) };
}

export const webhookListOperation = defineOperation({
	id: "webhooks.list",
	title: "List outbound webhook endpoints",
	description:
		"List configured outbound webhook endpoints without exposing signing secret values.",
	inputSchema: webhookListInputSchema,
	outputSchema: webhookListOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_list" },
	spec: bindWebhookListOperationSpec(),
	execute: executeWebhookListOperation,
});

export const webhookCreateOperation = defineOperation({
	id: "webhooks.create",
	title: "Create outbound webhook endpoint",
	description:
		"Create an HTTPS endpoint using an environment-variable secret reference and typed event filters.",
	inputSchema: webhookCreateInputSchema,
	outputSchema: webhookCreateOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_create" },
	spec: bindWebhookCreateOperationSpec(),
	execute: executeWebhookCreateOperation,
});

export const webhookUpdateOperation = defineOperation({
	id: "webhooks.update",
	title: "Update outbound webhook endpoint",
	description:
		"Update endpoint metadata, delivery policy, enabled state, or event filters without storing a secret value.",
	inputSchema: webhookUpdateInputSchema,
	outputSchema: webhookUpdateOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_update" },
	spec: bindWebhookUpdateOperationSpec(),
	execute: executeWebhookUpdateOperation,
});

export const webhookDeleteOperation = defineOperation({
	id: "webhooks.delete",
	title: "Delete outbound webhook endpoint",
	description:
		"Delete an endpoint and exhaust its unfinished delivery records.",
	inputSchema: webhookDeleteInputSchema,
	outputSchema: webhookDeleteOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_delete" },
	spec: bindWebhookDeleteOperationSpec(),
	execute: executeWebhookDeleteOperation,
});

export const webhookTestOperation = defineOperation({
	id: "webhooks.test",
	title: "Send outbound webhook test",
	description:
		"Queue and immediately send one signed webhook.test event to a selected endpoint.",
	inputSchema: webhookTestInputSchema,
	outputSchema: webhookTestOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_webhooks_test" },
	spec: bindWebhookTestOperationSpec(),
	execute: executeWebhookTestOperation,
});

export const webhookDispatchOperation = defineOperation({
	id: "webhooks.dispatch",
	title: "Dispatch outbound webhooks",
	description:
		"Claim due outbox deliveries and send signed HTTPS requests with bounded retries.",
	inputSchema: webhookDispatchInputSchema,
	outputSchema: webhookDispatchOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_webhooks_dispatch" },
	spec: bindWebhookDispatchOperationSpec(),
	execute: executeWebhookDispatchOperation,
});

export const webhookDeliveryListOperation = defineOperation({
	id: "webhooks.delivery.list",
	title: "List outbound webhook deliveries",
	description:
		"Inspect redacted outbox delivery state, attempts, status codes, and exhausted errors.",
	inputSchema: webhookDeliveryListInputSchema,
	outputSchema: webhookDeliveryListOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhook_deliveries_list" },
	spec: bindWebhookDeliveryListOperationSpec(),
	execute: executeWebhookDeliveryListOperation,
});

export const webhookDeliveryRetryOperation = defineOperation({
	id: "webhooks.delivery.retry",
	title: "Retry outbound webhook delivery",
	description:
		"Requeue one retryable or exhausted delivery for a fresh bounded attempt cycle.",
	inputSchema: webhookDeliveryRetryInputSchema,
	outputSchema: webhookDeliveryRetryOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhook_delivery_retry" },
	spec: bindWebhookDeliveryRetryOperationSpec(),
	execute: executeWebhookDeliveryRetryOperation,
});

export async function invokeWebhookListOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookListOutputSchema>> {
	const parsed = parseOperationInput(webhookListOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			webhookListOperation.id,
			webhookListOperation.outputSchema,
			await executeWebhookListOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookListOperation.id, error);
	}
}

export async function invokeWebhookCreateOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookCreateOutputSchema>> {
	const parsed = parseOperationInput(webhookCreateOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			webhookCreateOperation.id,
			webhookCreateOperation.outputSchema,
			await executeWebhookCreateOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookCreateOperation.id, error);
	}
}

export async function invokeWebhookUpdateOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookUpdateOutputSchema>> {
	const parsed = parseOperationInput(webhookUpdateOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			webhookUpdateOperation.id,
			webhookUpdateOperation.outputSchema,
			await executeWebhookUpdateOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookUpdateOperation.id, error);
	}
}

export async function invokeWebhookDeleteOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookDeleteOutputSchema>> {
	const parsed = parseOperationInput(webhookDeleteOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			webhookDeleteOperation.id,
			webhookDeleteOperation.outputSchema,
			await executeWebhookDeleteOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookDeleteOperation.id, error);
	}
}

export async function invokeWebhookTestOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookTestOutputSchema>> {
	const parsed = parseOperationInput(webhookTestOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			webhookTestOperation.id,
			webhookTestOperation.outputSchema,
			await executeWebhookTestOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookTestOperation.id, error);
	}
}

export async function invokeWebhookDispatchOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookDispatchOutputSchema>> {
	const parsed = parseOperationInput(
		webhookDispatchOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookDispatchOperation.id,
			webhookDispatchOperation.outputSchema,
			await executeWebhookDispatchOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookDispatchOperation.id, error);
	}
}

export async function invokeWebhookDeliveryListOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookDeliveryListOutputSchema>> {
	const parsed = parseOperationInput(
		webhookDeliveryListOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookDeliveryListOperation.id,
			webhookDeliveryListOperation.outputSchema,
			await executeWebhookDeliveryListOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			webhookDeliveryListOperation.id,
			error,
		);
	}
}

export async function invokeWebhookDeliveryRetryOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookDeliveryRetryOutputSchema>> {
	const parsed = parseOperationInput(
		webhookDeliveryRetryOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookDeliveryRetryOperation.id,
			webhookDeliveryRetryOperation.outputSchema,
			await executeWebhookDeliveryRetryOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			webhookDeliveryRetryOperation.id,
			error,
		);
	}
}

const webhookOperationBindings = [
	{
		operation: webhookListOperation,
		invoke: invokeWebhookListOperation,
	},
	{
		operation: webhookCreateOperation,
		invoke: invokeWebhookCreateOperation,
	},
	{
		operation: webhookUpdateOperation,
		invoke: invokeWebhookUpdateOperation,
	},
	{
		operation: webhookDeleteOperation,
		invoke: invokeWebhookDeleteOperation,
	},
	{
		operation: webhookTestOperation,
		invoke: invokeWebhookTestOperation,
	},
	{
		operation: webhookDispatchOperation,
		invoke: invokeWebhookDispatchOperation,
	},
	{
		operation: webhookDeliveryListOperation,
		invoke: invokeWebhookDeliveryListOperation,
	},
	{
		operation: webhookDeliveryRetryOperation,
		invoke: invokeWebhookDeliveryRetryOperation,
	},
] as const;

export const webhookOperations = webhookOperationBindings.map(
	(binding) => binding.operation,
);

export const webhookOperationCatalog = defineOperationCatalog({
	id: "webhooks",
	title: "Outbound webhooks",
	operations: webhookOperations,
	specMigrationExemptions: [],
});

export type WebhookOperation =
	(typeof webhookOperationBindings)[number]["operation"];

const webhookOperationsByMcpName = new Map(
	webhookOperationBindings.map((binding) => [
		binding.operation.mcp.name,
		binding,
	]),
);

export function getWebhookOperationByMcpName(
	name: string,
): WebhookOperation | undefined {
	return webhookOperationsByMcpName.get(name)?.operation;
}

export interface WebhookOperationInvocation {
	operation: WebhookOperation;
	output: Record<string, unknown>;
}

export async function invokeWebhookOperationByMcpName(
	context: WebhookOperationContext,
	name: string,
	input: unknown,
): Promise<WebhookOperationInvocation | undefined> {
	const binding = webhookOperationsByMcpName.get(name);
	if (!binding) {
		return undefined;
	}
	return {
		operation: binding.operation,
		output: await binding.invoke(context, input),
	};
}
