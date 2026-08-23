import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createOutboundWebhookEndpoint,
	dispatchOutboundWebhooks,
	enqueueOperationLifecycleEvent,
} from "../src/outbound-webhooks";

const directories: string[] = [];

async function createStorePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-webhooks-"));
	directories.push(directory);
	return join(directory, "webhooks.json");
}

async function createHookEndpoint(path: string): Promise<string> {
	const endpoint = await createOutboundWebhookEndpoint(
		{
			name: "recovery",
			url: "https://8.8.8.8/hook",
			secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_RECOVERY",
			eventFilters: ["operation.*"],
		},
		{ path },
	);
	return endpoint.id;
}

async function enqueueDueDeliveries(
	path: string,
	count: number,
): Promise<string[]> {
	const ids: string[] = [];
	for (let index = 0; index < count; index += 1) {
		const event = await enqueueOperationLifecycleEvent(
			{
				executionId: `exec-${index}-${Math.random().toString(36).slice(2, 8)}`,
				operationId: `lists.list`,
				event: "succeeded",
				at: new Date("2026-08-01T09:00:00.000Z").toISOString(),
			},
			{ path, now: new Date("2026-08-01T09:00:00.000Z") },
		);
		ids.push(...event.deliveryIds);
	}
	return ids;
}

const okFetcher = (async () =>
	new Response("ok", { status: 200 })) as unknown as typeof fetch;
const refusedFetcher = (async () => {
	throw new Error("connection refused");
}) as unknown as typeof fetch;

describe("webhook tick echoed-set recovery", () => {
	afterEach(async () => {
		await Promise.all(
			directories.splice(0).map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
	});

	test("echoes exact claim positions and converges a retried recovery", async () => {
		const path = await createStorePath();
		await createHookEndpoint(path);
		await enqueueDueDeliveries(path, 2);
		const now = new Date("2026-08-01T09:00:05.000Z");

		const first = await dispatchOutboundWebhooks({
			store: { path },
			now,
			fetcher: okFetcher,
			resolveSecret: () => "whsec",
		});
		expect(first.claimed).toBe(2);
		expect(first.claimSteps).toHaveLength(2);
		for (const step of first.claimSteps) {
			expect(step.attemptCount).toBe(1);
		}

		// The retry carries the echoed set: both deliveries already moved
		// past the echoed attempt count (succeeded at attempt 1), so the
		// attempt-bound recovery pass skips both — one retry converges.
		const recovery = await dispatchOutboundWebhooks({
			store: { path },
			now,
			fetcher: okFetcher,
			resolveSecret: () => "whsec",
			recoveryClaims: first.claimSteps.map((step) => ({
				id: step.id,
				attemptCount: step.attemptCount,
			})),
		});
		expect(recovery).toMatchObject({
			requested: 2,
			claimed: 0,
			pendingIds: [],
			alreadyDone: 2,
		});
	});

	test("re-claims only members still at their echoed attempt count", async () => {
		const path = await createStorePath();
		await createHookEndpoint(path);
		const ids = await enqueueDueDeliveries(path, 2);
		const now = new Date("2026-08-01T09:00:05.000Z");

		// Recovery bound to the enqueue-time attempt count (0): both are
		// still at that position and due, so both are re-claimed.
		const recovery = await dispatchOutboundWebhooks({
			store: { path },
			now,
			fetcher: okFetcher,
			resolveSecret: () => "whsec",
			recoveryClaims: ids.map((id) => ({ id, attemptCount: 0 })),
		});
		expect(recovery).toMatchObject({ requested: 2, claimed: 2 });

		// A second identical recovery skips both: they moved past the
		// echoed attempt count.
		const converged = await dispatchOutboundWebhooks({
			store: { path },
			now,
			fetcher: okFetcher,
			resolveSecret: () => "whsec",
			recoveryClaims: ids.map((id) => ({ id, attemptCount: 0 })),
		});
		expect(converged).toMatchObject({
			requested: 2,
			claimed: 0,
			alreadyDone: 2,
		});
	});

	test("reports backoff members as pending, not done", async () => {
		const path = await createStorePath();
		await createHookEndpoint(path);
		const ids = await enqueueDueDeliveries(path, 1);
		const now = new Date("2026-08-01T09:00:05.000Z");

		// The first attempt fails: the delivery moves to retry at attempt
		// count 1 with a future backoff.
		const first = await dispatchOutboundWebhooks({
			store: { path },
			now,
			fetcher: refusedFetcher,
			resolveSecret: () => "whsec",
		});
		expect(first.retried).toBe(1);

		// Recovery bound to the new position (attempt 1): the entry sits in
		// backoff, so it is pending (retryable once due), never done.
		const pending = await dispatchOutboundWebhooks({
			store: { path },
			now,
			fetcher: okFetcher,
			resolveSecret: () => "whsec",
			recoveryClaims: [{ id: ids[0], attemptCount: 1 }],
		});
		expect(pending).toMatchObject({
			requested: 1,
			claimed: 0,
			pendingIds: [ids[0]],
			alreadyDone: 0,
		});
	});
});
