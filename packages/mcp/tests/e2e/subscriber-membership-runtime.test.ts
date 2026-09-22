import { describe, expect, test } from "bun:test";
import {
	createListmonkRuntimeClient,
	ListmonkRuntimeError,
	reconcileSubscriberMembership,
} from "@listmonk-ops/openapi/runtime";
import { buildTestName, createTestClient, TEST_CONFIG } from "../setup.js";

/** Test-only HTTPS-to-loopback bridge; production runtime still requires HTTPS. */
function runtimeClient(hooks: {
	before?: (request: Request) => Promise<void>;
	after?: (request: Request, response: Response) => Promise<Response>;
} = {}) {
	const local = new URL(TEST_CONFIG.baseUrl);
	if (!["localhost", "127.0.0.1", "[::1]"].includes(
		local.hostname,
	)) throw new Error("Local stack required");
	return createListmonkRuntimeClient({
		baseUrl: "https://membership-runtime.example.test",
		username: TEST_CONFIG.username,
		accessToken: TEST_CONFIG.apiToken || TEST_CONFIG.password,
		fetch: Object.assign(async (input: RequestInfo | URL) => {
			const request = input instanceof Request ? input : new Request(input);
			const logical = new URL(request.url);
			if (logical.origin !== "https://membership-runtime.example.test") throw new Error("Unexpected runtime target");
			await hooks.before?.(request.clone());
			const url = `${TEST_CONFIG.baseUrl.replace(/\/$/, "")}${logical.pathname.slice("/api".length)}${logical.search}`;
			const response = await fetch(new Request(url, request));
			const wrapped = new Response(response.body, { status: response.status, headers: response.headers });
			return hooks.after ? hooks.after(request, wrapped) : wrapped;
		}, { preconnect() {} }),
	});
}

async function withFixture(
	optin: "single" | "double",
	run: (fixture: { api: ReturnType<typeof createTestClient>; email: string; targetId: number; otherId: number; subscriberId: number; cleanupIds: number[] }) => Promise<void>,
) {
	const api = createTestClient();
	const prefix = buildTestName("membership-runtime");
	const listIds: number[] = [];
	const cleanupIds: number[] = [];
	try {
		for (const suffix of ["target", "other"]) {
			const response = await api.list.create({
				body: { name: `${prefix}-${suffix}`, type: "private", optin },
			});
			if (response.error || !response.data.id) throw new Error(
				"List fixture failed",
			);
			listIds.push(response.data.id);
		}
		const email = `${prefix}@example.test`;
		const response = await api.subscriber.create({
			body: {
				email,
				name: "Shared account",
				status: "enabled",
				lists: [listIds[1]!],
				preconfirm_subscriptions: true,
				attribs: { other_app: "preserve" },
			},
		});
		if (response.error || !response.data.id) throw new Error(
			"Subscriber fixture failed",
		);
		cleanupIds.push(response.data.id);
		await run({
			api,
			email,
			targetId: listIds[0]!,
			otherId: listIds[1]!,
			subscriberId: response.data.id,
			cleanupIds,
		});
	} finally {
		for (const id of cleanupIds) await api.subscriber.delete({ path: { id } });
		for (const id of listIds) await api.list.delete({ path: { list_id: id } });
	}
}

describe("Subscriber membership runtime against Listmonk 6.2", () => {
	for (const optin of ["single", "double"] as const) {
		test(`preserves another application list and repeated add/remove jobs (${optin})`, async () => {
			await withFixture(optin, async ({ api, email, targetId, otherId, subscriberId }) => {
				const input = { client: runtimeClient(), email, ownedListId: targetId, eligible: true, consented: true };
				const first = await reconcileSubscriberMembership(input);
				expect(first.provider.membership).toBe("unconfirmed");
				expect(first.deliveryEligible).toBe(optin === "single");
				expect((await reconcileSubscriberMembership(input)).action).toBe("none");
				const removed = await reconcileSubscriberMembership({ ...input, eligible: false });
				expect(removed.action).toBe("unsubscribed");
				expect((await reconcileSubscriberMembership({ ...input, eligible: false })).action).toBe("none");
				const repeated = await reconcileSubscriberMembership(input);
				expect(repeated.provider.membership).toBe("unsubscribed");
				expect(repeated.deliveryEligible).toBe(false);
				const stored = await api.subscriber.getById({ path: { id: subscriberId } });
				expect(stored.data.name).toBe("Shared account");
				expect(stored.data.attribs).toEqual({ other_app: "preserve" });
				expect(stored.data.lists?.find((list) => list.id === otherId)?.subscription_status).toBe("confirmed");
			});
		});
	}

	test("does not restore a concurrent unsubscribe between lookup and add", async () => {
		await withFixture("single", async ({ api, email, targetId, otherId, subscriberId }) => {
			let injected = false;
			const client = runtimeClient({ before: async (request) => {
				if (request.method !== "PUT" || injected) return;
				injected = true;
				const body = await request.json() as Record<string, unknown>;
				expect(body).not.toHaveProperty("status");
				for (const action of ["add", "unsubscribe"] as const) {
					const response = await api.subscriber.manageLists({ body: { ids: [subscriberId], target_list_ids: [targetId], action } });
					expect(response.data).toBe(true);
				}
			} });
			const result = await reconcileSubscriberMembership({ client, email, ownedListId: targetId, eligible: true, consented: true });
			expect(injected).toBe(true);
			expect(result.provider.membership).toBe("unsubscribed");
			expect(result.deliveryEligible).toBe(false);
			const stored = await api.subscriber.getById({ path: { id: subscriberId } });
			expect(stored.data.lists?.find((list) => list.id === otherId)?.subscription_status).toBe("confirmed");
		});
	});

	test("preserves pre-existing global blocklisting", async () => {
		await withFixture("single", async ({ api, email, targetId, subscriberId }) => {
			await api.subscriber.patch({ path: { id: subscriberId }, body: { status: "blocklisted" } });
			const result = await reconcileSubscriberMembership({ client: runtimeClient(), email, ownedListId: targetId, eligible: true, consented: true });
			expect(result.provider.subscriber).toBe("blocklisted");
			expect(result.provider.membership).toBe("absent");
			expect(result.action).toBe("none");
		});
	});

	test("re-resolves a cached subscriber ID after an email change", async () => {
		await withFixture("single", async ({ api, email, targetId, otherId, subscriberId, cleanupIds }) => {
			await api.subscriber.patch({ path: { id: subscriberId }, body: { email: `changed-${email}` } });
			const result = await reconcileSubscriberMembership({ client: runtimeClient(), email, ownedListId: targetId, cachedSubscriberId: subscriberId, eligible: true, consented: true });
			if (result.subscriberId) cleanupIds.push(result.subscriberId);
			expect(result.subscriberId).not.toBe(subscriberId);
			expect(result.subscriberCreated).toBe(true);
			const previous = await api.subscriber.getById({ path: { id: subscriberId } });
			expect(previous.data.email).toBe(`changed-${email}`);
			expect(previous.data.lists?.map((list) => list.id)).toEqual([otherId]);
		});
	});

	test("resolves an apostrophe-containing email as one exact SQL literal", async () => {
		await withFixture("single", async ({ api, email, targetId, subscriberId }) => {
			const quoted = `o'${email}`;
			await api.subscriber.patch({ path: { id: subscriberId }, body: { email: quoted } });
			const result = await reconcileSubscriberMembership({ client: runtimeClient(), email: quoted, ownedListId: targetId, eligible: true, consented: true });
			expect(result.subscriberId).toBe(subscriberId);
			expect(result.subscriberCreated).toBe(false);
		});
	});

	test("fails closed on negative acknowledgements and unreadable provider responses", async () => {
		await withFixture("single", async ({ email, targetId }) => {
			for (const scenario of ["negative", "malformed", "oversized"] as const) {
				const client = runtimeClient({ after: async (request, response) => {
					if (scenario === "negative" && request.method === "PUT") {
						await response.body?.cancel();
							return Response.json({ data: false });
					}
					if (scenario !== "negative" && new URL(request.url).pathname.startsWith("/api/lists/")) {
						await response.body?.cancel();
							return new Response(scenario === "malformed" ? "{" : " ".repeat(65 * 1024));
					}
					return response;
				} });
				try {
					await reconcileSubscriberMembership({ client, email, ownedListId: targetId, eligible: true, consented: true });
					throw new Error("Expected fail-closed result");
				} catch (error) {
					expect(error).toBeInstanceOf(ListmonkRuntimeError);
					expect((error as ListmonkRuntimeError).code).toBe(scenario === "negative" ? "membership_rejected" : "provider_state_unknown");
					expect(String(error)).not.toContain(email);
				}
			}
		});
	});
});
