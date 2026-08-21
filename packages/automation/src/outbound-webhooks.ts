import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	type OperationAuditEntry,
	type OperationAuditStoreOptions,
	type RecordOperationAuditInput,
	recordOperationAudit,
	updateJsonFileStore,
} from "@listmonk-ops/common";
import type {
	OperationEventSource,
	OperationResourceKind,
} from "@listmonk-ops/operations/specs";
import { z } from "zod";
import { isPrivateHost, isSafeFetchUrl } from "./campaign";
import {
	postPinnedHttpsWebhookWithFallback,
	type ResolvedWebhookAddress,
} from "./webhook-transport";

export const OUTBOUND_WEBHOOK_STORE_VERSION = 2;
export const OUTBOUND_WEBHOOK_EVENT_SCHEMA_VERSION = 1;
export const DEFAULT_OUTBOUND_WEBHOOK_TIMEOUT_MS = 10_000;
export const DEFAULT_OUTBOUND_WEBHOOK_MAX_ATTEMPTS = 6;
export const DEFAULT_OUTBOUND_WEBHOOK_RETRY_DELAY_MS = 30_000;
export const MAX_OUTBOUND_WEBHOOK_RETRY_DELAY_MS = 3_600_000;
export const DEFAULT_OUTBOUND_WEBHOOK_LEASE_MS = 90_000;
export const DEFAULT_OUTBOUND_WEBHOOK_STORE_LIMIT = 5_000;
export const DEFAULT_OUTBOUND_WEBHOOK_CONCURRENCY = 5;
export const DEFAULT_OUTBOUND_WEBHOOK_CIRCUIT_FAILURE_THRESHOLD = 5;
export const DEFAULT_OUTBOUND_WEBHOOK_CIRCUIT_COOLDOWN_MS = 300_000;
export const DEFAULT_OUTBOUND_WEBHOOK_WORKER_HEARTBEAT_STALE_MS = 90_000;
export const DEFAULT_OUTBOUND_WEBHOOK_WORKER_RETENTION_MS =
	30 * 24 * 60 * 60 * 1_000;
export const OUTBOUND_WEBHOOK_SECRET_REF_PATTERN =
	/^LISTMONK_OPS_WEBHOOK_SECRET(?:_[A-Z0-9]+)*$/;

export const OUTBOUND_WEBHOOK_EVENT_TYPES = [
	"operation.started",
	"operation.blocked",
	"operation.succeeded",
	"operation.failed",
	"campaign.scheduled",
	"campaign.started",
	"campaign.paused",
	"campaign.cancelled",
	"campaign.finished",
	"subscriber.created",
	"subscriber.updated",
	"subscriber.blocklisted",
	"subscriber.unsubscribed",
	"delivery.delivered",
	"delivery.bounced",
	"delivery.complained",
	"delivery.delayed",
	"delivery.rejected",
	"abtest.started",
	"abtest.ready-for-analysis",
	"abtest.winner-selected",
	"abtest.inconclusive",
	"abtest.failed",
	"sequence.created",
	"sequence.revised",
	"sequence.enrolled",
	"sequence.paused",
	"sequence.resumed",
	"sequence.reconciled",
	"sequence.deleted",
	"webhook.test",
] as const;
export const OUTBOUND_WEBHOOK_EVENT_FAMILY_FILTERS = [
	"operation.*",
	"campaign.*",
	"subscriber.*",
	"delivery.*",
	"abtest.*",
	"sequence.*",
	"webhook.*",
] as const;
export const OUTBOUND_WEBHOOK_EVENT_FILTERS = [
	"*",
	...OUTBOUND_WEBHOOK_EVENT_TYPES,
	...OUTBOUND_WEBHOOK_EVENT_FAMILY_FILTERS,
] as const;

export type OutboundWebhookEventType =
	(typeof OUTBOUND_WEBHOOK_EVENT_TYPES)[number];
export type OutboundWebhookEventFilter =
	(typeof OUTBOUND_WEBHOOK_EVENT_FILTERS)[number];
export type OutboundWebhookEventSource = OperationEventSource;
export type OutboundWebhookSubjectKind = Extract<
	OperationResourceKind,
	| "operation"
	| "campaign"
	| "subscriber"
	| "message"
	| "experiment"
	| "sequence"
	| "webhook"
>;
export type OutboundWebhookDeliveryStatus =
	| "pending"
	| "delivering"
	| "retry"
	| "succeeded"
	| "exhausted";

export type OutboundWebhookSubject = Readonly<{
	kind: OutboundWebhookSubjectKind;
	key: string;
}>;

export type OutboundWebhookEvent = Readonly<{
	id: string;
	type: OutboundWebhookEventType;
	schemaVersion: typeof OUTBOUND_WEBHOOK_EVENT_SCHEMA_VERSION;
	occurredAt: string;
	source: OutboundWebhookEventSource;
	correlationId?: string | undefined;
	subject?: OutboundWebhookSubject | undefined;
	data: Readonly<Record<string, unknown>>;
}>;

export type OutboundWebhookEndpoint = Readonly<{
	id: string;
	name: string;
	url: string;
	secretRef: string;
	eventFilters: readonly string[];
	enabled: boolean;
	timeoutMs: number;
	maxAttempts: number;
	circuitFailureThreshold: number;
	circuitCooldownMs: number;
	createdAt: string;
	updatedAt: string;
}>;

export type OutboundWebhookEndpointRuntime = Readonly<{
	endpointId: string;
	consecutiveFailures: number;
	circuitState: "closed" | "open";
	circuitOpenedAt?: string | undefined;
	circuitOpenUntil?: string | undefined;
	lastFailureAt?: string | undefined;
	lastSuccessAt?: string | undefined;
}>;

export type OutboundWebhookWorkerStatus = "running" | "stopped" | "failed";

export type OutboundWebhookWorker = Readonly<{
	id: string;
	status: OutboundWebhookWorkerStatus;
	startedAt: string;
	heartbeatAt: string;
	stoppedAt?: string | undefined;
	lastError?: string | undefined;
	lastTick?: Readonly<{
		claimed: number;
		succeeded: number;
		retried: number;
		exhausted: number;
		completedAt: string;
	}> | undefined;
}>;

export type OutboundWebhookDelivery = Readonly<{
	id: string;
	eventId: string;
	endpointId: string;
	event: OutboundWebhookEvent;
	status: OutboundWebhookDeliveryStatus;
	attemptCount: number;
	manualRetryCount: number;
	nextAttemptAt: string;
	lastAttemptAt?: string | undefined;
	completedAt?: string | undefined;
	statusCode?: number | undefined;
	lastError?: string | undefined;
	leaseToken?: string | undefined;
	leaseExpiresAt?: string | undefined;
}>;

export type OutboundWebhookStore = Readonly<{
	version: typeof OUTBOUND_WEBHOOK_STORE_VERSION;
	endpoints: readonly OutboundWebhookEndpoint[];
	deliveries: readonly OutboundWebhookDelivery[];
	endpointRuntime: readonly OutboundWebhookEndpointRuntime[];
	workers: readonly OutboundWebhookWorker[];
}>;

export type OutboundWebhookStoreOptions = Readonly<{
	path?: string;
	limit?: number;
	repository?: OutboundWebhookRepository;
}>;

export type OutboundWebhookMutationOptions = OutboundWebhookStoreOptions &
	Readonly<{
		now?: Date;
	}>;

export type CreateOutboundWebhookEndpointInput = Readonly<{
	name: string;
	url: string;
	secretRef: string;
	eventFilters: readonly string[];
	enabled?: boolean;
	timeoutMs?: number;
	maxAttempts?: number;
	circuitFailureThreshold?: number;
	circuitCooldownMs?: number;
}>;

export type UpdateOutboundWebhookEndpointInput = Readonly<{
	name?: string;
	url?: string;
	secretRef?: string;
	eventFilters?: readonly string[];
	enabled?: boolean;
	timeoutMs?: number;
	maxAttempts?: number;
	circuitFailureThreshold?: number;
	circuitCooldownMs?: number;
}>;

export type CreateOutboundWebhookEventInput = Readonly<{
	id?: string;
	type: OutboundWebhookEventType;
	occurredAt?: string;
	source: OutboundWebhookEventSource;
	correlationId?: string;
	subject?: OutboundWebhookSubject;
	data?: Readonly<Record<string, unknown>>;
}>;

export type EnqueueOutboundWebhookResult = Readonly<{
	event: OutboundWebhookEvent;
	matchedEndpoints: number;
	queuedDeliveries: number;
	duplicateDeliveries: number;
	deliveryIds: readonly string[];
}>;

export type OutboundWebhookDeliveryListOptions = Readonly<{
	endpointId?: string;
	status?: OutboundWebhookDeliveryStatus;
	eventType?: OutboundWebhookEventType;
	/** Resolves a single delivery by its originating event without a paginated scan. */
	eventId?: string;
	limit?: number;
}>;

export type DispatchOutboundWebhooksOptions = Readonly<{
	store?: OutboundWebhookStoreOptions;
	limit?: number;
	now?: Date;
	fetcher?: typeof fetch;
	resolveSecret?: (secretRef: string) => string | undefined;
	leaseMs?: number;
	baseRetryDelayMs?: number;
	concurrency?: number;
	deliveryIds?: readonly string[];
	bypassCircuitBreaker?: boolean;
}>;

export type OutboundWebhookDispatchErrorCode =
	| "endpoint_unavailable"
	| "delivery_unavailable"
	| "signing_secret_unavailable"
	| "url_policy_blocked"
	| "http_rejected"
	| "lease_conflict"
	| "delivery_state_conflict"
	| "delivery_failed";

type ReplayDeadLetterError = Readonly<{
	deliveryId: string;
	errorCode: OutboundWebhookDispatchErrorCode;
}>;

export type OutboundWebhookDispatchResultEntry =
	| Readonly<{
			deliveryId: string;
			endpointId: string;
			status: Extract<
				OutboundWebhookDeliveryStatus,
				"succeeded" | "retry" | "exhausted"
			>;
			statusCode?: number | undefined;
			errorCode?: OutboundWebhookDispatchErrorCode | undefined;
	  }>
	| Readonly<{
		deliveryId: string;
		endpointId: string;
		status: "skipped";
		errorCode: OutboundWebhookDispatchErrorCode;
	  }>;

export type DispatchOutboundWebhooksResult = Readonly<{
	claimed: number;
	succeeded: number;
	retried: number;
	exhausted: number;
	skipped: number;
	results: readonly OutboundWebhookDispatchResultEntry[];
}>;

export type ClaimedOutboundWebhookDelivery = Readonly<{
	delivery: OutboundWebhookDelivery;
	endpoint?: OutboundWebhookEndpoint | undefined;
}>;

export type CompleteOutboundWebhookDeliveryResult = Readonly<{
	success: boolean;
	retryable: boolean;
	statusCode?: number | undefined;
	error?: unknown;
}>;

export type ReconcileOutboundWebhooksOptions = Readonly<{
	now?: Date;
	limit?: number;
	dryRun?: boolean;
}>;

export type ReconcileOutboundWebhooksResult = Readonly<{
	scanned: number;
	recovered: number;
	exhausted: number;
	unchanged: number;
	dryRun: boolean;
}>;

export type PruneOutboundWebhooksOptions = Readonly<{
	before: Date;
	ids?: readonly string[];
	limit?: number;
	dryRun?: boolean;
}>;

export type ResolvedPruneOutboundWebhooksOptions = Readonly<{
	before: Date;
	ids: readonly string[] | undefined;
	limit: number;
	dryRun: boolean;
}>;

export type PruneOutboundWebhooksResult = Readonly<{
	eligible: number;
	deleted: number;
	dryRun: boolean;
	before: string;
	ids: readonly string[];
}>;

export type ReplayOutboundWebhookDeadLettersOptions = Readonly<{
	endpointId?: string;
	limit?: number;
	dryRun?: boolean;
	now?: Date;
}>;

export type ReplayOutboundWebhookDeadLettersResult = Readonly<{
	eligible: number;
	replayed: number;
	failed: number;
	dryRun: boolean;
	deliveryIds: readonly string[];
	errors: readonly ReplayDeadLetterError[];
}>;

export type OutboundWebhookRuntimeHealth = Readonly<{
	store: "file" | "postgres";
	schemaVersion: number;
	healthy: boolean;
	checkedAt: string;
	endpoints: Readonly<{
		total: number;
		enabled: number;
		circuitOpen: number;
	}>;
	deliveries: Readonly<
		Record<OutboundWebhookDeliveryStatus, number> & {
			due: number;
			deadLetter: number;
			oldestDueAt?: string | undefined;
		}
	>;
	workers: Readonly<{
		running: number;
		stale: number;
		stopped: number;
		failed: number;
		lastHeartbeatAt?: string | undefined;
	}>;
}>;

export type UpsertOutboundWebhookWorkerInput = Readonly<{
	id: string;
	status: OutboundWebhookWorkerStatus;
	startedAt: string;
	heartbeatAt: string;
	stoppedAt?: string;
	lastError?: string;
	lastTick?: OutboundWebhookWorker["lastTick"];
}>;

/**
 * Durable persistence contract shared by the file-backed runtime and the
 * Postgres implementation. Implementations own atomicity and lease fencing;
 * the transport, retry, signature, and redaction policy stays in this module.
 */
export interface OutboundWebhookRepository {
	readonly kind: "file" | "postgres";
	listEndpoints(): Promise<readonly OutboundWebhookEndpoint[]>;
	getEndpoint(id: string): Promise<OutboundWebhookEndpoint>;
	createEndpoint(
		endpoint: OutboundWebhookEndpoint,
	): Promise<OutboundWebhookEndpoint>;
	updateEndpoint(
		id: string,
		input: UpdateOutboundWebhookEndpointInput,
		now: Date,
	): Promise<OutboundWebhookEndpoint>;
	deleteEndpoint(
		id: string,
		now: Date,
	): Promise<OutboundWebhookEndpoint>;
	enqueue(
		event: OutboundWebhookEvent,
		options: Readonly<{
			endpointIds?: readonly string[];
			bypassEventFilters?: boolean;
			limit: number;
			now: Date;
		}>,
	): Promise<EnqueueOutboundWebhookResult>;
	listDeliveries(
		options: OutboundWebhookDeliveryListOptions,
	): Promise<readonly OutboundWebhookDelivery[]>;
	retryDelivery(
		id: string,
		now: Date,
	): Promise<RetryOutboundWebhookDeliveryResult>;
	claimDeliveries(options: Readonly<{
		limit: number;
		now: Date;
		leaseMs: number;
		deliveryIds?: readonly string[];
		excludeDeliveryIds?: readonly string[];
		bypassCircuitBreaker?: boolean;
	}>): Promise<readonly ClaimedOutboundWebhookDelivery[]>;
	completeDelivery(
		claimed: OutboundWebhookDelivery,
		result: CompleteOutboundWebhookDeliveryResult,
		endpoint: OutboundWebhookEndpoint | undefined,
		options: Readonly<{
			now: Date;
			baseRetryDelayMs: number;
		}>,
	): Promise<OutboundWebhookDelivery>;
	reconcile(
		options: Required<ReconcileOutboundWebhooksOptions>,
	): Promise<ReconcileOutboundWebhooksResult>;
	prune(
		options: ResolvedPruneOutboundWebhooksOptions,
	): Promise<PruneOutboundWebhooksResult>;
	getRuntimeHealth(options: Readonly<{
		now: Date;
		workerStaleMs: number;
	}>): Promise<OutboundWebhookRuntimeHealth>;
	upsertWorker(worker: UpsertOutboundWebhookWorkerInput): Promise<void>;
	resetEndpointCircuit(
		endpointId: string,
		now: Date,
	): Promise<OutboundWebhookEndpointRuntime>;
	close?(): Promise<void>;
}

const eventTypeSchema = z.enum(OUTBOUND_WEBHOOK_EVENT_TYPES);
const eventSourceSchema = z.enum([
	"listmonk",
	"provider",
	"operation",
	"abtest",
	"sequence",
	"webhook",
]);
const subjectKindSchema = z.enum([
	"operation",
	"campaign",
	"subscriber",
	"message",
	"experiment",
	"sequence",
	"webhook",
]);
const deliveryStatusSchema = z.enum([
	"pending",
	"delivering",
	"retry",
	"succeeded",
	"exhausted",
]);
const isoDateTimeSchema = z.iso.datetime({ offset: true });
const uuidSchema = z.uuid();
const secretRefSchema = z
	.string()
	.trim()
	.regex(
		OUTBOUND_WEBHOOK_SECRET_REF_PATTERN,
		"secret_ref must be LISTMONK_OPS_WEBHOOK_SECRET or use its dedicated prefix",
	);
export const outboundWebhookEventFilterSchema = z
	.string()
	.trim()
	.pipe(
		z.enum(OUTBOUND_WEBHOOK_EVENT_FILTERS, {
			error: "Unsupported event filter",
		}),
	);
const endpointSchema = z.object({
	id: uuidSchema,
	name: z.string().trim().min(1).max(120),
	url: z.string().trim().min(1),
	secretRef: secretRefSchema,
	eventFilters: z.array(outboundWebhookEventFilterSchema).min(1),
	enabled: z.boolean(),
	timeoutMs: z.number().int().min(100).max(30_000),
	maxAttempts: z.number().int().min(1).max(12),
	circuitFailureThreshold: z.number().int().min(1).max(100),
	circuitCooldownMs: z.number().int().min(1_000).max(86_400_000),
	createdAt: isoDateTimeSchema,
	updatedAt: isoDateTimeSchema,
});
const endpointRuntimeSchema = z.object({
	endpointId: uuidSchema,
	consecutiveFailures: z.number().int().nonnegative(),
	circuitState: z.enum(["closed", "open"]),
	circuitOpenedAt: isoDateTimeSchema.optional(),
	circuitOpenUntil: isoDateTimeSchema.optional(),
	lastFailureAt: isoDateTimeSchema.optional(),
	lastSuccessAt: isoDateTimeSchema.optional(),
});
const workerSchema = z.object({
	id: uuidSchema,
	status: z.enum(["running", "stopped", "failed"]),
	startedAt: isoDateTimeSchema,
	heartbeatAt: isoDateTimeSchema,
	stoppedAt: isoDateTimeSchema.optional(),
	lastError: z.string().max(500).optional(),
	lastTick: z
		.object({
			claimed: z.number().int().nonnegative(),
			succeeded: z.number().int().nonnegative(),
			retried: z.number().int().nonnegative(),
			exhausted: z.number().int().nonnegative(),
			completedAt: isoDateTimeSchema,
		})
		.optional(),
});
const eventSchema = z.object({
	id: uuidSchema,
	type: eventTypeSchema,
	schemaVersion: z.literal(OUTBOUND_WEBHOOK_EVENT_SCHEMA_VERSION),
	occurredAt: isoDateTimeSchema,
	source: eventSourceSchema,
	correlationId: z.string().trim().min(1).max(200).optional(),
	subject: z
		.object({
			kind: subjectKindSchema,
			key: z.string().trim().min(1).max(300),
		})
		.optional(),
	data: z.record(z.string(), z.unknown()),
});
const deliverySchema = z.object({
	id: uuidSchema,
	eventId: uuidSchema,
	endpointId: uuidSchema,
	event: eventSchema,
	status: deliveryStatusSchema,
	attemptCount: z.number().int().nonnegative(),
	manualRetryCount: z.number().int().nonnegative(),
	nextAttemptAt: isoDateTimeSchema,
	lastAttemptAt: isoDateTimeSchema.optional(),
	completedAt: isoDateTimeSchema.optional(),
	statusCode: z.number().int().min(100).max(599).optional(),
	lastError: z.string().max(500).optional(),
	leaseToken: uuidSchema.optional(),
	leaseExpiresAt: isoDateTimeSchema.optional(),
});
const storeSchema = z.object({
	version: z.literal(OUTBOUND_WEBHOOK_STORE_VERSION),
	endpoints: z.array(endpointSchema),
	deliveries: z.array(deliverySchema),
	endpointRuntime: z.array(endpointRuntimeSchema),
	workers: z.array(workerSchema),
});

const SENSITIVE_KEY_PATTERN =
	/(?:^|[_-])(?:authorization|cookie|email|password|passwd|recipient|secret|token|api[_-]?key)(?:$|[_-])/iu;
const MAX_REDACTION_DEPTH = 8;
const MAX_ERROR_LENGTH = 500;

export class OutboundWebhookNotFoundError extends Error {
	public constructor(kind: "endpoint" | "delivery", id: string) {
		super(`Outbound webhook ${kind} not found: ${id}`);
		this.name = "OutboundWebhookNotFoundError";
	}
}

export class OutboundWebhookConflictError extends Error {
	public constructor(
		message: string,
		public readonly code:
			| "conflict"
			| "endpoint_unavailable"
			| "delivery_state_conflict"
			| "lease_conflict" = "conflict",
	) {
		super(message);
		this.name = "OutboundWebhookConflictError";
	}
}

export class OutboundWebhookSignatureError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "OutboundWebhookSignatureError";
	}
}

function nowIso(now = new Date()): string {
	return now.toISOString();
}

export function mergeOutboundWebhookEndpointUpdate(
	previous: OutboundWebhookEndpoint,
	input: UpdateOutboundWebhookEndpointInput,
	now: Date,
): OutboundWebhookEndpoint {
	return endpointSchema.parse({
		...previous,
		...(input.name === undefined ? {} : { name: input.name }),
		...(input.url === undefined
			? {}
			: { url: normalizeOutboundWebhookEndpointUrl(input.url) }),
		...(input.secretRef === undefined ? {} : { secretRef: input.secretRef }),
		...(input.eventFilters === undefined
			? {}
			: { eventFilters: normalizeEventFilters(input.eventFilters) }),
		...(input.enabled === undefined ? {} : { enabled: input.enabled }),
		...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
		...(input.maxAttempts === undefined
			? {}
			: { maxAttempts: input.maxAttempts }),
		...(input.circuitFailureThreshold === undefined
			? {}
			: { circuitFailureThreshold: input.circuitFailureThreshold }),
		...(input.circuitCooldownMs === undefined
			? {}
			: { circuitCooldownMs: input.circuitCooldownMs }),
		updatedAt: nowIso(now),
	});
}

function parseStore(value: unknown): OutboundWebhookStore {
	if (
		typeof value === "object" &&
		value !== null &&
		"version" in value &&
		(value as { version?: unknown }).version === 1
	) {
		const legacy = value as {
			endpoints?: unknown[];
			deliveries?: unknown[];
		};
		value = {
			version: OUTBOUND_WEBHOOK_STORE_VERSION,
			endpoints: (legacy.endpoints ?? []).map((endpoint) => ({
				...(endpoint as Record<string, unknown>),
				circuitFailureThreshold:
					DEFAULT_OUTBOUND_WEBHOOK_CIRCUIT_FAILURE_THRESHOLD,
				circuitCooldownMs: DEFAULT_OUTBOUND_WEBHOOK_CIRCUIT_COOLDOWN_MS,
			})),
			deliveries: legacy.deliveries ?? [],
			endpointRuntime: [],
			workers: [],
		};
	}
	const parsed = storeSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`Invalid outbound webhook store: ${parsed.error.message}`);
	}
	return parsed.data;
}

export function parseOutboundWebhookEndpoint(
	value: unknown,
): OutboundWebhookEndpoint {
	return endpointSchema.parse(value);
}

export function parseOutboundWebhookEvent(
	value: unknown,
): OutboundWebhookEvent {
	return eventSchema.parse(value);
}

export function parseOutboundWebhookDelivery(
	value: unknown,
): OutboundWebhookDelivery {
	return deliverySchema.parse(value);
}

function resolveStoreLimit(limit: number | undefined): number {
	const resolved = limit ?? DEFAULT_OUTBOUND_WEBHOOK_STORE_LIMIT;
	if (!Number.isInteger(resolved) || resolved < 100) {
		throw new RangeError(
			"Outbound webhook store limit must be an integer of at least 100",
		);
	}
	return resolved;
}

export function getOutboundWebhookStorePath(): string {
	return (
		process.env.LISTMONK_OPS_WEBHOOK_STORE?.trim() ||
		join(homedir(), ".listmonk-ops", "outbound-webhooks.json")
	);
}

export function createOutboundWebhookStore(
	path = getOutboundWebhookStorePath(),
): JsonFileStore<OutboundWebhookStore> {
	return {
		path,
		createDefault: () => ({
			version: OUTBOUND_WEBHOOK_STORE_VERSION,
			endpoints: [],
			deliveries: [],
			endpointRuntime: [],
			workers: [],
		}),
		parse: parseStore,
		lock: { timeoutMs: 5_000 },
	};
}

async function persistFileOutboundWebhookEndpoint(
	endpoint: OutboundWebhookEndpoint,
	options: Pick<OutboundWebhookStoreOptions, "path">,
): Promise<OutboundWebhookEndpoint> {
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		if (
			current.endpoints.some(
				(candidate) =>
					candidate.name.toLowerCase() === endpoint.name.toLowerCase(),
			)
		) {
			throw new OutboundWebhookConflictError(
				`Outbound webhook endpoint name already exists: ${endpoint.name}`,
			);
		}
		return commitJsonFileStoreUpdate(
			{
				...current,
				endpoints: [...current.endpoints, endpoint],
			},
			endpoint,
		);
	});
}

export function createFileOutboundWebhookRepository(
	options: Omit<OutboundWebhookStoreOptions, "repository"> = {},
): OutboundWebhookRepository {
	const fileOptions = { path: options.path, limit: options.limit };
	return {
		kind: "file",
		listEndpoints: () => listOutboundWebhookEndpoints(fileOptions),
		getEndpoint: (id) => getOutboundWebhookEndpoint(id, fileOptions),
		createEndpoint: (endpoint) =>
			persistFileOutboundWebhookEndpoint(endpoint, fileOptions),
		updateEndpoint: (id, input, now) =>
			updateOutboundWebhookEndpoint(id, input, { ...fileOptions, now }),
		deleteEndpoint: (id, now) =>
			deleteOutboundWebhookEndpoint(id, { ...fileOptions, now }),
		enqueue: (event, enqueueOptions) =>
			enqueueOutboundWebhookEvent(
				{
					id: event.id,
					type: event.type,
					occurredAt: event.occurredAt,
					source: event.source,
					correlationId: event.correlationId,
					subject: event.subject,
					data: event.data,
				},
				{
					...fileOptions,
					endpointIds: enqueueOptions.endpointIds,
					bypassEventFilters: enqueueOptions.bypassEventFilters,
					limit: enqueueOptions.limit,
					now: enqueueOptions.now,
				},
			),
		listDeliveries: (listOptions) =>
			listOutboundWebhookDeliveries({ ...fileOptions, ...listOptions }),
		retryDelivery: (id, now) =>
			retryOutboundWebhookDelivery(id, { ...fileOptions, now }),
		claimDeliveries: (claimOptions) =>
			claimOutboundWebhookDeliveries({
				...fileOptions,
				...claimOptions,
			}),
		completeDelivery: (claimed, result, endpoint, completeOptions) =>
			completeOutboundWebhookDelivery(claimed, result, endpoint, {
				...fileOptions,
				...completeOptions,
			}),
		reconcile: (reconcileOptions) =>
			reconcileOutboundWebhookDeliveries({
				...fileOptions,
				...reconcileOptions,
			}),
		prune: (pruneOptions) =>
			pruneOutboundWebhookDeliveries({
				...fileOptions,
				...pruneOptions,
			}),
		getRuntimeHealth: (healthOptions) =>
			getOutboundWebhookRuntimeHealth({
				...fileOptions,
				...healthOptions,
			}),
		upsertWorker: (worker) => upsertOutboundWebhookWorker(worker, fileOptions),
		resetEndpointCircuit: (endpointId, now) =>
			resetOutboundWebhookEndpointCircuit(endpointId, {
				...fileOptions,
				now,
			}),
	};
}

export function normalizeOutboundWebhookEndpointUrl(value: string): string {
	let parsed: URL;
	try {
		parsed = new URL(value.trim());
	} catch {
		throw new TypeError("Outbound webhook URL must be a valid absolute URL");
	}
	if (parsed.protocol !== "https:") {
		throw new TypeError("Outbound webhook URL must use HTTPS");
	}
	if (parsed.username || parsed.password) {
		throw new TypeError("Outbound webhook URL must not contain credentials");
	}
	if (parsed.search || parsed.hash) {
		throw new TypeError(
			"Outbound webhook URL must not contain query parameters or a fragment",
		);
	}
	const safety = isSafeFetchUrl(parsed.toString());
	if (!safety.safe) {
		throw new TypeError(`Outbound webhook URL is unsafe: ${safety.reason}`);
	}
	return parsed.toString();
}

export function normalizeEventFilters(filters: readonly string[]): readonly string[] {
	const parsed = z
		.array(outboundWebhookEventFilterSchema)
		.min(1)
		.parse(filters);
	return [...new Set(parsed)];
}

export function isSupportedEventFilter(filter: string): boolean {
	const normalized = filter.trim();
	return OUTBOUND_WEBHOOK_EVENT_FILTERS.includes(
		normalized as OutboundWebhookEventFilter,
	);
}

export function matchesOutboundWebhookEvent(
	filters: readonly string[],
	eventType: OutboundWebhookEventType,
): boolean {
	return filters.some((filter) => {
		if (filter === "*") {
			return true;
		}
		if (filter.endsWith(".*")) {
			return eventType.startsWith(filter.slice(0, -1));
		}
		return filter === eventType;
	});
}

function redactValue(
	value: unknown,
	depth: number,
	seen: WeakSet<object>,
): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (depth >= MAX_REDACTION_DEPTH) {
		return "[TRUNCATED]";
	}
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (Array.isArray(value)) {
		return value.map((entry) => redactValue(entry, depth + 1, seen));
	}
	if (typeof value === "object") {
		if (seen.has(value)) {
			return "[CIRCULAR]";
		}
		seen.add(value);
		const output: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) {
			output[key] = isSensitiveKey(key)
				? "[REDACTED]"
				: redactValue(nested, depth + 1, seen);
		}
		seen.delete(value);
		return output;
	}
	return String(value);
}

function isSensitiveKey(key: string): boolean {
	const normalized = key.replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2");
	return SENSITIVE_KEY_PATTERN.test(normalized);
}

export function redactOutboundWebhookData(
	data: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
	return redactValue(data, 0, new WeakSet()) as Readonly<
		Record<string, unknown>
	>;
}

export function createOutboundWebhookEvent(
	input: CreateOutboundWebhookEventInput,
): OutboundWebhookEvent {
	return eventSchema.parse({
		id: input.id ?? randomUUID(),
		type: input.type,
		schemaVersion: OUTBOUND_WEBHOOK_EVENT_SCHEMA_VERSION,
		occurredAt: input.occurredAt ?? nowIso(),
		source: input.source,
		correlationId: input.correlationId?.trim() || undefined,
		subject: input.subject,
		data: redactOutboundWebhookData(input.data ?? {}),
	});
}

export async function listOutboundWebhookEndpoints(
	options: OutboundWebhookStoreOptions = {},
): Promise<readonly OutboundWebhookEndpoint[]> {
	if (options.repository) {
		return options.repository.listEndpoints();
	}
	const store = await readJsonFileStore(
		createOutboundWebhookStore(options.path),
	);
	return [...store.endpoints].sort((left, right) =>
		left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);
}

export async function getOutboundWebhookEndpoint(
	id: string,
	options: OutboundWebhookStoreOptions = {},
): Promise<OutboundWebhookEndpoint> {
	if (options.repository) {
		return options.repository.getEndpoint(id);
	}
	const endpoints = await listOutboundWebhookEndpoints(options);
	const endpoint = endpoints.find((candidate) => candidate.id === id);
	if (!endpoint) {
		throw new OutboundWebhookNotFoundError("endpoint", id);
	}
	return endpoint;
}

export async function createOutboundWebhookEndpoint(
	input: CreateOutboundWebhookEndpointInput,
	options: OutboundWebhookStoreOptions = {},
): Promise<OutboundWebhookEndpoint> {
	const at = nowIso();
	const endpoint = endpointSchema.parse({
		id: randomUUID(),
		name: input.name,
		url: normalizeOutboundWebhookEndpointUrl(input.url),
		secretRef: input.secretRef,
		eventFilters: normalizeEventFilters(input.eventFilters),
		enabled: input.enabled ?? true,
		timeoutMs: input.timeoutMs ?? DEFAULT_OUTBOUND_WEBHOOK_TIMEOUT_MS,
		maxAttempts:
			input.maxAttempts ?? DEFAULT_OUTBOUND_WEBHOOK_MAX_ATTEMPTS,
		circuitFailureThreshold:
			input.circuitFailureThreshold ??
			DEFAULT_OUTBOUND_WEBHOOK_CIRCUIT_FAILURE_THRESHOLD,
		circuitCooldownMs:
			input.circuitCooldownMs ??
			DEFAULT_OUTBOUND_WEBHOOK_CIRCUIT_COOLDOWN_MS,
		createdAt: at,
		updatedAt: at,
	});
	if (options.repository) {
		return options.repository.createEndpoint(endpoint);
	}
	return persistFileOutboundWebhookEndpoint(endpoint, options);
}

export async function updateOutboundWebhookEndpoint(
	id: string,
	input: UpdateOutboundWebhookEndpointInput,
	options: OutboundWebhookMutationOptions = {},
): Promise<OutboundWebhookEndpoint> {
	const now = options.now ?? new Date();
	if (options.repository) {
		return options.repository.updateEndpoint(id, input, now);
	}
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const index = current.endpoints.findIndex((endpoint) => endpoint.id === id);
		if (index < 0) {
			throw new OutboundWebhookNotFoundError("endpoint", id);
		}
		const previous = current.endpoints[index]!;
		const endpoint = mergeOutboundWebhookEndpointUpdate(previous, input, now);
		if (
			current.endpoints.some(
				(candidate) =>
					candidate.id !== id &&
					candidate.name.toLowerCase() === endpoint.name.toLowerCase(),
			)
		) {
			throw new OutboundWebhookConflictError(
				`Outbound webhook endpoint name already exists: ${endpoint.name}`,
			);
		}
		const endpoints = [...current.endpoints];
		endpoints[index] = endpoint;
		return commitJsonFileStoreUpdate(
			{ ...current, endpoints },
			endpoint,
		);
	});
}

export async function deleteOutboundWebhookEndpoint(
	id: string,
	options: OutboundWebhookMutationOptions = {},
): Promise<OutboundWebhookEndpoint> {
	const now = options.now ?? new Date();
	if (options.repository) {
		return options.repository.deleteEndpoint(id, now);
	}
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const endpoint = current.endpoints.find((candidate) => candidate.id === id);
		if (!endpoint) {
			throw new OutboundWebhookNotFoundError("endpoint", id);
		}
		const at = nowIso(now);
		return commitJsonFileStoreUpdate(
			{
				...current,
				endpoints: current.endpoints.filter(
					(candidate) => candidate.id !== id,
				),
				endpointRuntime: current.endpointRuntime.filter(
					(runtime) => runtime.endpointId !== id,
				),
				deliveries: current.deliveries.map((delivery) =>
					delivery.endpointId === id &&
					!["succeeded", "exhausted"].includes(delivery.status)
						? {
								...delivery,
								status: "exhausted" as const,
								completedAt: at,
								lastError: "Endpoint deleted before delivery",
								leaseToken: undefined,
								leaseExpiresAt: undefined,
							}
						: delivery,
				),
			},
			endpoint,
		);
	});
}

function pruneDeliveries(
	deliveries: readonly OutboundWebhookDelivery[],
	limit: number,
): readonly OutboundWebhookDelivery[] {
	if (deliveries.length <= limit) {
		return deliveries;
	}
	const terminal = deliveries
		.filter((delivery) =>
			["succeeded", "exhausted"].includes(delivery.status),
		)
		.sort((left, right) =>
			(left.completedAt ?? left.nextAttemptAt).localeCompare(
				right.completedAt ?? right.nextAttemptAt,
			),
		);
	const remove = new Set(
		terminal
			.slice(0, Math.max(0, deliveries.length - limit))
			.map((delivery) => delivery.id),
	);
	const pruned = deliveries.filter((delivery) => !remove.has(delivery.id));
	if (pruned.length > limit) {
		throw new OutboundWebhookConflictError(
			"Outbound webhook store is full of active deliveries",
		);
	}
	return pruned;
}

export async function enqueueOutboundWebhookEvent(
	input: CreateOutboundWebhookEventInput,
	options: OutboundWebhookStoreOptions & {
		endpointIds?: readonly string[];
		bypassEventFilters?: boolean;
		now?: Date;
	} = {},
): Promise<EnqueueOutboundWebhookResult> {
	const event = createOutboundWebhookEvent(input);
	const selected = options.endpointIds
		? new Set(options.endpointIds)
		: undefined;
	const limit = resolveStoreLimit(options.limit);
	if (options.repository) {
		return options.repository.enqueue(event, {
			endpointIds: options.endpointIds,
			bypassEventFilters: options.bypassEventFilters,
			limit,
			now: options.now ?? new Date(),
		});
	}
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const endpoints = current.endpoints.filter(
			(endpoint) =>
				endpoint.enabled &&
				(selected === undefined || selected.has(endpoint.id)) &&
				(options.bypassEventFilters === true ||
					matchesOutboundWebhookEvent(endpoint.eventFilters, event.type)),
		);
		const existingKeys = new Set(
			current.deliveries.map(
				(delivery) => `${delivery.eventId}:${delivery.endpointId}`,
			),
		);
		let duplicateDeliveries = 0;
		const queued = endpoints.flatMap((endpoint) => {
			const key = `${event.id}:${endpoint.id}`;
			if (existingKeys.has(key)) {
				duplicateDeliveries += 1;
				return [];
			}
			return [
				deliverySchema.parse({
					id: randomUUID(),
					eventId: event.id,
					endpointId: endpoint.id,
					event,
					status: "pending",
					attemptCount: 0,
					manualRetryCount: 0,
					nextAttemptAt: nowIso(options.now),
				}),
			];
		});
		const deliveries = pruneDeliveries(
			[...current.deliveries, ...queued],
			limit,
		);
		return commitJsonFileStoreUpdate(
			{ ...current, deliveries },
			{
				event,
				matchedEndpoints: endpoints.length,
				queuedDeliveries: queued.length,
				duplicateDeliveries,
				deliveryIds: queued.map((delivery) => delivery.id),
			},
		);
	});
}

/**
 * Projects the existing privacy-preserving operation audit metadata into the
 * typed event envelope. The helper avoids creating an empty outbox file when
 * no enabled endpoint subscribes to operation lifecycle events.
 */
export async function enqueueOperationLifecycleEvent(
	input: Required<Pick<RecordOperationAuditInput, "executionId">> &
		RecordOperationAuditInput,
	options: OutboundWebhookStoreOptions = {},
): Promise<EnqueueOutboundWebhookResult> {
	const event = createOutboundWebhookEvent({
		type: `operation.${input.event}`,
		source: "operation",
		correlationId: input.executionId,
		occurredAt: input.at,
		subject: { kind: "operation", key: input.operationId },
		data: {
			surface: input.surface,
			confirmation_required: input.confirmationRequired,
			confirmed: input.confirmed,
			dry_run: input.dryRun,
		},
	});
	const endpoints = await listOutboundWebhookEndpoints(options);
	const matched = endpoints.filter(
		(endpoint) =>
			endpoint.enabled &&
			matchesOutboundWebhookEvent(endpoint.eventFilters, event.type),
	);
	if (matched.length === 0) {
		return {
			event,
			matchedEndpoints: 0,
			queuedDeliveries: 0,
			duplicateDeliveries: 0,
			deliveryIds: [],
		};
	}
	return enqueueOutboundWebhookEvent(event, {
		...options,
		endpointIds: matched.map((endpoint) => endpoint.id),
	});
}

/**
 * Persists the canonical metadata-only audit event first, then best-effort
 * projects the same execution into the outbound event outbox. A webhook store
 * failure must never replace an operation result or invite a duplicate retry.
 */
export async function recordOperationAuditWithLifecycle(
	input: RecordOperationAuditInput,
	options: Readonly<{
		audit?: OperationAuditStoreOptions;
		webhook?: OutboundWebhookStoreOptions;
		onLifecycleError?: (error: unknown) => void;
	}> = {},
): Promise<OperationAuditEntry> {
	const entry = await recordOperationAudit(input, options.audit);
	try {
		await enqueueOperationLifecycleEvent(
			{
				...input,
				executionId: entry.executionId,
				at: entry.at,
			},
			options.webhook,
		);
	} catch (error) {
		try {
			options.onLifecycleError?.(error);
		} catch {
			// Observability reporting must not shadow the durable audit result.
		}
	}
	return entry;
}

export async function listOutboundWebhookDeliveries(
	options: OutboundWebhookDeliveryListOptions &
		OutboundWebhookStoreOptions = {},
): Promise<readonly OutboundWebhookDelivery[]> {
	const limit = options.limit ?? 100;
	if (!Number.isInteger(limit) || limit <= 0 || limit > 1_000) {
		throw new RangeError("Delivery list limit must be between 1 and 1000");
	}
	if (options.repository) {
		return options.repository.listDeliveries({
			endpointId: options.endpointId,
			status: options.status,
			eventType: options.eventType,
			eventId: options.eventId,
			limit,
		});
	}
	const store = await readJsonFileStore(
		createOutboundWebhookStore(options.path),
	);
	return store.deliveries
		.filter(
			(delivery) =>
				(options.endpointId === undefined ||
					delivery.endpointId === options.endpointId) &&
				(options.eventId === undefined ||
					delivery.eventId === options.eventId) &&
				(options.status === undefined ||
					delivery.status === options.status) &&
				(options.eventType === undefined ||
					delivery.event.type === options.eventType),
		)
		.sort(
			(left, right) =>
				right.nextAttemptAt.localeCompare(left.nextAttemptAt) ||
				right.id.localeCompare(left.id),
		)
		.slice(0, limit);
}

export type RetryOutboundWebhookDeliveryResult = Readonly<{
	delivery: OutboundWebhookDelivery;
	retried: boolean;
}>;

export async function retryOutboundWebhookDelivery(
	id: string,
	options: OutboundWebhookMutationOptions = {},
): Promise<RetryOutboundWebhookDeliveryResult> {
	const now = options.now ?? new Date();
	if (options.repository) {
		return options.repository.retryDelivery(id, now);
	}
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const index = current.deliveries.findIndex(
			(delivery) => delivery.id === id,
		);
		if (index < 0) {
			throw new OutboundWebhookNotFoundError("delivery", id);
		}
		const previous = current.deliveries[index]!;
		if (previous.status === "pending") {
			// The requested effect — the delivery queued for dispatch — is
			// already satisfied, so an ambiguous retry repeats as a no-op.
			const result: RetryOutboundWebhookDeliveryResult = {
				delivery: previous,
				retried: false,
			};
			return commitJsonFileStoreUpdate(current, result);
		}
		if (!["retry", "exhausted"].includes(previous.status)) {
			throw new OutboundWebhookConflictError(
				`Delivery ${id} cannot be retried from status ${previous.status}`,
				"delivery_state_conflict",
			);
		}
		if (
			!current.endpoints.some(
				(endpoint) => endpoint.id === previous.endpointId && endpoint.enabled,
			)
		) {
			throw new OutboundWebhookConflictError(
				`Delivery ${id} endpoint is missing or disabled`,
				"endpoint_unavailable",
			);
		}
		const delivery = deliverySchema.parse({
			...previous,
			status: "pending",
			attemptCount: 0,
			manualRetryCount: previous.manualRetryCount + 1,
			nextAttemptAt: nowIso(now),
			lastAttemptAt: undefined,
			completedAt: undefined,
			statusCode: undefined,
			lastError: undefined,
			leaseToken: undefined,
			leaseExpiresAt: undefined,
		});
		const deliveries = [...current.deliveries];
		deliveries[index] = delivery;
		const retriedResult: RetryOutboundWebhookDeliveryResult = {
			delivery,
			retried: true,
		};
		return commitJsonFileStoreUpdate(
			{ ...current, deliveries },
			retriedResult,
		);
	});
}

function classifyReplayDeadLetterError(
	error: unknown,
): OutboundWebhookDispatchErrorCode {
	if (error instanceof OutboundWebhookNotFoundError) {
		return "delivery_unavailable";
	}
	if (error instanceof OutboundWebhookConflictError) {
		if (error.code === "endpoint_unavailable") {
			return "endpoint_unavailable";
		}
		if (error.code === "lease_conflict") {
			return "lease_conflict";
		}
		return "delivery_state_conflict";
	}
	return "delivery_failed";
}

export async function replayOutboundWebhookDeadLetters(
	options: ReplayOutboundWebhookDeadLettersOptions &
		OutboundWebhookStoreOptions = {},
): Promise<ReplayOutboundWebhookDeadLettersResult> {
	const limit = resolveMaintenanceLimit(options.limit);
	const dryRun = options.dryRun ?? true;
	if (!options.repository) {
		const now = options.now ?? new Date();
		const store = createOutboundWebhookStore(options.path);
		return updateJsonFileStore(store, (current) => {
			const deliveries = current.deliveries
				.filter(
					(delivery) =>
						delivery.status === "exhausted" &&
						(options.endpointId === undefined ||
							delivery.endpointId === options.endpointId),
				)
				.sort((left, right) =>
					right.nextAttemptAt.localeCompare(left.nextAttemptAt),
				)
				.slice(0, limit);
			if (dryRun) {
				return commitJsonFileStoreUpdate(current, {
					eligible: deliveries.length,
					replayed: 0,
					failed: 0,
					dryRun: true,
					deliveryIds: deliveries.map((delivery) => delivery.id),
					errors: [],
				});
			}
			const enabledEndpointIds = new Set(
				current.endpoints
					.filter((endpoint) => endpoint.enabled)
					.map((endpoint) => endpoint.id),
			);
			const replacements = new Map<string, OutboundWebhookDelivery>();
			const errors: ReplayDeadLetterError[] = [];
			for (const delivery of deliveries) {
				if (!enabledEndpointIds.has(delivery.endpointId)) {
					errors.push({
						deliveryId: delivery.id,
						errorCode: "endpoint_unavailable",
					});
					continue;
				}
				replacements.set(
					delivery.id,
					deliverySchema.parse({
						...delivery,
						status: "pending",
						attemptCount: 0,
						manualRetryCount: delivery.manualRetryCount + 1,
						nextAttemptAt: nowIso(now),
						lastAttemptAt: undefined,
						completedAt: undefined,
						statusCode: undefined,
						lastError: undefined,
						leaseToken: undefined,
						leaseExpiresAt: undefined,
					}),
				);
			}
			const deliveryIds = [...replacements.keys()];
			const result: ReplayOutboundWebhookDeadLettersResult = {
				eligible: deliveries.length,
				replayed: deliveryIds.length,
				failed: errors.length,
				dryRun: false,
				deliveryIds,
				errors,
			};
			return commitJsonFileStoreUpdate(
				replacements.size === 0
					? current
					: {
							...current,
							deliveries: current.deliveries.map(
								(delivery) =>
									replacements.get(delivery.id) ?? delivery,
							),
						},
				result,
			);
		});
	}
	const deliveries = await listOutboundWebhookDeliveries({
		...options,
		endpointId: options.endpointId,
		status: "exhausted",
		limit,
	});
	if (dryRun) {
		return {
			eligible: deliveries.length,
			replayed: 0,
			failed: 0,
			dryRun: true,
			deliveryIds: deliveries.map((delivery) => delivery.id),
			errors: [],
		};
	}
	const deliveryIds: string[] = [];
	const errors: ReplayDeadLetterError[] = [];
	const replayConcurrency = 10;
	for (let offset = 0; offset < deliveries.length; offset += replayConcurrency) {
		const batch = deliveries.slice(offset, offset + replayConcurrency);
		const results = await Promise.all(
			batch.map(async (delivery) => {
				try {
					const { retried } = await retryOutboundWebhookDelivery(
						delivery.id,
						{
							...options,
							now: options.now,
						},
					);
					return {
						deliveryId: delivery.id,
						error: undefined,
						errorCode: undefined,
						// A concurrent replay may have requeued this delivery
						// already; report it so the aggregate count stays honest.
						retried,
					};
				} catch (error) {
					return {
						deliveryId: delivery.id,
						error: truncateOutboundWebhookError(error),
						errorCode: classifyReplayDeadLetterError(error),
					};
				}
			}),
		);
		for (const result of results) {
			if (result.error === undefined && result.retried) {
				deliveryIds.push(result.deliveryId);
			} else if (result.error === undefined) {
				continue;
			} else {
				errors.push({
					deliveryId: result.deliveryId,
					errorCode: result.errorCode,
				});
			}
		}
	}
	return {
		eligible: deliveries.length,
		replayed: deliveryIds.length,
		failed: errors.length,
		dryRun: false,
		deliveryIds,
		errors,
	};
}

function resolveMaintenanceLimit(limit: number | undefined): number {
	const resolved = limit ?? 100;
	if (!Number.isInteger(resolved) || resolved <= 0 || resolved > 1_000) {
		throw new RangeError(
			"Webhook maintenance limit must be between 1 and 1000",
		);
	}
	return resolved;
}

/**
 * Recover deliveries left in `delivering` after a worker crash. Active
 * endpoints are returned to retry; missing or disabled endpoints are exhausted.
 * Lease ownership is always cleared so an old worker cannot commit afterward.
 */
export async function reconcileOutboundWebhookDeliveries(
	options: ReconcileOutboundWebhooksOptions &
		OutboundWebhookStoreOptions = {},
): Promise<ReconcileOutboundWebhooksResult> {
	const resolved = {
		now: options.now ?? new Date(),
		limit: resolveMaintenanceLimit(options.limit),
		dryRun: options.dryRun ?? false,
	};
	if (options.repository) {
		return options.repository.reconcile(resolved);
	}

	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const nowMs = resolved.now.getTime();
		const candidates = current.deliveries
			.filter((delivery) => delivery.status === "delivering")
			.sort((left, right) =>
				(left.leaseExpiresAt ?? left.lastAttemptAt ?? left.nextAttemptAt)
					.localeCompare(
						right.leaseExpiresAt ??
							right.lastAttemptAt ??
							right.nextAttemptAt,
					),
			)
			.slice(0, resolved.limit);
		const endpointsById = new Map(
			current.endpoints.map((endpoint) => [endpoint.id, endpoint]),
		);
		let recovered = 0;
		let exhausted = 0;
		let unchanged = 0;
		const replacements = new Map<string, OutboundWebhookDelivery>();

		for (const delivery of candidates) {
			const leaseExpired =
				delivery.leaseExpiresAt === undefined ||
				Date.parse(delivery.leaseExpiresAt) <= nowMs;
			if (!leaseExpired) {
				unchanged += 1;
				continue;
			}
			const endpoint = endpointsById.get(delivery.endpointId);
			const canRetry =
				endpoint?.enabled === true &&
				delivery.attemptCount < endpoint.maxAttempts;
			const lastError = outboundWebhookLeaseReconciliationError(
				canRetry,
				endpoint?.enabled === true,
			);
			if (canRetry) {
				recovered += 1;
			} else {
				exhausted += 1;
			}
			replacements.set(
				delivery.id,
				deliverySchema.parse({
					...delivery,
					status: canRetry ? "retry" : "exhausted",
					nextAttemptAt: resolved.now.toISOString(),
					completedAt: canRetry
						? undefined
						: resolved.now.toISOString(),
					lastError,
					leaseToken: undefined,
					leaseExpiresAt: undefined,
				}),
			);
		}

		const result: ReconcileOutboundWebhooksResult = {
			scanned: candidates.length,
			recovered,
			exhausted,
			unchanged,
			dryRun: resolved.dryRun,
		};
		if (resolved.dryRun || replacements.size === 0) {
			return commitJsonFileStoreUpdate(current, result);
		}
		return commitJsonFileStoreUpdate(
			{
				...current,
				deliveries: current.deliveries.map(
					(delivery) => replacements.get(delivery.id) ?? delivery,
				),
			},
			result,
		);
	});
}

/**
 * Remove bounded terminal delivery history older than `before`. Active and
 * retryable records are never eligible, even when their timestamps are old.
 * Without `ids`, the oldest eligible batch up to `limit` is selected; with
 * `ids`, exactly that set is matched against the same terminal/cutoff
 * criteria (stale or non-terminal ids are silently skipped) and `limit`
 * and oldest-first ordering do not apply.
 */
export async function pruneOutboundWebhookDeliveries(
	options: PruneOutboundWebhooksOptions &
		OutboundWebhookStoreOptions,
): Promise<PruneOutboundWebhooksResult> {
	if (!Number.isFinite(options.before.getTime())) {
		throw new TypeError("Webhook prune cutoff must be a valid date");
	}
	const resolved: ResolvedPruneOutboundWebhooksOptions = {
		before: options.before,
		ids: options.ids,
		limit: resolveMaintenanceLimit(options.limit),
		dryRun: options.dryRun ?? false,
	};
	if (options.repository) {
		return options.repository.prune(resolved);
	}

	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const requestedIds =
			resolved.ids === undefined ? undefined : new Set(resolved.ids);
		const matchesCutoff = (delivery: OutboundWebhookDelivery) =>
			["succeeded", "exhausted"].includes(delivery.status) &&
			delivery.completedAt !== undefined &&
			Date.parse(delivery.completedAt) < resolved.before.getTime();
		const candidates = requestedIds
			? current.deliveries.filter(
					(delivery) => requestedIds.has(delivery.id) && matchesCutoff(delivery),
				)
			: current.deliveries
					.filter(matchesCutoff)
					.sort((left, right) =>
						(left.completedAt ?? "").localeCompare(right.completedAt ?? ""),
					)
					.slice(0, resolved.limit);
		const eligibleIds = candidates.map((delivery) => delivery.id);
		const eligible = new Set(eligibleIds);
		const result: PruneOutboundWebhooksResult = {
			eligible: eligible.size,
			deleted: resolved.dryRun ? 0 : eligible.size,
			dryRun: resolved.dryRun,
			before: resolved.before.toISOString(),
			ids: eligibleIds,
		};
		if (resolved.dryRun || eligible.size === 0) {
			return commitJsonFileStoreUpdate(current, result);
		}
		return commitJsonFileStoreUpdate(
			{
				...current,
				deliveries: current.deliveries.filter(
					(delivery) => !eligible.has(delivery.id),
				),
			},
			result,
		);
	});
}

async function claimOutboundWebhookDeliveries(
	options: OutboundWebhookStoreOptions & {
		limit: number;
		now: Date;
		leaseMs: number;
		deliveryIds?: readonly string[];
		excludeDeliveryIds?: readonly string[];
		bypassCircuitBreaker?: boolean;
	},
): Promise<readonly ClaimedOutboundWebhookDelivery[]> {
	if (options.repository) {
		return options.repository.claimDeliveries({
			limit: options.limit,
			now: options.now,
			leaseMs: options.leaseMs,
			deliveryIds: options.deliveryIds,
			excludeDeliveryIds: options.excludeDeliveryIds,
			bypassCircuitBreaker: options.bypassCircuitBreaker,
		});
	}
	const store = createOutboundWebhookStore(options.path);
	const at = options.now.getTime();
	return updateJsonFileStore(store, (current) => {
		const selected = options.deliveryIds
			? new Set(options.deliveryIds)
			: undefined;
		const excluded = new Set(options.excludeDeliveryIds ?? []);
		const circuitOpenUntilByEndpoint = new Map(
			current.endpointRuntime
				.filter(
					(runtime) =>
						runtime.circuitState === "open" &&
						runtime.circuitOpenUntil !== undefined,
				)
				.map((runtime) => [
					runtime.endpointId,
					Date.parse(runtime.circuitOpenUntil!),
				]),
		);
		const claimable = current.deliveries
			.filter((delivery) => {
				const circuitOpenUntil = circuitOpenUntilByEndpoint.get(
					delivery.endpointId,
				);
				if (
					!options.bypassCircuitBreaker &&
					circuitOpenUntil !== undefined &&
					circuitOpenUntil > at
				) {
					return false;
				}
				if (excluded.has(delivery.id)) {
					return false;
				}
				if (selected !== undefined && !selected.has(delivery.id)) {
					return false;
				}
				if (delivery.status === "delivering") {
					return (
						delivery.leaseExpiresAt !== undefined &&
						Date.parse(delivery.leaseExpiresAt) <= at
					);
				}
				return (
					["pending", "retry"].includes(delivery.status) &&
					Date.parse(delivery.nextAttemptAt) <= at
				);
			})
			.sort((left, right) =>
				left.nextAttemptAt.localeCompare(right.nextAttemptAt),
			)
			.slice(0, options.limit);
		const claimedById = new Map<string, OutboundWebhookDelivery>();
		for (const delivery of claimable) {
			claimedById.set(
				delivery.id,
				deliverySchema.parse({
					...delivery,
					status: "delivering",
					attemptCount: delivery.attemptCount + 1,
					lastAttemptAt: options.now.toISOString(),
					leaseToken: randomUUID(),
					leaseExpiresAt: new Date(at + options.leaseMs).toISOString(),
				}),
			);
		}
		const deliveries = current.deliveries.map(
			(delivery) => claimedById.get(delivery.id) ?? delivery,
		);
		const endpointById = new Map(
			current.endpoints.map((endpoint) => [endpoint.id, endpoint] as const),
		);
		return commitJsonFileStoreUpdate(
			{ ...current, deliveries },
			[...claimedById.values()].map((delivery) => ({
				delivery,
				endpoint: endpointById.get(delivery.endpointId),
			})),
		);
	});
}

export function truncateOutboundWebhookError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replaceAll(/[\r\n\t]+/gu, " ").slice(0, MAX_ERROR_LENGTH);
}

export function outboundWebhookLeaseReconciliationError(
	canRetry: boolean,
	endpointEnabled: boolean,
): string {
	if (canRetry) {
		return "Recovered expired worker lease";
	}
	if (endpointEnabled) {
		return "Maximum delivery attempts reached during lease reconciliation";
	}
	return "Endpoint missing or disabled during lease reconciliation";
}

export function outboundWebhookRetryDelayMs(
	attemptCount: number,
	baseDelayMs: number,
): number {
	return Math.min(
		MAX_OUTBOUND_WEBHOOK_RETRY_DELAY_MS,
		baseDelayMs * 2 ** Math.max(0, attemptCount - 1),
	);
}

async function completeOutboundWebhookDelivery(
	claimed: OutboundWebhookDelivery,
	result: CompleteOutboundWebhookDeliveryResult,
	endpoint: OutboundWebhookEndpoint | undefined,
	options: OutboundWebhookStoreOptions & {
		now: Date;
		baseRetryDelayMs: number;
	},
): Promise<OutboundWebhookDelivery> {
	if (options.repository) {
		return options.repository.completeDelivery(claimed, result, endpoint, {
			now: options.now,
			baseRetryDelayMs: options.baseRetryDelayMs,
		});
	}
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const index = current.deliveries.findIndex(
			(delivery) => delivery.id === claimed.id,
		);
		if (index < 0) {
			throw new OutboundWebhookNotFoundError("delivery", claimed.id);
		}
		const latest = current.deliveries[index]!;
		if (
			latest.status !== "delivering" ||
			latest.leaseToken !== claimed.leaseToken
		) {
			throw new OutboundWebhookConflictError(
				`Delivery ${claimed.id} lease is no longer owned by this worker`,
				"lease_conflict",
			);
		}
		const exhausted =
			!result.success &&
			(!result.retryable ||
				endpoint === undefined ||
				latest.attemptCount >= endpoint.maxAttempts);
		const status: OutboundWebhookDeliveryStatus = result.success
			? "succeeded"
			: exhausted
				? "exhausted"
				: "retry";
		const delivery = deliverySchema.parse({
			...latest,
			status,
			nextAttemptAt:
				status === "retry"
					? new Date(
							options.now.getTime() +
								outboundWebhookRetryDelayMs(
									latest.attemptCount,
									options.baseRetryDelayMs,
								),
						).toISOString()
					: latest.nextAttemptAt,
			completedAt:
				status === "succeeded" || status === "exhausted"
					? options.now.toISOString()
					: undefined,
			statusCode: result.statusCode,
			lastError:
				result.error === undefined
					? undefined
					: truncateOutboundWebhookError(result.error),
			leaseToken: undefined,
			leaseExpiresAt: undefined,
		});
		const deliveries = [...current.deliveries];
		deliveries[index] = delivery;
		const endpointRuntime = updateEndpointRuntimeAfterAttempt(
			current.endpointRuntime,
			endpoint,
			result,
			options.now,
		);
		return commitJsonFileStoreUpdate(
			{ ...current, deliveries, endpointRuntime },
			delivery,
		);
	});
}

function updateEndpointRuntimeAfterAttempt(
	runtimes: readonly OutboundWebhookEndpointRuntime[],
	endpoint: OutboundWebhookEndpoint | undefined,
	result: CompleteOutboundWebhookDeliveryResult,
	now: Date,
): readonly OutboundWebhookEndpointRuntime[] {
	if (!endpoint) {
		return runtimes;
	}
	// Disabling an endpoint is an administrative action, not a transport
	// failure. Backlog terminalization must not advance or open its circuit.
	if (!endpoint.enabled && !result.success) {
		return runtimes;
	}
	const index = runtimes.findIndex(
		(runtime) => runtime.endpointId === endpoint.id,
	);
	const previous =
		index >= 0
			? runtimes[index]!
			: endpointRuntimeSchema.parse({
					endpointId: endpoint.id,
					consecutiveFailures: 0,
					circuitState: "closed",
				});
	const at = now.toISOString();
	const consecutiveFailures = result.success
		? 0
		: previous.consecutiveFailures + 1;
	const shouldOpen =
		!result.success &&
		consecutiveFailures >= endpoint.circuitFailureThreshold;
	const next = endpointRuntimeSchema.parse({
		...previous,
		consecutiveFailures,
		circuitState: shouldOpen ? "open" : "closed",
		circuitOpenedAt: shouldOpen ? at : undefined,
		circuitOpenUntil: shouldOpen
			? new Date(now.getTime() + endpoint.circuitCooldownMs).toISOString()
			: undefined,
		lastFailureAt: result.success ? previous.lastFailureAt : at,
		lastSuccessAt: result.success ? at : previous.lastSuccessAt,
	});
	if (index < 0) {
		return [...runtimes, next];
	}
	const updated = [...runtimes];
	updated[index] = next;
	return updated;
}

export async function resetOutboundWebhookEndpointCircuit(
	endpointId: string,
	options: OutboundWebhookMutationOptions = {},
): Promise<OutboundWebhookEndpointRuntime> {
	const now = options.now ?? new Date();
	if (options.repository) {
		return options.repository.resetEndpointCircuit(endpointId, now);
	}
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		if (!current.endpoints.some((endpoint) => endpoint.id === endpointId)) {
			throw new OutboundWebhookNotFoundError("endpoint", endpointId);
		}
		// Short-circuit when the circuit is already closed with zero failures
		// so a reset retry is a true no-op, matching the spec's idempotent claim.
		// An endpoint with no runtime record has never delivered, which the rest
		// of the circuit logic treats as the default closed/zero state.
		const existing = current.endpointRuntime.find(
			(candidate) => candidate.endpointId === endpointId,
		);
		if (
			existing === undefined ||
			(existing.circuitState === "closed" &&
				existing.consecutiveFailures === 0)
		) {
			if (existing !== undefined) {
				return commitJsonFileStoreUpdate(current, existing);
			}
			const defaultRuntime = endpointRuntimeSchema.parse({
				endpointId,
				consecutiveFailures: 0,
				circuitState: "closed",
			});
			return commitJsonFileStoreUpdate(current, defaultRuntime);
		}
		const {
			circuitOpenedAt: _circuitOpenedAt,
			circuitOpenUntil: _circuitOpenUntil,
			...runtimeHistory
		} = existing;
		const runtime = endpointRuntimeSchema.parse({
			...runtimeHistory,
			consecutiveFailures: 0,
			circuitState: "closed",
		});
		const endpointRuntime = [
			...current.endpointRuntime.filter(
				(candidate) => candidate.endpointId !== endpointId,
			),
			runtime,
		];
		return commitJsonFileStoreUpdate(
			{ ...current, endpointRuntime },
			runtime,
		);
	});
}

export async function upsertOutboundWebhookWorker(
	input: UpsertOutboundWebhookWorkerInput,
	options: OutboundWebhookStoreOptions = {},
): Promise<void> {
	if (options.repository) {
		await options.repository.upsertWorker(input);
		return;
	}
	const worker = workerSchema.parse(input);
	const store = createOutboundWebhookStore(options.path);
	await updateJsonFileStore(store, (current) => {
		const retentionCutoff =
			Date.parse(worker.heartbeatAt) -
			DEFAULT_OUTBOUND_WEBHOOK_WORKER_RETENTION_MS;
		const workers = [
			...current.workers.filter(
				(candidate) => {
					if (candidate.id === worker.id) {
						return false;
					}
					const retainedAt =
						candidate.status === "running"
							? candidate.heartbeatAt
							: (candidate.stoppedAt ?? candidate.heartbeatAt);
					return Date.parse(retainedAt) >= retentionCutoff;
				},
			),
			worker,
		];
		return commitJsonFileStoreUpdate({ ...current, workers }, undefined);
	});
}

export async function getOutboundWebhookRuntimeHealth(
	options: OutboundWebhookStoreOptions & {
		now?: Date;
		workerStaleMs?: number;
	} = {},
): Promise<OutboundWebhookRuntimeHealth> {
	const now = options.now ?? new Date();
	const workerStaleMs =
		options.workerStaleMs ??
		DEFAULT_OUTBOUND_WEBHOOK_WORKER_HEARTBEAT_STALE_MS;
	if (
		!Number.isInteger(workerStaleMs) ||
		workerStaleMs < 1_000 ||
		workerStaleMs > 86_400_000
	) {
		throw new RangeError(
			"Webhook worker stale threshold must be between 1000 and 86400000ms",
		);
	}
	if (options.repository) {
		return options.repository.getRuntimeHealth({ now, workerStaleMs });
	}
	const store = await readJsonFileStore(
		createOutboundWebhookStore(options.path),
	);
	return summarizeOutboundWebhookRuntimeHealth(
		"file",
		store.endpoints,
		store.deliveries,
		store.endpointRuntime,
		store.workers,
		now,
		workerStaleMs,
	);
}

export function summarizeOutboundWebhookRuntimeHealth(
	store: "file" | "postgres",
	endpoints: readonly OutboundWebhookEndpoint[],
	deliveries: readonly OutboundWebhookDelivery[],
	endpointRuntime: readonly OutboundWebhookEndpointRuntime[],
	workers: readonly OutboundWebhookWorker[],
	now: Date,
	workerStaleMs: number,
): OutboundWebhookRuntimeHealth {
	const nowMs = now.getTime();
	const statusCounts: Record<OutboundWebhookDeliveryStatus, number> = {
		pending: 0,
		delivering: 0,
		retry: 0,
		succeeded: 0,
		exhausted: 0,
	};
	for (const delivery of deliveries) {
		statusCounts[delivery.status] += 1;
	}
	const due = deliveries.filter(
		(delivery) => {
			if (["pending", "retry"].includes(delivery.status)) {
				return Date.parse(delivery.nextAttemptAt) <= nowMs;
			}
			return (
				delivery.status === "delivering" &&
				(delivery.leaseExpiresAt === undefined ||
					Date.parse(delivery.leaseExpiresAt) <= nowMs)
			);
		},
	);
	const runningWorkers = workers.filter(
		(worker) => worker.status === "running",
	);
	const staleWorkers = runningWorkers.filter(
		(worker) => nowMs - Date.parse(worker.heartbeatAt) > workerStaleMs,
	);
	const activeWorkers = runningWorkers.filter(
		(worker) => nowMs - Date.parse(worker.heartbeatAt) <= workerStaleMs,
	);
	const lastHeartbeatAt = activeWorkers
		.map((worker) => worker.heartbeatAt)
		.sort((left, right) => Date.parse(left) - Date.parse(right))
		.at(-1);
	const circuitOpen = endpointRuntime.filter(
		(runtime) =>
			runtime.circuitState === "open" &&
			(runtime.circuitOpenUntil === undefined ||
				Date.parse(runtime.circuitOpenUntil) > nowMs),
	).length;
	return {
		store,
		schemaVersion: OUTBOUND_WEBHOOK_STORE_VERSION,
		healthy:
			circuitOpen === 0 &&
			(due.length === 0 || activeWorkers.length > 0),
		checkedAt: now.toISOString(),
		endpoints: {
			total: endpoints.length,
			enabled: endpoints.filter((endpoint) => endpoint.enabled).length,
			circuitOpen,
		},
		deliveries: {
			...statusCounts,
			due: due.length,
			deadLetter: statusCounts.exhausted,
			oldestDueAt: due
				.map((delivery) =>
					delivery.status === "delivering"
						? (delivery.leaseExpiresAt ??
							delivery.lastAttemptAt ??
							delivery.nextAttemptAt)
						: delivery.nextAttemptAt,
				)
				.sort((left, right) => Date.parse(left) - Date.parse(right))
				.at(0),
		},
		workers: {
			running: activeWorkers.length,
			stale: staleWorkers.length,
			stopped: workers.filter((worker) => worker.status === "stopped").length,
			failed: workers.filter((worker) => worker.status === "failed").length,
			lastHeartbeatAt,
		},
	};
}

export function signOutboundWebhookPayload(
	secret: string,
	timestamp: string,
	body: string,
): string {
	if (secret.length === 0) {
		throw new OutboundWebhookSignatureError(
			"Outbound webhook signing secret must not be blank",
		);
	}
	return `v1=${createHmac("sha256", secret)
		.update(`${timestamp}.${body}`, "utf8")
		.digest("hex")}`;
}

export function verifyOutboundWebhookSignature(input: {
	secret: string;
	timestamp: string;
	body: string;
	signature: string;
	now?: Date;
	toleranceMs?: number;
}): boolean {
	const toleranceMs = input.toleranceMs ?? 300_000;
	const timestampMs = Date.parse(input.timestamp);
	if (
		!Number.isFinite(timestampMs) ||
		Math.abs((input.now ?? new Date()).getTime() - timestampMs) > toleranceMs
	) {
		return false;
	}
	const expected = signOutboundWebhookPayload(
		input.secret,
		input.timestamp,
		input.body,
	);
	const actualBuffer = Buffer.from(input.signature, "utf8");
	const expectedBuffer = Buffer.from(expected, "utf8");
	return (
		actualBuffer.length === expectedBuffer.length &&
		timingSafeEqual(actualBuffer, expectedBuffer)
	);
}

async function resolveWithTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string,
): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timeout !== undefined) {
			clearTimeout(timeout);
		}
	}
}

type WebhookAddressResolution =
	| Readonly<{
			safe: true;
			addresses: readonly ResolvedWebhookAddress[];
	  }>
	| Readonly<{
			safe: false;
			reason: string;
	  }>;

async function resolvePublicWebhookAddresses(
	url: string,
): Promise<WebhookAddressResolution> {
	const parsed = new URL(url);
	const staticSafety = isSafeFetchUrl(url);
	if (!staticSafety.safe) {
		return {
			safe: false,
			reason: staticSafety.reason ?? "URL is not public",
		};
	}
	const hostname = parsed.hostname.replace(/^\[|\]$/gu, "");
	const literalFamily = isIP(hostname);
	const addresses =
		literalFamily === 0
			? await dnsLookup(hostname, {
					all: true,
					verbatim: true,
				})
			: [{ address: hostname, family: literalFamily }];
	if (addresses.length === 0) {
		throw new Error(`Endpoint host has no DNS addresses: ${hostname}`);
	}
	const normalized = addresses
		.map(({ address, family }) => ({
			address,
			family: family === 6 ? (6 as const) : (4 as const),
		}))
		.sort((left, right) => left.family - right.family);
	const blocked = normalized.find(({ address }) => isPrivateHost(address));
	if (blocked) {
		return {
			safe: false,
			reason: `Host ${hostname} resolves to private/internal address ${blocked.address}`,
		};
	}
	return { safe: true, addresses: normalized };
}

async function deliverClaimedWebhook(
	claimed: ClaimedOutboundWebhookDelivery,
	options: Readonly<{
		fetcher?: typeof fetch;
		resolveSecret: (secretRef: string) => string | undefined;
	}>,
): Promise<{
	success: boolean;
	retryable: boolean;
	statusCode?: number;
	error?: unknown;
	errorCode?: OutboundWebhookDispatchErrorCode;
}> {
	const { delivery, endpoint } = claimed;
	if (!endpoint) {
		return {
			success: false,
			retryable: false,
			error: "Endpoint was deleted before delivery",
			errorCode: "endpoint_unavailable",
		};
	}
	if (!endpoint.enabled) {
		return {
			success: false,
			retryable: false,
			error: "Endpoint is disabled",
			errorCode: "endpoint_unavailable",
		};
	}
	const secret = options.resolveSecret(endpoint.secretRef);
	if (secret === undefined || secret.trim().length === 0) {
		return {
			success: false,
			retryable: true,
			error: `Signing secret environment variable is unavailable: ${endpoint.secretRef}`,
			errorCode: "signing_secret_unavailable",
		};
	}
	const startedAt = Date.now();
	let addressResolution: WebhookAddressResolution;
	try {
		addressResolution = await resolveWithTimeout(
			resolvePublicWebhookAddresses(endpoint.url),
			endpoint.timeoutMs,
			"Endpoint DNS validation timed out",
		);
	} catch (error) {
		return {
			success: false,
			retryable: true,
			error,
			errorCode: "delivery_failed",
		};
	}
	if (!addressResolution.safe) {
		return {
			success: false,
			retryable: false,
			error: `Endpoint blocked by URL policy: ${addressResolution.reason}`,
			errorCode: "url_policy_blocked",
		};
	}
	const timestamp = nowIso();
	const body = JSON.stringify(delivery.event);
	const signature = signOutboundWebhookPayload(secret, timestamp, body);
	const headers = {
		"Content-Type": "application/json",
		"User-Agent": "listmonk-ops-webhooks/1",
		"X-Listmonk-Ops-Event-Id": delivery.event.id,
		"X-Listmonk-Ops-Event-Type": delivery.event.type,
		"X-Listmonk-Ops-Timestamp": timestamp,
		"X-Listmonk-Ops-Signature": signature,
	};
	const controller = new AbortController();
	const remainingTimeoutMs = Math.max(
		1,
		endpoint.timeoutMs - (Date.now() - startedAt),
	);
	const timeout = setTimeout(() => controller.abort(), remainingTimeoutMs);
	try {
		const result = options.fetcher
			? await options
					.fetcher(endpoint.url, {
						method: "POST",
						redirect: "error",
						signal: controller.signal,
						headers,
						body,
					})
					.then((response) => {
						response.body?.cancel().catch(() => {});
						return { ok: response.ok, status: response.status };
					})
			: await postPinnedHttpsWebhookWithFallback({
					url: endpoint.url,
					addresses: addressResolution.addresses,
					headers,
					body,
					signal: controller.signal,
				});
		if (result.ok) {
			return {
				success: true,
				retryable: false,
				statusCode: result.status,
			};
		}
		return {
			success: false,
			retryable:
				result.status === 408 ||
				result.status === 409 ||
				result.status === 425 ||
				result.status === 429 ||
				result.status >= 500,
			statusCode: result.status,
			error: `Endpoint returned HTTP ${result.status}`,
			errorCode: "http_rejected",
		};
	} catch (error) {
		return {
			success: false,
			retryable: true,
			error,
			errorCode: "delivery_failed",
		};
	} finally {
		clearTimeout(timeout);
	}
}

export async function dispatchOutboundWebhooks(
	options: DispatchOutboundWebhooksOptions = {},
): Promise<DispatchOutboundWebhooksResult> {
	const limit = options.limit ?? 25;
	if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
		throw new RangeError("Dispatch limit must be between 1 and 100");
	}
	const leaseMs = options.leaseMs ?? DEFAULT_OUTBOUND_WEBHOOK_LEASE_MS;
	if (!Number.isInteger(leaseMs) || leaseMs < 1_000) {
		throw new RangeError("Webhook delivery lease must be at least 1000ms");
	}
	const baseRetryDelayMs =
		options.baseRetryDelayMs ?? DEFAULT_OUTBOUND_WEBHOOK_RETRY_DELAY_MS;
	if (!Number.isInteger(baseRetryDelayMs) || baseRetryDelayMs < 1_000) {
		throw new RangeError("Webhook retry delay must be at least 1000ms");
	}
	const concurrency =
		options.concurrency ?? DEFAULT_OUTBOUND_WEBHOOK_CONCURRENCY;
	if (!Number.isInteger(concurrency) || concurrency <= 0 || concurrency > 10) {
		throw new RangeError(
			"Webhook dispatch concurrency must be between 1 and 10",
		);
	}
	const store = options.store ?? {};
	if (
		options.bypassCircuitBreaker === true &&
		(options.deliveryIds?.length ?? 0) === 0
	) {
		throw new TypeError(
			"Circuit bypass requires one or more explicitly targeted delivery IDs",
		);
	}
	const resolveSecret =
		options.resolveSecret ?? ((secretRef: string) => process.env[secretRef]);
	const results: DispatchOutboundWebhooksResult["results"][number][] = [];
	const processedDeliveryIds = new Set<string>();
	let claimedCount = 0;
	while (claimedCount < limit) {
		const claimNow = options.now ?? new Date();
		const claimed = await claimOutboundWebhookDeliveries({
			...store,
			limit: Math.min(concurrency, limit - claimedCount),
			now: claimNow,
			leaseMs,
			deliveryIds: options.deliveryIds,
			excludeDeliveryIds: [...processedDeliveryIds],
			bypassCircuitBreaker: options.bypassCircuitBreaker,
		});
		if (claimed.length === 0) {
			break;
		}
		claimedCount += claimed.length;
		for (const entry of claimed) {
			processedDeliveryIds.add(entry.delivery.id);
		}
		const batchResults = await Promise.all(
			claimed.map(async (entry) => {
				const attempt = await deliverClaimedWebhook(entry, {
					fetcher: options.fetcher,
					resolveSecret,
				});
				let delivery: OutboundWebhookDelivery;
				try {
					delivery = await completeOutboundWebhookDelivery(
						entry.delivery,
						attempt,
						entry.endpoint,
						{
							...store,
							now: options.now ?? new Date(),
							baseRetryDelayMs,
						},
					);
				} catch (error) {
					if (error instanceof OutboundWebhookConflictError) {
						return {
							deliveryId: entry.delivery.id,
							endpointId: entry.delivery.endpointId,
							status: "skipped" as const,
							errorCode: "lease_conflict" as const,
						};
					}
					throw error;
				}
				return {
					deliveryId: delivery.id,
					endpointId: delivery.endpointId,
					status: delivery.status as "succeeded" | "retry" | "exhausted",
					statusCode: delivery.statusCode,
					errorCode: attempt.errorCode,
				};
			}),
		);
		results.push(...batchResults);
	}
	return {
		claimed: claimedCount,
		succeeded: results.filter((result) => result.status === "succeeded").length,
		retried: results.filter((result) => result.status === "retry").length,
		exhausted: results.filter((result) => result.status === "exhausted").length,
		skipped: results.filter((result) => result.status === "skipped").length,
		results,
	};
}
