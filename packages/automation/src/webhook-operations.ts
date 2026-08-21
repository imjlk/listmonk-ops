import {
	defineOperation,
	defineOperationCatalog,
	normalizeOperationExecutionError,
	parseOperationInput,
	parseOperationOutput,
} from "@listmonk-ops/operations";
import { createHash, randomUUID } from "node:crypto";
import {
	bindWebhookCreateOperationSpec,
	bindWebhookDeleteOperationSpec,
	bindWebhookDeliveryListOperationSpec,
	bindWebhookDeliveryRetryOperationSpec,
	bindWebhookDlqListOperationSpec,
	bindWebhookDlqReplayOperationSpec,
	bindWebhookDispatchOperationSpec,
	bindWebhookInboundIngestOperationSpec,
	bindWebhookListOperationSpec,
	bindWebhookPruneOperationSpec,
	bindWebhookReconcileOperationSpec,
	bindWebhookTestOperationSpec,
	bindWebhookTickOperationSpec,
	bindWebhookRuntimeStatusOperationSpec,
	bindWebhookCircuitResetOperationSpec,
	bindWebhookUpdateOperationSpec,
} from "@listmonk-ops/operations/specs";
import { z } from "zod";
import {
	ingestInboundDeliveryEvent,
	INBOUND_DELIVERY_EVENT_KINDS,
	MAX_INBOUND_DELIVERY_EVENT_METADATA_BYTES,
} from "./inbound-delivery-events";
import { getOutboundWebhookStoreOptionsFromEnvironment } from "./outbound-webhook-runtime";
import {
	createOutboundWebhookEndpoint,
	deleteOutboundWebhookEndpoint,
	dispatchOutboundWebhooks,
	enqueueOutboundWebhookEvent,
	getOutboundWebhookEndpoint,
	getOutboundWebhookRuntimeHealth,
	listOutboundWebhookDeliveries,
	listOutboundWebhookEndpoints,
	normalizeEventFilters,
	normalizeOutboundWebhookEndpointUrl,
	outboundWebhookEventFilterSchema,
	OUTBOUND_WEBHOOK_EVENT_TYPES,
	OUTBOUND_WEBHOOK_SECRET_REF_PATTERN,
	OutboundWebhookConflictError,
	OutboundWebhookNotFoundError,
	pruneOutboundWebhookDeliveries,
	replayOutboundWebhookDeadLetters,
	reconcileOutboundWebhookDeliveries,
	retryOutboundWebhookDelivery,
	resetOutboundWebhookEndpointCircuit,
	type OutboundWebhookDelivery,
	type OutboundWebhookEndpoint,
	type OutboundWebhookStoreOptions,
	updateOutboundWebhookEndpoint,
} from "./outbound-webhooks";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export interface WebhookOperationContext {
	store?: OutboundWebhookStoreOptions;
	fetcher?: typeof fetch;
	resolveSecret?: (secretRef: string) => string | undefined;
}

export function resolveWebhookOperationStore(
	context: WebhookOperationContext,
): OutboundWebhookStoreOptions {
	return context.store ?? getOutboundWebhookStoreOptionsFromEnvironment();
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
const eventFilterInput = outboundWebhookEventFilterSchema
	.describe("Exact event type, family wildcard such as operation.*, or *");
const eventTypeInput = z.enum(OUTBOUND_WEBHOOK_EVENT_TYPES);
const eventFilterOutput = outboundWebhookEventFilterSchema;
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
	circuit_failure_threshold: positiveIntegerInput
		.refine((value) => value <= 100, "Must be between 1 and 100")
		.default(5),
	circuit_cooldown_ms: positiveIntegerInput
		.refine(
			(value) => value >= 1_000 && value <= 86_400_000,
			"Must be between 1000 and 86400000",
		)
		.default(300_000),
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
		circuit_failure_threshold: positiveIntegerInput
			.refine((value) => value <= 100, "Must be between 1 and 100")
			.optional(),
		circuit_cooldown_ms: positiveIntegerInput
			.refine(
				(value) => value >= 1_000 && value <= 86_400_000,
				"Must be between 1000 and 86400000",
			)
			.optional(),
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
const webhookReconcileInputSchema = z.object({
	limit: webhookDeliveryListLimitInput.default(100),
	dry_run: booleanInput.default(true),
});
const webhookPruneInputSchema = z
	.object({
		older_than_days: positiveIntegerInput
			.refine(
				(value) => value <= 3_650,
				"older_than_days must be between 1 and 3650",
			)
			.default(30),
		before: z
			.iso.datetime({ offset: true })
			.optional()
			.describe(
				"Explicit retention cutoff that takes precedence over older_than_days and is required for destructive runs; echo the timestamp a dry run reported so the confirmed window never drifts",
			),
		ids: z
			.array(z.uuid())
			.max(1_000)
			.optional()
			.describe(
				"Exact terminal delivery set reported by a dry run; required for destructive runs so a retry deletes nothing new",
			),
		limit: webhookDeliveryListLimitInput.default(100),
		dry_run: booleanInput.default(true),
	})
	.superRefine((value, context) => {
		if (value.dry_run) {
			return;
		}
		if (value.before === undefined) {
			context.addIssue({
				code: "custom",
				path: ["before"],
				message:
					"Destructive prune runs require an explicit before cutoff; run a dry run first and echo the reported timestamp",
			});
		}
		if (value.ids === undefined) {
			context.addIssue({
				code: "custom",
				path: ["ids"],
				message:
					"Destructive prune runs require the exact delivery ids a dry run reported; echo them so a retry deletes nothing new",
			});
		}
	});
const webhookTickInputSchema = z.object({
	dispatch_limit: webhookDispatchLimitInput.default(25),
	reconcile_limit: webhookDeliveryListLimitInput.default(100),
});
const webhookRuntimeStatusInputSchema = z.object({
	worker_stale_ms: positiveIntegerInput
		.refine(
			(value) => value >= 1_000 && value <= 86_400_000,
			"worker_stale_ms must be between 1000 and 86400000",
		)
		.default(90_000),
});
const webhookInboundIngestInputSchema = z
	.object({
		provider: z.string().trim().min(1).max(100),
		provider_event_id: z.string().trim().min(1).max(200),
		kind: z.enum(INBOUND_DELIVERY_EVENT_KINDS),
		occurred_at: z.iso.datetime({ offset: true }).optional(),
		message_id: z.string().trim().min(1).max(300).optional(),
		subscriber_uuid: z.uuid().optional(),
		campaign_id: positiveIntegerInput.optional(),
		metadata: z
			.record(z.string(), z.unknown())
			.refine((value) => {
				try {
					return (
						new TextEncoder().encode(JSON.stringify(value)).byteLength <=
						MAX_INBOUND_DELIVERY_EVENT_METADATA_BYTES
					);
				} catch {
					return false;
				}
			}, `metadata must be JSON serializable and no larger than ${MAX_INBOUND_DELIVERY_EVENT_METADATA_BYTES} bytes`)
			.default({}),
	})
	.superRefine((value, context) => {
		if (value.kind === "unsubscribed" && value.subscriber_uuid === undefined) {
			context.addIssue({
				code: "custom",
				path: ["subscriber_uuid"],
				message: "subscriber_uuid is required for unsubscribed events",
			});
		}
	});
const webhookDlqListInputSchema = z.object({
	endpoint_id: endpointIdInput.optional(),
	limit: webhookDeliveryListLimitInput.default(100),
});
// The operation schema system requires an object root, so the destructive
// variant's delivery_ids requirement is enforced by superRefine at the
// boundary (the standalone TypeScript contract models it as a union).
const webhookDlqReplayInputSchema = z
	.object({
		endpoint_id: endpointIdInput.optional(),
		delivery_ids: z
			.array(z.uuid())
			.max(1_000)
			.optional()
			.describe(
				"Exact dead-letter set reported by a dry run; required when dry_run is false",
			),
		limit: webhookDeliveryListLimitInput.default(100),
		dry_run: booleanInput.default(true),
	})
	.superRefine((value, context) => {
		if (!value.dry_run && value.delivery_ids === undefined) {
			context.addIssue({
				code: "custom",
				path: ["delivery_ids"],
				message:
					"Destructive replay runs require the exact delivery ids a dry run reported; echo them so a retry replays nothing new",
			});
		}
	});
const webhookCircuitResetInputSchema = z.object({
	id: endpointIdInput,
});

const webhookEndpointOutputSchema = z.object({
	id: z.uuid(),
	name: z.string().trim().min(1).max(120),
	url_origin: z.string().min(1).regex(/^https:\/\/[^/?#]+$/),
	url_fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
	secret_reference_configured: z.boolean(),
	event_filters: z.array(eventFilterOutput).min(1),
	enabled: z.boolean(),
	timeout_ms: z.number().int().min(100).max(30_000),
	max_attempts: z.number().int().min(1).max(12),
	circuit_failure_threshold: z.number().int().min(1).max(100),
	circuit_cooldown_ms: z.number().int().min(1_000).max(86_400_000),
	created_at: z.iso.datetime({ offset: true }),
	updated_at: z.iso.datetime({ offset: true }),
});
const webhookListOutputSchema = z.object({
	endpoints: z.array(webhookEndpointOutputSchema),
});
const webhookCreateOutputSchema = z.object({
	endpoint: webhookEndpointOutputSchema,
	created: z.boolean(),
});
const webhookUpdateOutputSchema = z.object({
	endpoint: webhookEndpointOutputSchema,
});
// Operation output schemas must keep an object root, so the deleted/endpoint
// correlation (endpoint is present exactly when deleted is true) is enforced
// by the executor rather than a discriminated union.
const webhookDeleteOutputSchema = z.object({
	deleted: z.boolean(),
	endpoint: webhookEndpointOutputSchema.optional(),
});
const dispatchResultIdentitySchema = {
	delivery_id: z.uuid(),
	endpoint_id: z.uuid(),
};
const dispatchErrorCodeSchema = z.enum([
	"endpoint_unavailable",
	"delivery_unavailable",
	"signing_secret_unavailable",
	"url_policy_blocked",
	"http_rejected",
	"lease_conflict",
	"delivery_state_conflict",
	"delivery_failed",
]);
const dispatchResultSchema = z.discriminatedUnion("status", [
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("succeeded"),
		status_code: z.number().int().min(100).max(599).optional(),
		error_code: dispatchErrorCodeSchema.optional(),
	}),
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("retry"),
		status_code: z.number().int().min(100).max(599).optional(),
		error_code: dispatchErrorCodeSchema.optional(),
	}),
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("exhausted"),
		status_code: z.number().int().min(100).max(599).optional(),
		error_code: dispatchErrorCodeSchema.optional(),
	}),
	z.object({
		...dispatchResultIdentitySchema,
		status: z.literal("skipped"),
		error_code: dispatchErrorCodeSchema,
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
	/** True when the call reused an already-queued delivery instead of enqueuing a new one (a resumed delivery still pings). */
	replayed: z.boolean(),
	/** The endpoint configuration revision the probe identity was bound to; a later dispatch may still resolve a newer revision. */
	bound_revision: z.string(),
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
	correlation_id_present: z.boolean(),
	subject: z
		.object({
			kind: z.enum([
				"operation",
				"campaign",
				"subscriber",
				"message",
				"experiment",
				"sequence",
				"webhook",
			]),
			key_redacted: z.literal(true),
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
	last_error_present: z.boolean(),
});
const webhookDeliveryListOutputSchema = z.object({
	deliveries: z.array(webhookDeliveryOutputSchema),
});
const webhookDeliveryRetryOutputSchema = z.object({
	delivery: webhookDeliveryOutputSchema,
	retried: z.boolean(),
});
const webhookReconcileOutputSchema = z.object({
	scanned: z.number().int().nonnegative(),
	recovered: z.number().int().nonnegative(),
	exhausted: z.number().int().nonnegative(),
	unchanged: z.number().int().nonnegative(),
	dry_run: z.boolean(),
});
const webhookPruneOutputSchema = z.object({
	eligible: z.number().int().nonnegative(),
	deleted: z.number().int().nonnegative(),
	dry_run: z.boolean(),
	before: z.iso.datetime({ offset: true }),
	ids: z.array(z.uuid()).readonly(),
});
const webhookTickOutputSchema = z.object({
	reconcile: webhookReconcileOutputSchema,
	dispatch: webhookDispatchOutputSchema,
});
const webhookRuntimeStatusOutputSchema = z.object({
	store: z.enum(["file", "postgres"]),
	schema_version: z.number().int().positive(),
	healthy: z.boolean(),
	checked_at: z.iso.datetime({ offset: true }),
	endpoints: z.object({
		total: z.number().int().nonnegative(),
		enabled: z.number().int().nonnegative(),
		circuit_open: z.number().int().nonnegative(),
	}),
	deliveries: z.object({
		pending: z.number().int().nonnegative(),
		delivering: z.number().int().nonnegative(),
		retry: z.number().int().nonnegative(),
		succeeded: z.number().int().nonnegative(),
		exhausted: z.number().int().nonnegative(),
		due: z.number().int().nonnegative(),
		dead_letter: z.number().int().nonnegative(),
		oldest_due_at: z.iso.datetime({ offset: true }).optional(),
	}),
	workers: z.object({
		running: z.number().int().nonnegative(),
		stale: z.number().int().nonnegative(),
		stopped: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
		last_heartbeat_at: z.iso.datetime({ offset: true }).optional(),
	}),
});
const webhookInboundIngestOutputSchema = z.object({
	event_id: z.uuid(),
	event_type: eventTypeInput,
	matched_endpoints: z.number().int().nonnegative(),
	queued_deliveries: z.number().int().nonnegative(),
	duplicate_deliveries: z.number().int().nonnegative(),
	delivery_ids: z.array(z.uuid()),
});
const webhookDlqListOutputSchema = webhookDeliveryListOutputSchema;
const webhookDlqReplayOutputSchema = z.object({
	eligible: z.number().int().nonnegative(),
	replayed: z.number().int().nonnegative(),
	failed: z.number().int().nonnegative(),
	dry_run: z.boolean(),
	delivery_ids: z.array(z.uuid()),
	errors: z.array(
		z.object({
			delivery_id: z.uuid(),
			error_code: dispatchErrorCodeSchema,
		}),
	),
});
const webhookCircuitResetOutputSchema = z.object({
	endpoint_id: z.uuid(),
	circuit_state: z.literal("closed"),
	consecutive_failures: z.literal(0),
});

function toEndpointOutput(endpoint: OutboundWebhookEndpoint) {
	return {
		id: endpoint.id,
		name: endpoint.name,
		url_origin: new URL(endpoint.url).origin,
		url_fingerprint: `sha256:${createHash("sha256").update(endpoint.url).digest("hex")}`,
		secret_reference_configured: endpoint.secretRef.length > 0,
		event_filters: endpoint.eventFilters.map((filter) =>
			eventFilterOutput.parse(filter),
		),
		enabled: endpoint.enabled,
		timeout_ms: endpoint.timeoutMs,
		max_attempts: endpoint.maxAttempts,
		circuit_failure_threshold: endpoint.circuitFailureThreshold,
		circuit_cooldown_ms: endpoint.circuitCooldownMs,
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
			correlation_id_present: delivery.event.correlationId !== undefined,
			subject:
				delivery.event.subject === undefined
					? undefined
					: {
							kind: delivery.event.subject.kind,
							key_redacted: true as const,
						},
		},
		status: delivery.status,
		attempt_count: delivery.attemptCount,
		manual_retry_count: delivery.manualRetryCount,
		next_attempt_at: delivery.nextAttemptAt,
		last_attempt_at: delivery.lastAttemptAt,
		completed_at: delivery.completedAt,
		status_code: delivery.statusCode,
		last_error_present: delivery.lastError !== undefined,
	};
}

function toDispatchOutput(
	result: Awaited<ReturnType<typeof dispatchOutboundWebhooks>>,
) {
	return webhookDispatchOutputSchema.parse({
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
						error_code: entry.errorCode,
					}
				: {
						delivery_id: entry.deliveryId,
						endpoint_id: entry.endpointId,
						status: entry.status,
						status_code: entry.statusCode,
						error_code: entry.errorCode,
					},
		),
	});
}

export async function executeWebhookListOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookListInputSchema>,
) {
	const endpoints = await listOutboundWebhookEndpoints(
		resolveWebhookOperationStore(context),
	);
	return {
		endpoints: endpoints
			.filter(
				(endpoint) =>
					input.enabled === undefined || endpoint.enabled === input.enabled,
			)
			.map(toEndpointOutput),
	};
}

function sameWebhookCreateIntent(
	endpoint: OutboundWebhookEndpoint,
	input: z.output<typeof webhookCreateInputSchema>,
): boolean {
	return (
		endpoint.name.toLowerCase() === input.name.toLowerCase() &&
		endpoint.url === normalizeOutboundWebhookEndpointUrl(input.url) &&
		endpoint.secretRef === input.secret_ref &&
		JSON.stringify([...endpoint.eventFilters].sort()) ===
			JSON.stringify([...normalizeEventFilters(input.event_filters)].sort()) &&
		endpoint.enabled === input.enabled &&
		endpoint.timeoutMs === input.timeout_ms &&
		endpoint.maxAttempts === input.max_attempts &&
		endpoint.circuitFailureThreshold === input.circuit_failure_threshold &&
		endpoint.circuitCooldownMs === input.circuit_cooldown_ms
	);
}

export async function executeWebhookCreateOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookCreateInputSchema>,
) {
	const requested = {
		name: input.name,
		url: input.url,
		secretRef: input.secret_ref,
		eventFilters: input.event_filters,
		enabled: input.enabled,
		timeoutMs: input.timeout_ms,
		maxAttempts: input.max_attempts,
		circuitFailureThreshold: input.circuit_failure_threshold,
		circuitCooldownMs: input.circuit_cooldown_ms,
	};
	try {
		const endpoint = await createOutboundWebhookEndpoint(
			requested,
			resolveWebhookOperationStore(context),
		);
		return { endpoint: toEndpointOutput(endpoint), created: true as const };
	} catch (error) {
		if (!(error instanceof OutboundWebhookConflictError)) {
			throw error;
		}
		// Endpoint names are unique, so a retry after an ambiguous create
		// conflicts. Replay only when the persisted endpoint matches the
		// requested intent; a different configuration under the same name
		// stays a conflict.
		const existing = (
			await listOutboundWebhookEndpoints(resolveWebhookOperationStore(context))
		).find(
			(candidate) =>
				candidate.name.toLowerCase() === input.name.toLowerCase(),
		);
		if (!existing || !sameWebhookCreateIntent(existing, input)) {
			throw error;
		}
		return { endpoint: toEndpointOutput(existing), created: false as const };
	}
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
			circuitFailureThreshold: input.circuit_failure_threshold,
			circuitCooldownMs: input.circuit_cooldown_ms,
		},
		resolveWebhookOperationStore(context),
	);
	return { endpoint: toEndpointOutput(endpoint) };
}

export async function executeWebhookDeleteOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDeleteInputSchema>,
) {
	try {
		const endpoint = await deleteOutboundWebhookEndpoint(
			input.id,
			resolveWebhookOperationStore(context),
		);
		return { deleted: true as const, endpoint: toEndpointOutput(endpoint) };
	} catch (error) {
		if (error instanceof OutboundWebhookNotFoundError) {
			// Deleting an already-deleted endpoint is a documented no-op.
			return { deleted: false as const };
		}
		throw error;
	}
}

// A keyed test derives a deterministic event id so the outbox dedup
// (event id + endpoint id) collapses an ambiguous retry onto the
// already-queued delivery instead of sending a second ping.
// Bind the probe identity to the endpoint's configuration revision (its
// updatedAt timestamp, bumped on every mutation) so a repeat after a URL
// or secret change tests the new configuration rather than replaying the
// old probe's terminal delivery.
export function testConfigFingerprint(endpoint: {
	updatedAt: string;
}): string {
	return endpoint.updatedAt;
}

export function testEventUuid(
	endpointId: string,
	correlationId: string,
	configFingerprint = "",
): string {
	const digest = createHash("sha256")
		.update(`webhook.test:${endpointId}:${correlationId}:${configFingerprint}`)
		.digest("hex");
	const bytes = Uint8Array.from(
		digest.slice(0, 32).match(/../g)!.map((h) => Number.parseInt(h, 16)),
	);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50; // uuid v5 marker
	bytes[8] = (bytes[8]! & 0x3f) | 0x80; // rfc 4122 variant
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function executeWebhookTestOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookTestInputSchema>,
) {
	const store = resolveWebhookOperationStore(context);
	const endpoint = await getOutboundWebhookEndpoint(input.id, store);
	const keyed = input.correlation_id !== undefined;
	const queued = await enqueueOutboundWebhookEvent(
		{
			id: keyed
				? testEventUuid(
						endpoint.id,
						input.correlation_id!,
						testConfigFingerprint(endpoint),
					)
				: randomUUID(),
			type: "webhook.test",
			source: "webhook",
			correlationId: input.correlation_id,
			subject: { kind: "webhook", key: endpoint.id },
			data: { endpoint_id: endpoint.id, endpoint_name: endpoint.name },
		},
		{
			...store,
			endpointIds: [endpoint.id],
			bypassEventFilters: true,
		},
	);
	const deliveryId = queued.deliveryIds[0];
	if (deliveryId === undefined) {
		if (!keyed) {
			// Only enabled endpoints receive deliveries, so an unkeyed probe
			// with nothing queued means the endpoint is unavailable.
			throw new OutboundWebhookConflictError(
				`Webhook endpoint ${input.id} is disabled or missing`,
				"endpoint_unavailable",
			);
		}
		// The dedup collapsed the retry onto an already-queued delivery. The
		// original call may have failed before dispatching it, so resolve the
		// persisted delivery directly by event: a still-claimable one (or one
		// whose lease expired) is dispatched now, and a terminal one reports
		// its persisted outcome without resending.
		const [existing] = await listOutboundWebhookDeliveries({
			...store,
			endpointId: endpoint.id,
			eventId: queued.event.id,
			limit: 1,
		});
		if (!existing) {
			// Nothing was queued and no persisted delivery carries this event:
			// the enqueue selected no enabled endpoint, so the probe never ran.
			throw new OutboundWebhookConflictError(
				`Webhook endpoint ${input.id} is disabled or missing`,
				"endpoint_unavailable",
			);
		}
		const leaseExpired =
			existing.status === "delivering" &&
			(existing.leaseExpiresAt === undefined ||
				Date.parse(existing.leaseExpiresAt) <= Date.now());
		if (
			existing.status === "pending" ||
			existing.status === "retry" ||
			leaseExpired
		) {
			const dispatch = await dispatchOutboundWebhooks({
				store,
				fetcher: context.fetcher,
				resolveSecret: context.resolveSecret,
				deliveryIds: [existing.id],
				bypassCircuitBreaker: true,
				limit: 1,
			});
			return {
				event_id: queued.event.id,
				delivery_id: existing.id,
				replayed: true,
				bound_revision: endpoint.updatedAt,
				dispatch: toDispatchOutput(dispatch),
			};
		}
		// Terminal deliveries report as skipped only — the persisted outcome
		// is already visible through webhooks.delivery.list, and the dispatch
		// summary stays internally consistent (one record, skipped).
		return {
			event_id: queued.event.id,
			delivery_id: existing.id,
			replayed: true,
			bound_revision: endpoint.updatedAt,
			dispatch: toDispatchOutput({
				claimed: 0,
				succeeded: 0,
				exhausted: 0,
				retried: 0,
				skipped: 1,
				results: [],
			}),
		};
	}
	const dispatch = await dispatchOutboundWebhooks({
		store,
		fetcher: context.fetcher,
		resolveSecret: context.resolveSecret,
		deliveryIds: [deliveryId],
		bypassCircuitBreaker: true,
		limit: 1,
	});
	return {
		event_id: queued.event.id,
		delivery_id: deliveryId,
		replayed: false,
		bound_revision: endpoint.updatedAt,
		dispatch: toDispatchOutput(dispatch),
	};
}

export async function executeWebhookDispatchOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDispatchInputSchema>,
) {
	return toDispatchOutput(
		await dispatchOutboundWebhooks({
			store: resolveWebhookOperationStore(context),
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
		...resolveWebhookOperationStore(context),
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
	const { delivery, retried } = await retryOutboundWebhookDelivery(
		input.id,
		resolveWebhookOperationStore(context),
	);
	return { delivery: toDeliveryOutput(delivery), retried };
}

export async function executeWebhookReconcileOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookReconcileInputSchema>,
) {
	const result = await reconcileOutboundWebhookDeliveries({
		...resolveWebhookOperationStore(context),
		limit: input.limit,
		dryRun: input.dry_run,
	});
	return {
		scanned: result.scanned,
		recovered: result.recovered,
		exhausted: result.exhausted,
		unchanged: result.unchanged,
		dry_run: result.dryRun,
	};
}

export async function executeWebhookPruneOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookPruneInputSchema>,
) {
	const result = await pruneOutboundWebhookDeliveries({
		...resolveWebhookOperationStore(context),
		before: input.before
			? new Date(input.before)
			: new Date(Date.now() - input.older_than_days * MILLISECONDS_PER_DAY),
		ids: input.ids,
		limit: input.limit,
		dryRun: input.dry_run,
	});
	return {
		eligible: result.eligible,
		deleted: result.deleted,
		dry_run: result.dryRun,
		before: result.before,
		ids: result.ids,
	};
}

export async function executeWebhookTickOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookTickInputSchema>,
) {
	const store = resolveWebhookOperationStore(context);
	const reconcile = await reconcileOutboundWebhookDeliveries({
		...store,
		limit: input.reconcile_limit,
		dryRun: false,
	});
	const dispatch = await dispatchOutboundWebhooks({
		store,
		fetcher: context.fetcher,
		resolveSecret: context.resolveSecret,
		limit: input.dispatch_limit,
	});
	return {
		reconcile: {
			scanned: reconcile.scanned,
			recovered: reconcile.recovered,
			exhausted: reconcile.exhausted,
			unchanged: reconcile.unchanged,
			dry_run: reconcile.dryRun,
		},
		dispatch: toDispatchOutput(dispatch),
	};
}

export async function executeWebhookRuntimeStatusOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookRuntimeStatusInputSchema>,
) {
	const health = await getOutboundWebhookRuntimeHealth({
		...resolveWebhookOperationStore(context),
		workerStaleMs: input.worker_stale_ms,
	});
	return {
		store: health.store,
		schema_version: health.schemaVersion,
		healthy: health.healthy,
		checked_at: health.checkedAt,
		endpoints: {
			total: health.endpoints.total,
			enabled: health.endpoints.enabled,
			circuit_open: health.endpoints.circuitOpen,
		},
		deliveries: {
			pending: health.deliveries.pending,
			delivering: health.deliveries.delivering,
			retry: health.deliveries.retry,
			succeeded: health.deliveries.succeeded,
			exhausted: health.deliveries.exhausted,
			due: health.deliveries.due,
			dead_letter: health.deliveries.deadLetter,
			oldest_due_at: health.deliveries.oldestDueAt,
		},
		workers: {
			running: health.workers.running,
			stale: health.workers.stale,
			stopped: health.workers.stopped,
			failed: health.workers.failed,
			last_heartbeat_at: health.workers.lastHeartbeatAt,
		},
	};
}

export async function executeWebhookInboundIngestOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookInboundIngestInputSchema>,
) {
	const result = await ingestInboundDeliveryEvent(
		{
			provider: input.provider,
			providerEventId: input.provider_event_id,
			kind: input.kind,
			occurredAt: input.occurred_at,
			messageId: input.message_id,
			subscriberUuid: input.subscriber_uuid,
			campaignId: input.campaign_id,
			metadata: input.metadata,
		},
		resolveWebhookOperationStore(context),
	);
	return {
		event_id: result.event.id,
		event_type: result.event.type,
		matched_endpoints: result.matchedEndpoints,
		queued_deliveries: result.queuedDeliveries,
		duplicate_deliveries: result.duplicateDeliveries,
		delivery_ids: [...result.deliveryIds],
	};
}

export async function executeWebhookDlqListOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDlqListInputSchema>,
) {
	const deliveries = await listOutboundWebhookDeliveries({
		...resolveWebhookOperationStore(context),
		endpointId: input.endpoint_id,
		status: "exhausted",
		limit: input.limit,
	});
	return { deliveries: deliveries.map(toDeliveryOutput) };
}

export async function executeWebhookDlqReplayOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookDlqReplayInputSchema>,
) {
	const result = await replayOutboundWebhookDeadLetters({
		...resolveWebhookOperationStore(context),
		endpointId: input.endpoint_id,
		deliveryIds: input.delivery_ids,
		limit: input.limit,
		dryRun: input.dry_run,
	});
	return {
		eligible: result.eligible,
		replayed: result.replayed,
		failed: result.failed,
		dry_run: result.dryRun,
		delivery_ids: [...result.deliveryIds],
		errors: result.errors.map((entry) => ({
			delivery_id: entry.deliveryId,
			error_code: entry.errorCode,
		})),
	};
}

export async function executeWebhookCircuitResetOperation(
	context: WebhookOperationContext,
	input: z.output<typeof webhookCircuitResetInputSchema>,
) {
	const runtime = await resetOutboundWebhookEndpointCircuit(
		input.id,
		resolveWebhookOperationStore(context),
	);
	if (runtime.circuitState !== "closed") {
		throw new Error(
			`Endpoint ${runtime.endpointId} circuit reset did not reach the expected closed state`,
		);
	}
	const consecutiveFailures = runtime.consecutiveFailures;
	if (consecutiveFailures !== 0) {
		throw new Error(
			`Endpoint ${runtime.endpointId} circuit reset did not clear its failure count`,
		);
	}
	return webhookCircuitResetOutputSchema.parse({
		endpoint_id: runtime.endpointId,
		circuit_state: runtime.circuitState,
		consecutive_failures: consecutiveFailures,
	});
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
		idempotentHint: true,
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
		idempotentHint: true,
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
		"Inspect redacted outbox delivery state, attempts, status codes, and stored-error presence.",
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

export const webhookReconcileOperation = defineOperation({
	id: "webhooks.reconcile",
	title: "Reconcile outbound webhook leases",
	description:
		"Recover expired worker leases and exhaust deliveries whose endpoint is missing or disabled.",
	inputSchema: webhookReconcileInputSchema,
	outputSchema: webhookReconcileOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_reconcile" },
	spec: bindWebhookReconcileOperationSpec(),
	execute: executeWebhookReconcileOperation,
});

export const webhookPruneOperation = defineOperation({
	id: "webhooks.prune",
	title: "Prune outbound webhook delivery history",
	description:
		"Preview or delete bounded terminal delivery records older than a retention cutoff. Destructive runs echo the exact delivery ids and `before` cutoff a dry run reported, so a retry deletes nothing new.",
	inputSchema: webhookPruneInputSchema,
	outputSchema: webhookPruneOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_prune" },
	spec: bindWebhookPruneOperationSpec(),
	execute: executeWebhookPruneOperation,
});

export const webhookTickOperation = defineOperation({
	id: "webhooks.tick",
	title: "Run one outbound webhook worker tick",
	description:
		"Reconcile expired leases, claim due outbox records, and send one bounded delivery batch.",
	inputSchema: webhookTickInputSchema,
	outputSchema: webhookTickOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: true,
	},
	mcp: { name: "listmonk_webhooks_tick" },
	spec: bindWebhookTickOperationSpec(),
	execute: executeWebhookTickOperation,
});

export const webhookRuntimeStatusOperation = defineOperation({
	id: "webhooks.runtime.status",
	title: "Inspect outbound webhook runtime health",
	description:
		"Inspect durable schema, endpoint circuit, dead-letter, delivery, and worker heartbeat health.",
	inputSchema: webhookRuntimeStatusInputSchema,
	outputSchema: webhookRuntimeStatusOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_runtime_status" },
	spec: bindWebhookRuntimeStatusOperationSpec(),
	execute: executeWebhookRuntimeStatusOperation,
});

export const webhookInboundIngestOperation = defineOperation({
	id: "webhooks.inbound.ingest",
	title: "Ingest normalized provider delivery event",
	description:
		"Normalize a verified provider delivery event into the shared versioned event envelope and durable outbox; unsubscribe events require a subscriber UUID and metadata is limited to 16 KiB.",
	inputSchema: webhookInboundIngestInputSchema,
	outputSchema: webhookInboundIngestOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_inbound_ingest" },
	spec: bindWebhookInboundIngestOperationSpec(),
	execute: executeWebhookInboundIngestOperation,
});

export const webhookDlqListOperation = defineOperation({
	id: "webhooks.dlq.list",
	title: "List outbound webhook dead letters",
	description: "List exhausted delivery records that require operator review.",
	inputSchema: webhookDlqListInputSchema,
	outputSchema: webhookDlqListOutputSchema,
	safety: {
		readOnlyHint: true,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_dlq_list" },
	spec: bindWebhookDlqListOperationSpec(),
	execute: executeWebhookDlqListOperation,
});

export const webhookDlqReplayOperation = defineOperation({
	id: "webhooks.dlq.replay",
	title: "Replay outbound webhook dead letters",
	description:
		"Preview or requeue a bounded set of reviewed dead-letter deliveries. Destructive runs echo the exact delivery ids a dry run reported.",
	inputSchema: webhookDlqReplayInputSchema,
	outputSchema: webhookDlqReplayOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: false,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_dlq_replay" },
	spec: bindWebhookDlqReplayOperationSpec(),
	execute: executeWebhookDlqReplayOperation,
});

export const webhookCircuitResetOperation = defineOperation({
	id: "webhooks.circuit.reset",
	title: "Reset outbound webhook circuit breaker",
	description:
		"Close one endpoint circuit after the operator has corrected its failure.",
	inputSchema: webhookCircuitResetInputSchema,
	outputSchema: webhookCircuitResetOutputSchema,
	safety: {
		readOnlyHint: false,
		destructiveHint: true,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_webhooks_circuit_reset" },
	spec: bindWebhookCircuitResetOperationSpec(),
	execute: executeWebhookCircuitResetOperation,
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

export async function invokeWebhookReconcileOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookReconcileOutputSchema>> {
	const parsed = parseOperationInput(
		webhookReconcileOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookReconcileOperation.id,
			webhookReconcileOperation.outputSchema,
			await executeWebhookReconcileOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookReconcileOperation.id, error);
	}
}

export async function invokeWebhookPruneOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookPruneOutputSchema>> {
	const parsed = parseOperationInput(webhookPruneOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			webhookPruneOperation.id,
			webhookPruneOperation.outputSchema,
			await executeWebhookPruneOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookPruneOperation.id, error);
	}
}

export async function invokeWebhookTickOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookTickOutputSchema>> {
	const parsed = parseOperationInput(webhookTickOperation.inputSchema, input);
	try {
		return parseOperationOutput(
			webhookTickOperation.id,
			webhookTickOperation.outputSchema,
			await executeWebhookTickOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookTickOperation.id, error);
	}
}

export async function invokeWebhookRuntimeStatusOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookRuntimeStatusOutputSchema>> {
	const parsed = parseOperationInput(
		webhookRuntimeStatusOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookRuntimeStatusOperation.id,
			webhookRuntimeStatusOperation.outputSchema,
			await executeWebhookRuntimeStatusOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			webhookRuntimeStatusOperation.id,
			error,
		);
	}
}

export async function invokeWebhookInboundIngestOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookInboundIngestOutputSchema>> {
	const parsed = parseOperationInput(
		webhookInboundIngestOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookInboundIngestOperation.id,
			webhookInboundIngestOperation.outputSchema,
			await executeWebhookInboundIngestOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			webhookInboundIngestOperation.id,
			error,
		);
	}
}

export async function invokeWebhookDlqListOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookDlqListOutputSchema>> {
	const parsed = parseOperationInput(
		webhookDlqListOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookDlqListOperation.id,
			webhookDlqListOperation.outputSchema,
			await executeWebhookDlqListOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookDlqListOperation.id, error);
	}
}

export async function invokeWebhookDlqReplayOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookDlqReplayOutputSchema>> {
	const parsed = parseOperationInput(
		webhookDlqReplayOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookDlqReplayOperation.id,
			webhookDlqReplayOperation.outputSchema,
			await executeWebhookDlqReplayOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(webhookDlqReplayOperation.id, error);
	}
}

export async function invokeWebhookCircuitResetOperation(
	context: WebhookOperationContext,
	input: unknown,
): Promise<z.output<typeof webhookCircuitResetOutputSchema>> {
	const parsed = parseOperationInput(
		webhookCircuitResetOperation.inputSchema,
		input,
	);
	try {
		return parseOperationOutput(
			webhookCircuitResetOperation.id,
			webhookCircuitResetOperation.outputSchema,
			await executeWebhookCircuitResetOperation(context, parsed),
		);
	} catch (error) {
		throw normalizeOperationExecutionError(
			webhookCircuitResetOperation.id,
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
	{
		operation: webhookReconcileOperation,
		invoke: invokeWebhookReconcileOperation,
	},
	{
		operation: webhookPruneOperation,
		invoke: invokeWebhookPruneOperation,
	},
	{
		operation: webhookTickOperation,
		invoke: invokeWebhookTickOperation,
	},
	{
		operation: webhookRuntimeStatusOperation,
		invoke: invokeWebhookRuntimeStatusOperation,
	},
	{
		operation: webhookInboundIngestOperation,
		invoke: invokeWebhookInboundIngestOperation,
	},
	{
		operation: webhookDlqListOperation,
		invoke: invokeWebhookDlqListOperation,
	},
	{
		operation: webhookDlqReplayOperation,
		invoke: invokeWebhookDlqReplayOperation,
	},
	{
		operation: webhookCircuitResetOperation,
		invoke: invokeWebhookCircuitResetOperation,
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
