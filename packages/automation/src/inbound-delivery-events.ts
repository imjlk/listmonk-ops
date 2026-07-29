import { createHash } from "node:crypto";
import { z } from "zod";
import {
	enqueueOutboundWebhookEvent,
	type EnqueueOutboundWebhookResult,
	type OutboundWebhookEventType,
	type OutboundWebhookStoreOptions,
} from "./outbound-webhooks";

export const INBOUND_DELIVERY_EVENT_KINDS = [
	"delivered",
	"bounced",
	"complained",
	"unsubscribed",
	"delayed",
	"rejected",
] as const;

export const MAX_INBOUND_DELIVERY_EVENT_METADATA_BYTES = 16_384;

export type InboundDeliveryEventKind =
	(typeof INBOUND_DELIVERY_EVENT_KINDS)[number];

export interface IngestInboundDeliveryEventInput {
	provider: string;
	providerEventId: string;
	kind: InboundDeliveryEventKind;
	occurredAt?: string;
	messageId?: string;
	subscriberUuid?: string;
	campaignId?: number;
	metadata?: Readonly<Record<string, unknown>>;
}

function deterministicUuid(value: string): string {
	const bytes = createHash("sha256").update(value, "utf8").digest().subarray(
		0,
		16,
	);
	bytes[6] = (bytes[6]! & 0x0f) | 0x50;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function toEventType(kind: InboundDeliveryEventKind): OutboundWebhookEventType {
	return kind === "unsubscribed"
		? "subscriber.unsubscribed"
		: `delivery.${kind}`;
}

/**
 * Normalize a provider event into the shared versioned event envelope. Stable
 * provider event IDs become deterministic UUIDs so repeated ingestion remains
 * idempotent at the outbox unique constraint.
 */
export async function ingestInboundDeliveryEvent(
	input: IngestInboundDeliveryEventInput,
	options: OutboundWebhookStoreOptions = {},
): Promise<EnqueueOutboundWebhookResult> {
	const provider = input.provider.trim().toLowerCase();
	const providerEventId = input.providerEventId.trim();
	if (!provider || !providerEventId) {
		throw new TypeError("provider and providerEventId must not be blank");
	}
	if (provider.length > 100) {
		throw new RangeError("provider must not exceed 100 characters");
	}
	if (providerEventId.length > 200) {
		throw new RangeError("providerEventId must not exceed 200 characters");
	}
	if (
		input.occurredAt !== undefined &&
		!z.iso.datetime({ offset: true }).safeParse(input.occurredAt).success
	) {
		throw new TypeError(
			"occurredAt must be an ISO 8601 date-time with an offset",
		);
	}
	const subscriberUuid = input.subscriberUuid?.trim();
	const messageId = input.messageId?.trim();
	if (messageId !== undefined && messageId.length > 300) {
		throw new RangeError("messageId must not exceed 300 characters");
	}
	if (input.kind === "unsubscribed" && !subscriberUuid) {
		throw new TypeError(
			"subscriberUuid is required for unsubscribed delivery events",
		);
	}
	if (
		subscriberUuid !== undefined &&
		!z.uuid().safeParse(subscriberUuid).success
	) {
		throw new TypeError("subscriberUuid must be a valid UUID when provided");
	}
	const metadata = { ...(input.metadata ?? {}) };
	delete metadata.provider;
	delete metadata.provider_event_id;
	delete metadata.campaign_id;
	delete metadata.subscriber_uuid;
	let metadataJson: string;
	try {
		metadataJson = JSON.stringify(metadata);
	} catch {
		throw new TypeError("metadata must be JSON serializable");
	}
	if (
		new TextEncoder().encode(metadataJson).byteLength >
		MAX_INBOUND_DELIVERY_EVENT_METADATA_BYTES
	) {
		throw new RangeError(
			`metadata must not exceed ${MAX_INBOUND_DELIVERY_EVENT_METADATA_BYTES} bytes`,
		);
	}
	const subject =
		input.kind === "unsubscribed"
			? { kind: "subscriber" as const, key: subscriberUuid! }
			: {
					kind: "message" as const,
					key:
						messageId ||
						deterministicUuid(`${provider}:message:${providerEventId}`),
				};
	return enqueueOutboundWebhookEvent(
		{
			id: deterministicUuid(`${provider}:event:${providerEventId}`),
			type: toEventType(input.kind),
			occurredAt: input.occurredAt,
			source: "provider",
			correlationId: providerEventId,
			subject,
			data: {
				...metadata,
				provider,
				provider_event_id: providerEventId,
				...(input.campaignId === undefined
					? {}
					: { campaign_id: input.campaignId }),
				...(subscriberUuid === undefined
					? {}
					: { subscriber_uuid: subscriberUuid }),
			},
		},
		options,
	);
}
