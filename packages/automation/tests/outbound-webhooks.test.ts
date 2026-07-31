import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listOperationAuditEntries } from "@listmonk-ops/common";
import {
	createOutboundWebhookEndpoint,
	deleteOutboundWebhookEndpoint,
	dispatchOutboundWebhooks,
	enqueueOutboundWebhookEvent,
	enqueueOperationLifecycleEvent,
	getOutboundWebhookEndpoint,
	listOutboundWebhookDeliveries,
	listOutboundWebhookEndpoints,
	OutboundWebhookConflictError,
	redactOutboundWebhookData,
	recordOperationAuditWithLifecycle,
	replayOutboundWebhookDeadLetters,
	retryOutboundWebhookDelivery,
	signOutboundWebhookPayload,
	updateOutboundWebhookEndpoint,
	verifyOutboundWebhookSignature,
} from "../src/outbound-webhooks";
import { postPinnedHttpsWebhookWithFallback } from "../src/webhook-transport";

const directories: string[] = [];

async function createStorePath(): Promise<string> {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-outbound-webhooks-"),
	);
	directories.push(directory);
	return join(directory, "webhooks.json");
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

async function createEndpoint(
	path: string,
	overrides: Partial<Parameters<typeof createOutboundWebhookEndpoint>[0]> = {},
) {
	return createOutboundWebhookEndpoint(
		{
			name: "primary",
			url: "https://8.8.8.8/hooks/listmonk",
			secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_PRIMARY",
			eventFilters: ["operation.*"],
			...overrides,
		},
		{ path },
	);
}

describe("outbound webhook endpoint registry", () => {
	test("creates, updates, lists, and deletes endpoint metadata without secret values", async () => {
		const path = await createStorePath();
		const created = await createEndpoint(path);

		expect(created).toMatchObject({
			name: "primary",
			secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_PRIMARY",
			eventFilters: ["operation.*"],
			enabled: true,
		});
		expect(created).not.toHaveProperty("secret");
		expect(await getOutboundWebhookEndpoint(created.id, { path })).toEqual(
			created,
		);
		expect(await listOutboundWebhookEndpoints({ path })).toEqual([created]);

		const updated = await updateOutboundWebhookEndpoint(
			created.id,
			{
				name: "renamed",
				enabled: false,
				eventFilters: ["campaign.started"],
			},
			{ path },
		);
		expect(updated).toMatchObject({
			name: "renamed",
			enabled: false,
			eventFilters: ["campaign.started"],
		});

		expect(await deleteOutboundWebhookEndpoint(created.id, { path })).toEqual(
			updated,
		);
		expect(await listOutboundWebhookEndpoints({ path })).toEqual([]);
	});

	test("rejects insecure, credential-bearing, secret-in-query, and private URLs", async () => {
		const path = await createStorePath();
		for (const url of [
			"http://8.8.8.8/hook",
			"https://user:pass@8.8.8.8/hook",
			"https://8.8.8.8/hook?token=secret",
			"https://127.0.0.1/hook",
			"https://169.254.169.254/latest/meta-data",
		]) {
			await expect(
				createEndpoint(path, { name: url, url }),
			).rejects.toThrow();
		}
	});

	test("rejects duplicate names and unknown event filters", async () => {
		const path = await createStorePath();
		await createEndpoint(path);
		await expect(
			createEndpoint(path, { url: "https://1.1.1.1/hook" }),
		).rejects.toBeInstanceOf(OutboundWebhookConflictError);
		await expect(
			createEndpoint(path, {
				name: "invalid-filter",
				eventFilters: ["campaign.typo"],
			}),
		).rejects.toThrow("Unsupported event filter");
	});

	test("rejects signing references outside the dedicated environment namespace", async () => {
		const path = await createStorePath();
		await expect(
			createEndpoint(path, {
				secretRef: "AWS_SECRET_ACCESS_KEY",
			}),
		).rejects.toThrow("LISTMONK_OPS_WEBHOOK_SECRET");
	});
});

describe("outbound webhook event outbox", () => {
	test("redacts sensitive fields recursively and handles cycles", () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(
			redactOutboundWebhookData({
				email: "person@example.com",
				nested: {
					api_token: "secret",
					subscriberEmail: "person@example.com",
					recipientAddress: "person@example.com",
					userCookie: "session",
					safe: "visible",
				},
				circular,
			}),
		).toEqual({
			email: "[REDACTED]",
			nested: {
				api_token: "[REDACTED]",
				subscriberEmail: "[REDACTED]",
				recipientAddress: "[REDACTED]",
				userCookie: "[REDACTED]",
				safe: "visible",
			},
			circular: { self: "[CIRCULAR]" },
		});
	});

	test("filters endpoints and deduplicates the same event and endpoint", async () => {
		const path = await createStorePath();
		const operationEndpoint = await createEndpoint(path);
		await createEndpoint(path, {
			name: "campaigns",
			url: "https://1.1.1.1/campaigns",
			secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_CAMPAIGN",
			eventFilters: ["campaign.*"],
		});
		const eventId = "03b73791-da72-43eb-89e0-b0b803081618";
		const input = {
			id: eventId,
			type: "operation.started" as const,
			source: "operation" as const,
			correlationId: "execution-1",
			subject: { kind: "operation" as const, key: "campaigns.start" },
			data: { email: "person@example.com", confirmed: true },
		};

		expect(await enqueueOutboundWebhookEvent(input, { path })).toMatchObject({
			matchedEndpoints: 1,
			queuedDeliveries: 1,
			duplicateDeliveries: 0,
		});
		expect(await enqueueOutboundWebhookEvent(input, { path })).toMatchObject({
			matchedEndpoints: 1,
			queuedDeliveries: 0,
			duplicateDeliveries: 1,
		});

		const deliveries = await listOutboundWebhookDeliveries({ path });
		expect(deliveries).toHaveLength(1);
		expect(deliveries[0]).toMatchObject({
			endpointId: operationEndpoint.id,
			eventId,
			status: "pending",
			event: {
				data: {
					email: "[REDACTED]",
					confirmed: true,
				},
			},
		});
	});

	test("marks active deliveries exhausted when their endpoint is deleted", async () => {
		const path = await createStorePath();
		const endpoint = await createEndpoint(path);
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.failed",
				source: "operation",
				data: {},
			},
			{ path },
		);

		await deleteOutboundWebhookEndpoint(endpoint.id, { path });
		expect(await listOutboundWebhookDeliveries({ path })).toMatchObject([
			{
				status: "exhausted",
				lastError: "Endpoint deleted before delivery",
			},
		]);
	});

	test("projects privacy-preserving operation audit metadata into the shared envelope", async () => {
		const path = await createStorePath();
		await createEndpoint(path);

		const result = await enqueueOperationLifecycleEvent(
			{
				executionId: "exec-123",
				surface: "mcp",
				operationId: "campaigns.schedule",
				event: "succeeded",
				confirmationRequired: true,
				confirmed: true,
				dryRun: false,
			},
			{ path },
		);

		expect(result).toMatchObject({
			matchedEndpoints: 1,
			queuedDeliveries: 1,
			event: {
				type: "operation.succeeded",
				source: "operation",
				correlationId: "exec-123",
				subject: {
					kind: "operation",
					key: "campaigns.schedule",
				},
				data: {
					surface: "mcp",
					confirmation_required: true,
					confirmed: true,
					dry_run: false,
				},
			},
		});
	});

	test("keeps the durable audit result when lifecycle projection fails", async () => {
		const path = await createStorePath();
		const directory = await mkdtemp(
			join(tmpdir(), "listmonk-ops-invalid-webhook-store-"),
		);
		directories.push(directory);
		const errors: unknown[] = [];

		const entry = await recordOperationAuditWithLifecycle(
			{
				executionId: "exec-durable",
				surface: "cli",
				operationId: "campaigns.schedule",
				event: "started",
				confirmationRequired: true,
				confirmed: true,
				dryRun: false,
			},
			{
				audit: { path },
				webhook: { path: directory },
				onLifecycleError: (error) => errors.push(error),
			},
		);

		expect(entry.executionId).toBe("exec-durable");
		expect(await listOperationAuditEntries({ path })).toHaveLength(1);
		expect(errors).toHaveLength(1);
	});
});

describe("outbound webhook delivery", () => {
	test("signs the timestamp and exact body and verifies replay tolerance", () => {
		const timestamp = "2026-07-29T00:00:00.000Z";
		const body = '{"ok":true}';
		const signature = signOutboundWebhookPayload("secret", timestamp, body);
		expect(signature).toMatch(/^v1=[a-f0-9]{64}$/);
		expect(
			verifyOutboundWebhookSignature({
				secret: "secret",
				timestamp,
				body,
				signature,
				now: new Date("2026-07-29T00:04:59.000Z"),
			}),
		).toBe(true);
		expect(
			verifyOutboundWebhookSignature({
				secret: "secret",
				timestamp,
				body,
				signature,
				now: new Date("2026-07-29T00:05:01.000Z"),
			}),
		).toBe(false);
		expect(
			verifyOutboundWebhookSignature({
				secret: "different",
				timestamp,
				body,
				signature,
				now: new Date("2026-07-29T00:00:01.000Z"),
			}),
		).toBe(false);
	});

	test("delivers with signed headers and records success", async () => {
		const path = await createStorePath();
		await createEndpoint(path);
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.succeeded",
				source: "operation",
				data: { operation_id: "campaigns.start" },
			},
			{ path },
		);
		const fetcher = mock(async (_url: string | URL | Request, init?: RequestInit) => {
			const headers = new Headers(init?.headers);
			const body = String(init?.body);
			expect(init?.redirect).toBe("error");
			expect(headers.get("X-Listmonk-Ops-Event-Type")).toBe(
				"operation.succeeded",
			);
			expect(
				verifyOutboundWebhookSignature({
					secret: "  test-secret  ",
					timestamp: headers.get("X-Listmonk-Ops-Timestamp")!,
					body,
					signature: headers.get("X-Listmonk-Ops-Signature")!,
				}),
			).toBe(true);
			expect(
				verifyOutboundWebhookSignature({
					secret: "test-secret",
					timestamp: headers.get("X-Listmonk-Ops-Timestamp")!,
					body,
					signature: headers.get("X-Listmonk-Ops-Signature")!,
				}),
			).toBe(false);
			return new Response(null, { status: 204 });
		});

		const result = await dispatchOutboundWebhooks({
			store: { path },
			fetcher: fetcher as typeof fetch,
			resolveSecret: () => "  test-secret  ",
		});
		expect(result).toMatchObject({
			claimed: 1,
			succeeded: 1,
			retried: 0,
			exhausted: 0,
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(await listOutboundWebhookDeliveries({ path })).toMatchObject([
			{ status: "succeeded", attemptCount: 1, statusCode: 204 },
		]);
	});

	test("normalizes bracketed public IPv6 literals before address resolution", async () => {
		const path = await createStorePath();
		await createEndpoint(path, {
			url: "https://[2001:4860:4860::8888]/hooks/listmonk",
		});
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.succeeded",
				source: "operation",
				data: {},
			},
			{ path },
		);
		const fetcher = mock(async () => new Response(null, { status: 204 }));

		expect(
			await dispatchOutboundWebhooks({
				store: { path },
				fetcher: fetcher as typeof fetch,
				resolveSecret: () => "test-secret",
			}),
		).toMatchObject({ succeeded: 1 });
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	test("falls back across every validated address after connection errors", async () => {
		const signal = new AbortController().signal;
		const send = mock(
			async (input: {
				url: string;
				address: { address: string; family: 4 | 6 };
				headers: Readonly<Record<string, string>>;
				body: string;
				signal: AbortSignal;
			}) => {
				if (input.address.address === "203.0.113.10") {
					throw new Error("first address unavailable");
				}
				return { ok: true, status: 204 };
			},
		);

		expect(
			await postPinnedHttpsWebhookWithFallback(
				{
					url: "https://example.com/hooks",
					addresses: [
						{ address: "203.0.113.10", family: 4 },
						{ address: "2001:4860:4860::8888", family: 6 },
					],
					headers: {},
					body: "{}",
					signal,
				},
				send,
			),
		).toEqual({ ok: true, status: 204 });
		expect(send).toHaveBeenCalledTimes(2);
	});

	test("claims bounded batches so leases start near actual delivery", async () => {
		const path = await createStorePath();
		await createEndpoint(path);
		for (let index = 0; index < 6; index += 1) {
			await enqueueOutboundWebhookEvent(
				{
					type: "operation.succeeded",
					source: "operation",
					correlationId: `exec-${index}`,
					data: {},
				},
				{ path },
			);
		}
		let active = 0;
		let maximumActive = 0;
		const fetcher = mock(async () => {
			active += 1;
			maximumActive = Math.max(maximumActive, active);
			await new Promise((resolve) => setTimeout(resolve, 10));
			active -= 1;
			return new Response(null, { status: 204 });
		});

		const result = await dispatchOutboundWebhooks({
			store: { path },
			concurrency: 2,
			fetcher: fetcher as typeof fetch,
			resolveSecret: () => "test-secret",
		});
		expect(result).toMatchObject({
			claimed: 6,
			succeeded: 6,
		});
		expect(maximumActive).toBe(2);
		expect(fetcher).toHaveBeenCalledTimes(6);
	});

	test("preserves sibling results when another worker reclaims an expired lease", async () => {
		const path = await createStorePath();
		await createEndpoint(path);
		const targetEventId = "47a0f9ed-3bc4-49c4-a0d7-b67145f7cdca";
		const siblingEventId = "ddadf4c4-1527-4b5d-8c08-dcc5484816ad";
		const target = await enqueueOutboundWebhookEvent(
			{
				id: targetEventId,
				type: "operation.succeeded",
				source: "operation",
				data: {},
			},
			{ path },
		);
		await enqueueOutboundWebhookEvent(
			{
				id: siblingEventId,
				type: "operation.succeeded",
				source: "operation",
				data: {},
			},
			{ path },
		);
		const targetDeliveryId = target.deliveryIds[0]!;
		let markTargetStarted = () => undefined;
		const targetStarted = new Promise<void>((resolve) => {
			markTargetStarted = resolve;
		});
		let releaseTarget = () => undefined;
		const targetGate = new Promise<void>((resolve) => {
			releaseTarget = resolve;
		});
		const firstFetcher = mock(
			async (_url: string | URL | Request, init?: RequestInit) => {
				const eventId = new Headers(init?.headers).get(
					"X-Listmonk-Ops-Event-Id",
				);
				if (eventId === targetEventId) {
					markTargetStarted();
					await targetGate;
				}
				return new Response(null, { status: 204 });
			},
		);
		const firstAt = new Date("2099-07-29T00:00:00.000Z");
		const firstDispatch = dispatchOutboundWebhooks({
			store: { path },
			now: firstAt,
			leaseMs: 1_000,
			concurrency: 2,
			fetcher: firstFetcher as typeof fetch,
			resolveSecret: () => "test-secret",
		});
		await targetStarted;
		for (let attempt = 0; attempt < 100; attempt += 1) {
			const deliveries = await listOutboundWebhookDeliveries({ path });
			if (
				deliveries.some(
					(delivery) =>
						delivery.eventId === siblingEventId &&
						delivery.status === "succeeded",
				)
			) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
		expect(await listOutboundWebhookDeliveries({ path })).toContainEqual(
			expect.objectContaining({
				eventId: siblingEventId,
				status: "succeeded",
			}),
		);

		expect(
			await dispatchOutboundWebhooks({
				store: { path },
				now: new Date("2099-07-29T00:00:02.000Z"),
				leaseMs: 1_000,
				concurrency: 1,
				deliveryIds: [targetDeliveryId],
				fetcher: mock(
					async () => new Response(null, { status: 204 }),
				) as typeof fetch,
				resolveSecret: () => "test-secret",
			}),
		).toMatchObject({ claimed: 1, succeeded: 1, skipped: 0 });

		releaseTarget();
		expect(await firstDispatch).toMatchObject({
			claimed: 2,
			succeeded: 1,
			skipped: 1,
			results: expect.arrayContaining([
				expect.objectContaining({
					deliveryId: targetDeliveryId,
					status: "skipped",
					errorCode: "lease_conflict",
				}),
			]),
		});
		expect(await listOutboundWebhookDeliveries({ path })).toMatchObject([
			{ status: "succeeded" },
			{ status: "succeeded" },
		]);
	});

	test("retries transient failures, exhausts permanent failures, and supports manual retry", async () => {
		const path = await createStorePath();
		await createEndpoint(path, { maxAttempts: 2 });
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.failed",
				source: "operation",
				data: {},
			},
			{ path },
		);
		const transient = mock(async () => new Response(null, { status: 503 }));
		const firstAt = new Date("2099-07-29T00:00:00.000Z");
		expect(
			await dispatchOutboundWebhooks({
				store: { path },
				now: firstAt,
				baseRetryDelayMs: 1_000,
				fetcher: transient as typeof fetch,
				resolveSecret: () => "secret",
			}),
		).toMatchObject({ retried: 1 });
		expect(await listOutboundWebhookDeliveries({ path })).toMatchObject([
			{ status: "retry", attemptCount: 1 },
		]);

		const permanent = mock(async () => new Response(null, { status: 400 }));
		expect(
			await dispatchOutboundWebhooks({
				store: { path },
				now: new Date("2099-07-29T00:00:01.000Z"),
				baseRetryDelayMs: 1_000,
				fetcher: permanent as typeof fetch,
				resolveSecret: () => "secret",
			}),
		).toMatchObject({ exhausted: 1 });
		const [exhausted] = await listOutboundWebhookDeliveries({ path });
		expect(exhausted).toMatchObject({
			status: "exhausted",
			attemptCount: 2,
			statusCode: 400,
		});

		const retried = await retryOutboundWebhookDelivery(exhausted!.id, {
			path,
		});
		expect(retried).toMatchObject({
			status: "pending",
			attemptCount: 0,
			manualRetryCount: 1,
		});
	});

	test("does not dispatch disabled endpoints or leak missing secret values", async () => {
		const path = await createStorePath();
		const endpoint = await createEndpoint(path);
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.started",
				source: "operation",
				data: {},
			},
			{ path },
		);
		await updateOutboundWebhookEndpoint(
			endpoint.id,
			{ enabled: false },
			{ path },
		);
		const fetcher = mock(async () => new Response(null, { status: 204 }));
		const result = await dispatchOutboundWebhooks({
			store: { path },
			fetcher: fetcher as typeof fetch,
			resolveSecret: () => undefined,
		});
		expect(result).toMatchObject({ claimed: 1, exhausted: 1 });
		expect(result.results[0]?.errorCode).toBe("endpoint_unavailable");
		expect(result.results[0]).not.toHaveProperty("error");
		expect(fetcher).not.toHaveBeenCalled();
	});

	test("returns structured replay failures without backend error text", async () => {
		const path = await createStorePath();
		const endpoint = await createEndpoint(path);
		await enqueueOutboundWebhookEvent(
			{
				type: "operation.started",
				source: "operation",
				data: {},
			},
			{ path },
		);
		await dispatchOutboundWebhooks({
			store: { path },
			fetcher: mock(async () => new Response(null, { status: 400 })) as typeof fetch,
			resolveSecret: () => "test-secret",
		});
		await updateOutboundWebhookEndpoint(
			endpoint.id,
			{ enabled: false },
			{ path },
		);

		const result = await replayOutboundWebhookDeadLetters({
			path,
			dryRun: false,
		});
		expect(result).toMatchObject({
			eligible: 1,
			replayed: 0,
			failed: 1,
			errors: [{ errorCode: "endpoint_unavailable" }],
		});
		expect(JSON.stringify(result)).not.toContain('"error":');
	});
});
