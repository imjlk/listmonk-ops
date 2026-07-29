import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	commitJsonFileStoreUpdate,
	readJsonFileStore,
	type JsonFileStore,
	type RecordOperationAuditInput,
	updateJsonFileStore,
} from "@listmonk-ops/common";
import { z } from "zod";
import { isPrivateHost, isSafeFetchUrl } from "./campaign";

export const OUTBOUND_WEBHOOK_STORE_VERSION = 1;
export const OUTBOUND_WEBHOOK_EVENT_SCHEMA_VERSION = 1;
export const DEFAULT_OUTBOUND_WEBHOOK_TIMEOUT_MS = 10_000;
export const DEFAULT_OUTBOUND_WEBHOOK_MAX_ATTEMPTS = 6;
export const DEFAULT_OUTBOUND_WEBHOOK_RETRY_DELAY_MS = 30_000;
export const MAX_OUTBOUND_WEBHOOK_RETRY_DELAY_MS = 3_600_000;
export const DEFAULT_OUTBOUND_WEBHOOK_LEASE_MS = 60_000;
export const DEFAULT_OUTBOUND_WEBHOOK_STORE_LIMIT = 5_000;
export const DEFAULT_OUTBOUND_WEBHOOK_CONCURRENCY = 5;
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
	"abtest.started",
	"abtest.ready-for-analysis",
	"abtest.winner-selected",
	"abtest.inconclusive",
	"abtest.failed",
	"webhook.test",
] as const;

export type OutboundWebhookEventType =
	(typeof OUTBOUND_WEBHOOK_EVENT_TYPES)[number];
export type OutboundWebhookEventSource =
	| "listmonk"
	| "provider"
	| "operation"
	| "abtest"
	| "sequence"
	| "webhook";
export type OutboundWebhookSubjectKind =
	| "operation"
	| "campaign"
	| "subscriber"
	| "message"
	| "experiment"
	| "webhook";
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
	createdAt: string;
	updatedAt: string;
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
}>;

export type OutboundWebhookStoreOptions = Readonly<{
	path?: string;
	limit?: number;
}>;

export type CreateOutboundWebhookEndpointInput = Readonly<{
	name: string;
	url: string;
	secretRef: string;
	eventFilters: readonly string[];
	enabled?: boolean;
	timeoutMs?: number;
	maxAttempts?: number;
}>;

export type UpdateOutboundWebhookEndpointInput = Readonly<{
	name?: string;
	url?: string;
	secretRef?: string;
	eventFilters?: readonly string[];
	enabled?: boolean;
	timeoutMs?: number;
	maxAttempts?: number;
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
}>;

export type DispatchOutboundWebhooksResult = Readonly<{
	claimed: number;
	succeeded: number;
	retried: number;
	exhausted: number;
	results: readonly Readonly<{
		deliveryId: string;
		endpointId: string;
		status: Extract<
			OutboundWebhookDeliveryStatus,
			"succeeded" | "retry" | "exhausted"
		>;
		statusCode?: number | undefined;
		error?: string | undefined;
	}>[];
}>;

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
const eventFilterSchema = z
	.string()
	.trim()
	.min(1)
	.refine(isSupportedEventFilter, "Unsupported event filter");
const endpointSchema = z.object({
	id: uuidSchema,
	name: z.string().trim().min(1).max(120),
	url: z.string().trim().min(1),
	secretRef: secretRefSchema,
	eventFilters: z.array(eventFilterSchema).min(1),
	enabled: z.boolean(),
	timeoutMs: z.number().int().min(100).max(30_000),
	maxAttempts: z.number().int().min(1).max(12),
	createdAt: isoDateTimeSchema,
	updatedAt: isoDateTimeSchema,
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
	public constructor(message: string) {
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

function parseStore(value: unknown): OutboundWebhookStore {
	const parsed = storeSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(`Invalid outbound webhook store: ${parsed.error.message}`);
	}
	return parsed.data;
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
		}),
		parse: parseStore,
		lock: { timeoutMs: 5_000 },
	};
}

function normalizeEndpointUrl(value: string): string {
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

function normalizeEventFilters(filters: readonly string[]): readonly string[] {
	const parsed = z.array(eventFilterSchema).min(1).parse(filters);
	return [...new Set(parsed)];
}

export function isSupportedEventFilter(filter: string): boolean {
	const normalized = filter.trim();
	if (normalized === "*") {
		return true;
	}
	if (normalized.endsWith(".*")) {
		const prefix = normalized.slice(0, -1);
		return OUTBOUND_WEBHOOK_EVENT_TYPES.some((type) => type.startsWith(prefix));
	}
	return OUTBOUND_WEBHOOK_EVENT_TYPES.includes(
		normalized as OutboundWebhookEventType,
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
			output[key] = SENSITIVE_KEY_PATTERN.test(key)
				? "[REDACTED]"
				: redactValue(nested, depth + 1, seen);
		}
		seen.delete(value);
		return output;
	}
	return String(value);
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
	const store = await readJsonFileStore(
		createOutboundWebhookStore(options.path),
	);
	return [...store.endpoints].sort((left, right) =>
		left.createdAt.localeCompare(right.createdAt),
	);
}

export async function getOutboundWebhookEndpoint(
	id: string,
	options: OutboundWebhookStoreOptions = {},
): Promise<OutboundWebhookEndpoint> {
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
		url: normalizeEndpointUrl(input.url),
		secretRef: input.secretRef,
		eventFilters: normalizeEventFilters(input.eventFilters),
		enabled: input.enabled ?? true,
		timeoutMs: input.timeoutMs ?? DEFAULT_OUTBOUND_WEBHOOK_TIMEOUT_MS,
		maxAttempts:
			input.maxAttempts ?? DEFAULT_OUTBOUND_WEBHOOK_MAX_ATTEMPTS,
		createdAt: at,
		updatedAt: at,
	});
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

export async function updateOutboundWebhookEndpoint(
	id: string,
	input: UpdateOutboundWebhookEndpointInput,
	options: OutboundWebhookStoreOptions = {},
): Promise<OutboundWebhookEndpoint> {
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const index = current.endpoints.findIndex((endpoint) => endpoint.id === id);
		if (index < 0) {
			throw new OutboundWebhookNotFoundError("endpoint", id);
		}
		const previous = current.endpoints[index]!;
		const endpoint = endpointSchema.parse({
			...previous,
			...(input.name === undefined ? {} : { name: input.name }),
			...(input.url === undefined
				? {}
				: { url: normalizeEndpointUrl(input.url) }),
			...(input.secretRef === undefined
				? {}
				: { secretRef: input.secretRef }),
			...(input.eventFilters === undefined
				? {}
				: { eventFilters: normalizeEventFilters(input.eventFilters) }),
			...(input.enabled === undefined ? {} : { enabled: input.enabled }),
			...(input.timeoutMs === undefined
				? {}
				: { timeoutMs: input.timeoutMs }),
			...(input.maxAttempts === undefined
				? {}
				: { maxAttempts: input.maxAttempts }),
			updatedAt: nowIso(),
		});
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
	options: OutboundWebhookStoreOptions = {},
): Promise<OutboundWebhookEndpoint> {
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const endpoint = current.endpoints.find((candidate) => candidate.id === id);
		if (!endpoint) {
			throw new OutboundWebhookNotFoundError("endpoint", id);
		}
		const at = nowIso();
		return commitJsonFileStoreUpdate(
			{
				...current,
				endpoints: current.endpoints.filter(
					(candidate) => candidate.id !== id,
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
	} = {},
): Promise<EnqueueOutboundWebhookResult> {
	const event = createOutboundWebhookEvent(input);
	const selected = options.endpointIds
		? new Set(options.endpointIds)
		: undefined;
	const limit = resolveStoreLimit(options.limit);
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const endpoints = current.endpoints.filter(
			(endpoint) =>
				endpoint.enabled &&
				(selected === undefined || selected.has(endpoint.id)) &&
				matchesOutboundWebhookEvent(endpoint.eventFilters, event.type),
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
					nextAttemptAt: nowIso(),
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

export async function listOutboundWebhookDeliveries(
	options: OutboundWebhookDeliveryListOptions &
		OutboundWebhookStoreOptions = {},
): Promise<readonly OutboundWebhookDelivery[]> {
	const store = await readJsonFileStore(
		createOutboundWebhookStore(options.path),
	);
	const limit = options.limit ?? 100;
	if (!Number.isInteger(limit) || limit <= 0 || limit > 1_000) {
		throw new RangeError("Delivery list limit must be between 1 and 1000");
	}
	return store.deliveries
		.filter(
			(delivery) =>
				(options.endpointId === undefined ||
					delivery.endpointId === options.endpointId) &&
				(options.status === undefined ||
					delivery.status === options.status) &&
				(options.eventType === undefined ||
					delivery.event.type === options.eventType),
		)
		.sort((left, right) => right.nextAttemptAt.localeCompare(left.nextAttemptAt))
		.slice(0, limit);
}

export async function retryOutboundWebhookDelivery(
	id: string,
	options: OutboundWebhookStoreOptions = {},
): Promise<OutboundWebhookDelivery> {
	const store = createOutboundWebhookStore(options.path);
	return updateJsonFileStore(store, (current) => {
		const index = current.deliveries.findIndex(
			(delivery) => delivery.id === id,
		);
		if (index < 0) {
			throw new OutboundWebhookNotFoundError("delivery", id);
		}
		const previous = current.deliveries[index]!;
		if (!["retry", "exhausted"].includes(previous.status)) {
			throw new OutboundWebhookConflictError(
				`Delivery ${id} cannot be retried from status ${previous.status}`,
			);
		}
		if (
			!current.endpoints.some(
				(endpoint) => endpoint.id === previous.endpointId && endpoint.enabled,
			)
		) {
			throw new OutboundWebhookConflictError(
				`Delivery ${id} endpoint is missing or disabled`,
			);
		}
		const delivery = deliverySchema.parse({
			...previous,
			status: "pending",
			attemptCount: 0,
			manualRetryCount: previous.manualRetryCount + 1,
			nextAttemptAt: nowIso(),
			lastAttemptAt: undefined,
			completedAt: undefined,
			statusCode: undefined,
			lastError: undefined,
			leaseToken: undefined,
			leaseExpiresAt: undefined,
		});
		const deliveries = [...current.deliveries];
		deliveries[index] = delivery;
		return commitJsonFileStoreUpdate(
			{ ...current, deliveries },
			delivery,
		);
	});
}

type ClaimedDelivery = Readonly<{
	delivery: OutboundWebhookDelivery;
	endpoint?: OutboundWebhookEndpoint | undefined;
}>;

async function claimOutboundWebhookDeliveries(
	options: OutboundWebhookStoreOptions & {
		limit: number;
		now: Date;
		leaseMs: number;
		deliveryIds?: readonly string[];
		excludeDeliveryIds?: readonly string[];
	},
): Promise<readonly ClaimedDelivery[]> {
	const store = createOutboundWebhookStore(options.path);
	const at = options.now.getTime();
	return updateJsonFileStore(store, (current) => {
		const selected = options.deliveryIds
			? new Set(options.deliveryIds)
			: undefined;
		const excluded = new Set(options.excludeDeliveryIds ?? []);
		const claimable = current.deliveries
			.filter((delivery) => {
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

function truncateError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replaceAll(/[\r\n\t]+/gu, " ").slice(0, MAX_ERROR_LENGTH);
}

function retryDelayMs(
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
	result: {
		success: boolean;
		retryable: boolean;
		statusCode?: number;
		error?: unknown;
	},
	endpoint: OutboundWebhookEndpoint | undefined,
	options: OutboundWebhookStoreOptions & {
		now: Date;
		baseRetryDelayMs: number;
	},
): Promise<OutboundWebhookDelivery> {
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
								retryDelayMs(
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
					: truncateError(result.error),
			leaseToken: undefined,
			leaseExpiresAt: undefined,
		});
		const deliveries = [...current.deliveries];
		deliveries[index] = delivery;
		return commitJsonFileStoreUpdate(
			{ ...current, deliveries },
			delivery,
		);
	});
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

type ResolvedWebhookAddress = Readonly<{
	address: string;
	family: 4 | 6;
}>;

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
	const addresses = await dnsLookup(parsed.hostname, {
		all: true,
		verbatim: true,
	});
	if (addresses.length === 0) {
		throw new Error(`Endpoint host has no DNS addresses: ${parsed.hostname}`);
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
			reason: `Host ${parsed.hostname} resolves to private/internal address ${blocked.address}`,
		};
	}
	return { safe: true, addresses: normalized };
}

function postPinnedHttpsWebhook(input: {
	url: string;
	address: ResolvedWebhookAddress;
	headers: Readonly<Record<string, string>>;
	body: string;
	signal: AbortSignal;
}): Promise<{ ok: boolean; status: number }> {
	const parsed = new URL(input.url);
	const lookup: LookupFunction = (_hostname, _options, callback) => {
		callback(null, input.address.address, input.address.family);
	};
	return new Promise((resolve, reject) => {
		const request = httpsRequest(
			parsed,
			{
				method: "POST",
				headers: input.headers,
				lookup,
				family: input.address.family,
				servername: parsed.hostname,
				signal: input.signal,
			},
			(response) => {
				response.resume();
				const status = response.statusCode ?? 0;
				resolve({ ok: status >= 200 && status < 300, status });
			},
		);
		request.once("error", reject);
		request.end(input.body);
	});
}

async function deliverClaimedWebhook(
	claimed: ClaimedDelivery,
	options: Readonly<{
		fetcher?: typeof fetch;
		resolveSecret: (secretRef: string) => string | undefined;
	}>,
): Promise<{
	success: boolean;
	retryable: boolean;
	statusCode?: number;
	error?: unknown;
}> {
	const { delivery, endpoint } = claimed;
	if (!endpoint) {
		return {
			success: false,
			retryable: false,
			error: "Endpoint was deleted before delivery",
		};
	}
	if (!endpoint.enabled) {
		return {
			success: false,
			retryable: false,
			error: "Endpoint is disabled",
		};
	}
	const secret = options.resolveSecret(endpoint.secretRef)?.trim();
	if (!secret) {
		return {
			success: false,
			retryable: true,
			error: `Signing secret environment variable is unavailable: ${endpoint.secretRef}`,
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
		};
	}
	if (!addressResolution.safe) {
		return {
			success: false,
			retryable: false,
			error: `Endpoint blocked by URL policy: ${addressResolution.reason}`,
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
			: await postPinnedHttpsWebhook({
					url: endpoint.url,
					address: addressResolution.addresses[0]!,
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
		};
	} catch (error) {
		return {
			success: false,
			retryable: true,
			error,
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
				const delivery = await completeOutboundWebhookDelivery(
					entry.delivery,
					attempt,
					entry.endpoint,
					{
						...store,
						now: options.now ?? new Date(),
						baseRetryDelayMs,
					},
				);
				return {
					deliveryId: delivery.id,
					endpointId: delivery.endpointId,
					status: delivery.status as "succeeded" | "retry" | "exhausted",
					statusCode: delivery.statusCode,
					error: delivery.lastError,
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
		results,
	};
}
