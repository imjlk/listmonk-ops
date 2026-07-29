import { createHash } from "node:crypto";
import {
	createOutboundWebhookEvent,
	enqueueOutboundWebhookEvent,
	listOutboundWebhookEndpoints,
	matchesOutboundWebhookEvent,
	type CreateOutboundWebhookEventInput,
	type EnqueueOutboundWebhookResult,
	type OutboundWebhookEventType,
	type OutboundWebhookStoreOptions,
	type OutboundWebhookSubject,
} from "./outbound-webhooks";

export interface SuccessfulOperationLifecycleInput {
	executionId: string;
	operationId: string;
	operationInput: Readonly<Record<string, unknown>>;
	operationOutput?: unknown;
	occurredAt?: string;
}

export interface EnqueueSuccessfulOperationLifecycleResult {
	projected: number;
	matchedEndpoints: number;
	queuedDeliveries: number;
	duplicateDeliveries: number;
	eventIds: readonly string[];
}

type DomainEventProjection = Readonly<{
	type: OutboundWebhookEventType;
	source: CreateOutboundWebhookEventInput["source"];
	subject: OutboundWebhookSubject;
	data: Readonly<Record<string, unknown>>;
}>;

const CAMPAIGN_EVENT_TYPES = {
	"campaigns.schedule": "campaign.scheduled",
	"campaigns.start": "campaign.started",
	"campaigns.pause": "campaign.paused",
	"campaigns.cancel": "campaign.cancelled",
} as const;

const ABTEST_LIFECYCLE_EVENT_BY_STATUS = {
	analyzing: "abtest.ready-for-analysis",
	inconclusive: "abtest.inconclusive",
	failed: "abtest.failed",
} as const;

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: undefined;
}

function asNonBlankString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asResourceKey(value: unknown): string | undefined {
	if (
		(typeof value === "number" && Number.isInteger(value) && value > 0) ||
		(typeof value === "bigint" && value > 0n)
	) {
		return String(value);
	}
	return asNonBlankString(value);
}

/**
 * Produce a stable UUID-shaped identifier from SHA-256. This is deliberately
 * not RFC 4122 UUIDv5 (which requires SHA-1 and a namespace); the version and
 * variant bits only make the persisted identifier compatible with UUID
 * columns while preserving deterministic event deduplication.
 */
function deterministicUuid(seed: string): string {
	const bytes = createHash("sha256").update(seed, "utf8").digest().subarray(
		0,
		16,
	);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join("-");
}

function eventId(
	executionId: string,
	projection: DomainEventProjection,
	index: number,
): string {
	return deterministicUuid(
		[
			"listmonk-ops",
			"domain-lifecycle",
			"v1",
			executionId,
			projection.type,
			projection.subject.kind,
			projection.subject.key,
			String(index),
		].join(":"),
	);
}

function outputResource(
	output: unknown,
	property: string,
): Readonly<Record<string, unknown>> | undefined {
	const record = asRecord(output);
	return asRecord(record?.[property]);
}

function campaignProjection(
	input: SuccessfulOperationLifecycleInput,
): DomainEventProjection | undefined {
	const type =
		CAMPAIGN_EVENT_TYPES[
			input.operationId as keyof typeof CAMPAIGN_EVENT_TYPES
		];
	if (!type) {
		return undefined;
	}
	const output = asRecord(input.operationOutput);
	const campaignId =
		asResourceKey(output?.["id"]) ??
		asResourceKey(input.operationInput["id"]);
	if (!campaignId) {
		return undefined;
	}
	return {
		type,
		source: "listmonk",
		subject: { kind: "campaign", key: campaignId },
		data: {
			status: output?.["status"],
			send_at: input.operationInput["send_at"],
		},
	};
}

function subscriberIdsFromInput(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (typeof value === "string") {
		return value
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
	}
	return [];
}

function subscriberProjection(
	input: SuccessfulOperationLifecycleInput,
): readonly DomainEventProjection[] {
	const output = asRecord(input.operationOutput);
	if (
		input.operationId === "subscribers.create" ||
		input.operationId === "subscribers.update"
	) {
		const subscriberId =
			asResourceKey(output?.["id"]) ??
			(input.operationId === "subscribers.update"
				? asResourceKey(input.operationInput["id"])
				: undefined);
		if (!subscriberId) {
			return [];
		}
		return [
			{
				type:
					input.operationId === "subscribers.create"
						? "subscriber.created"
						: "subscriber.updated",
				source: "listmonk",
				subject: { kind: "subscriber", key: subscriberId },
				data: {
					status: output?.["status"],
				},
			},
		];
	}
	if (
		input.operationId !== "subscribers.blocklist" ||
		input.operationInput["dry_run"] === true
	) {
		return [];
	}
	const subscriberIds = subscriberIdsFromInput(
		input.operationInput["subscriber_ids"],
	);
	const normalizedIds = subscriberIds
		.map(asResourceKey)
		.filter((value): value is string => value !== undefined)
		.sort();
	if (normalizedIds.length === 0) {
		return [];
	}
	const batchKey = createHash("sha256")
		.update(normalizedIds.join(","), "utf8")
		.digest("hex")
		.slice(0, 24);
	return [
		{
			type: "subscriber.blocklisted",
			source: "listmonk",
			subject: { kind: "subscriber", key: `batch:${batchKey}` },
			data: {
				requested_count: normalizedIds.length,
				processed: output?.["processed"],
				succeeded: output?.["succeeded"],
				failed: output?.["failed"],
			},
		},
	];
}

function abTestProjection(
	input: SuccessfulOperationLifecycleInput,
): readonly DomainEventProjection[] {
	if (
		input.operationId === "abtest.tick" &&
		input.operationInput["dry_run"] === true
	) {
		return [];
	}
	const output = asRecord(input.operationOutput);
	const test = outputResource(input.operationOutput, "test");
	const testId =
		asResourceKey(test?.["id"]) ??
		asResourceKey(input.operationInput["test_id"]);
	if (input.operationId === "abtest.launch" && testId) {
		return [
			{
				type: "abtest.started",
				source: "abtest",
				subject: { kind: "experiment", key: testId },
				data: { status: test?.["status"] ?? "running" },
			},
		];
	}
	if (
		input.operationId === "abtest.deploy-winner" &&
		testId &&
		output?.["deployed"] === true
	) {
		return [
			{
				type: "abtest.winner-selected",
				source: "abtest",
				subject: { kind: "experiment", key: testId },
				data: { deployed: true },
			},
		];
	}
	if (input.operationId === "abtest.analyze") {
		const analysis = outputResource(input.operationOutput, "analysis");
		const analysisTestId =
			asResourceKey(analysis?.["testId"]) ?? testId;
		const winner = asRecord(analysis?.["winner"]);
		if (analysisTestId && winner) {
			return [
				{
					type: "abtest.winner-selected",
					source: "abtest",
					subject: { kind: "experiment", key: analysisTestId },
					data: { winner_variant_id: winner["id"] },
				},
			];
		}
	}
	if (input.operationId === "abtest.run" && testId) {
		const status = asNonBlankString(test?.["status"]);
		const type =
			status === undefined
				? undefined
				: ABTEST_LIFECYCLE_EVENT_BY_STATUS[
						status as keyof typeof ABTEST_LIFECYCLE_EVENT_BY_STATUS
					];
		return type
			? [
					{
						type,
						source: "abtest",
						subject: { kind: "experiment", key: testId },
						data: { status },
					},
				]
			: [];
	}
	if (input.operationId === "abtest.tick") {
		const results = Array.isArray(output?.["results"]) ? output["results"] : [];
		return results.flatMap((value): DomainEventProjection[] => {
			const result = asRecord(value);
			const resultTestId = asResourceKey(result?.["test_id"]);
			const status = asNonBlankString(result?.["status"]);
			const type =
				status === undefined
					? undefined
					: ABTEST_LIFECYCLE_EVENT_BY_STATUS[
							status as keyof typeof ABTEST_LIFECYCLE_EVENT_BY_STATUS
						];
			if (!resultTestId || !type) {
				return [];
			}
			return [
				{
					type,
					source: "abtest",
					subject: { kind: "experiment", key: resultTestId },
					data: {
						status,
						action: result?.["action"],
					},
				},
			];
		});
	}
	return [];
}

function sequenceProjection(
	input: SuccessfulOperationLifecycleInput,
): readonly DomainEventProjection[] {
	const sequence = outputResource(input.operationOutput, "sequence");
	const enrollment = outputResource(input.operationOutput, "enrollment");
	const sequenceId =
		asResourceKey(sequence?.["id"]) ??
		asResourceKey(enrollment?.["sequence_id"]) ??
		asResourceKey(input.operationInput["id"]);
	if (!sequenceId) {
		return [];
	}
	const common = {
		source: "sequence" as const,
		subject: { kind: "sequence" as const, key: sequenceId },
	};
	switch (input.operationId) {
		case "sequences.create":
			return sequence
				? [
						{
							...common,
							type: "sequence.created",
							data: { revision: sequence["current_revision"] },
						},
					]
				: [];
		case "sequences.update":
			return sequence
				? [
						{
							...common,
							type: "sequence.revised",
							data: { revision: sequence["current_revision"] },
						},
					]
				: [];
		case "sequences.enroll":
			return enrollment
				? [
						{
							...common,
							type: "sequence.enrolled",
							data: {
								enrollment_id: enrollment["id"],
								revision: enrollment["revision"],
								status: enrollment["status"],
							},
						},
					]
				: [];
		case "sequences.pause":
			return sequence
				? [
						{
							...common,
							type: "sequence.paused",
							data: { status: sequence["status"] },
						},
					]
				: [];
		case "sequences.resume":
			return sequence
				? [
						{
							...common,
							type: "sequence.resumed",
							data: { status: sequence["status"] },
						},
					]
				: [];
		case "sequences.delete":
			return sequence
				? [
						{
							...common,
							type: "sequence.deleted",
							data: {
								status: sequence["status"],
								current_revision: sequence["current_revision"],
							},
						},
					]
				: [];
		case "sequences.reconcile":
			return enrollment
				? [
						{
							...common,
							type: "sequence.reconciled",
							data: {
								enrollment_id: enrollment["id"],
								status: enrollment["status"],
							},
						},
					]
				: [];
		default:
			return [];
	}
}

export function projectSuccessfulOperationLifecycleEvents(
	input: SuccessfulOperationLifecycleInput,
): readonly CreateOutboundWebhookEventInput[] {
	const campaign = campaignProjection(input);
	const projections = [
		...(campaign ? [campaign] : []),
		...subscriberProjection(input),
		...abTestProjection(input),
		...sequenceProjection(input),
	];
	return projections.map((projection, index) => ({
		id: eventId(input.executionId, projection, index),
		type: projection.type,
		occurredAt: input.occurredAt,
		source: projection.source,
		correlationId: input.executionId,
		subject: projection.subject,
		data: {
			operation_id: input.operationId,
			...projection.data,
		},
	}));
}

/**
 * Best-effort callers can safely retry this projection: event identifiers are
 * deterministic within one audited execution and each endpoint has a unique
 * event/destination constraint in both persistence implementations.
 */
export async function enqueueSuccessfulOperationLifecycleEvents(
	input: SuccessfulOperationLifecycleInput,
	store: OutboundWebhookStoreOptions = {},
): Promise<EnqueueSuccessfulOperationLifecycleResult> {
	const projected = projectSuccessfulOperationLifecycleEvents(input);
	if (projected.length === 0) {
		return {
			projected: 0,
			matchedEndpoints: 0,
			queuedDeliveries: 0,
			duplicateDeliveries: 0,
			eventIds: [],
		};
	}
	const endpoints = await listOutboundWebhookEndpoints(store);
	const results: EnqueueOutboundWebhookResult[] = [];
	// Keep file-backed projection writes ordered. A single operation emits only a
	// small bounded set of events, so sharing this path with Postgres is simpler
	// and avoids introducing adapter-specific ordering semantics.
	for (const eventInput of projected) {
		const event = createOutboundWebhookEvent(eventInput);
		const endpointIds = endpoints
			.filter(
				(endpoint) =>
					endpoint.enabled &&
					matchesOutboundWebhookEvent(endpoint.eventFilters, event.type),
			)
			.map((endpoint) => endpoint.id);
		if (endpointIds.length === 0) {
			continue;
		}
		results.push(
			await enqueueOutboundWebhookEvent(event, {
				...store,
				endpointIds,
			}),
		);
	}
	return {
		projected: projected.length,
		matchedEndpoints: results.reduce(
			(total, result) => total + result.matchedEndpoints,
			0,
		),
		queuedDeliveries: results.reduce(
			(total, result) => total + result.queuedDeliveries,
			0,
		),
		duplicateDeliveries: results.reduce(
			(total, result) => total + result.duplicateDeliveries,
			0,
		),
		eventIds: results.map((result) => result.event.id),
	};
}
