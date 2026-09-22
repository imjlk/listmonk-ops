import { describe, expect, test } from "bun:test";
import {
	createListmonkRuntimeClient,
	ListmonkRuntimeError,
	reconcileSubscriberMembership,
	type SubscriberMembershipReconciliationInput,
} from "../runtime";

type Membership = { id: number; subscription_status: string };
type Subscriber = { id: number; email: string; status: string; name: string; attribs: { source: string }; lists: Membership[] };
const EMAIL = "member@example.test";

function fixture(options: { optIn?: string; absent?: boolean; status?: string; memberships?: Membership[] } = {}) {
	const subscribers = new Map<number, Subscriber>();
	if (!options.absent) subscribers.set(7, {
		id: 7,
		email: EMAIL,
		status: options.status ?? "enabled",
		name: "Existing name",
		attribs: { source: "another app" },
		lists: options.memberships ?? [{ id: 2, subscription_status: "confirmed" }],
	});
	const calls: Array<{ method: string; url: URL; body?: Record<string, unknown> }> = [];
	const hooks: {
		beforeMutation?: () => void;
		response?: (request: Request) => Response | undefined;
	} = {};
	const client = createListmonkRuntimeClient({
		baseUrl: "https://mail.example.test",
		username: "runtime",
		accessToken: "test-token",
		fetch: Object.assign(
			async (input: RequestInfo | URL) => {
				const request = input instanceof Request ? input : new Request(input);
				const url = new URL(request.url);
				const body = request.method === "GET"
					? undefined
					: await request.json() as Record<string, unknown>;
				calls.push({ method: request.method, url, body });
				const overridden = hooks.response?.(request);
				if (overridden) return overridden;
				if (url.pathname.startsWith("/api/lists/")) {
					return Response.json({
						data: {
							id: Number(url.pathname.split("/").at(-1)),
							optin: options.optIn ?? "single",
						},
					});
				}
				if (url.pathname === "/api/subscribers/lists") {
					hooks.beforeMutation?.();
					const id = (body?.ids as number[])[0]!;
					const listId = (body?.target_list_ids as number[])[0]!;
					const sub = subscribers.get(id)!;
					const membership = sub.lists.find((list) => list.id === listId);
					if (body?.action === "add" && !membership) sub.lists.push({ id: listId, subscription_status: "unconfirmed" });
					if (body?.action === "unsubscribe" && membership) membership.subscription_status = "unsubscribed";
					return Response.json({ data: true });
				}
				if (url.pathname === "/api/subscribers" && request.method === "POST") {
					const sub = {
						id: 8,
						email: body?.email as string,
						status: "enabled",
						lists: [],
						name: "",
						attribs: { source: "" },
					};
					subscribers.set(8, sub);
					return Response.json({ data: sub });
				}
				if (url.pathname === "/api/subscribers") {
					const results = [...subscribers.values()].filter(
						(sub) => url.searchParams.get("query") === `subscribers.email = E'${sub.email.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`,
					);
					return Response.json({
						data: { results, total: results.length, per_page: 2, page: 1 },
					});
				}
				const sub = subscribers.get(Number(url.pathname.split("/").at(-1)));
				return sub
					? Response.json({ data: sub })
					: Response.json({ message: "unknown subscriber" }, { status: 400 });
			},
			{ preconnect() {} },
		),
	});
	const input = {
		client,
		email: EMAIL,
		ownedListId: 1,
		eligible: true,
		consented: true,
	};
	return { client, input, calls, hooks, subscribers };
}

async function errorCode(operation: Promise<unknown>, code: ListmonkRuntimeError["code"]) {
	try {
		await operation;
		throw new Error("Expected reconciliation to fail");
	}
	catch (error) {
		expect(error).toBeInstanceOf(ListmonkRuntimeError);
		expect((error as ListmonkRuntimeError).code).toBe(code);
		expect(String(error)).not.toContain(EMAIL);
		expect((error as Error).cause).toBeUndefined();
	}
}

describe("Fetch subscriber membership reconciliation", () => {
	for (const optIn of ["single", "double"] as const) {
		test(`creates and adds without preconfirmation for ${optIn} opt-in`, async () => {
			const f = fixture({ absent: true, optIn });
			const result = await reconcileSubscriberMembership(f.input);
			expect(result.provider).toEqual({ subscriber: "enabled", membership: "unconfirmed", optIn });
			expect(result.deliveryEligible).toBe(optIn === "single");
			expect(result.subscriberCreated).toBe(true);
			expect(result.action).toBe("added");
			expect(f.calls.find((call) => call.method === "POST")?.body).toEqual({ email: EMAIL, name: "", status: "enabled", lists: [], preconfirm_subscriptions: false });
			expect(f.calls.find((call) => call.method === "PUT")?.body).toEqual({ ids: [8], target_list_ids: [1], action: "add" });
			expect(JSON.stringify(result)).not.toContain(EMAIL);
		});
	}

	test("preserves unrelated lists, names and attributes and bounds the exact lookup", async () => {
		const f = fixture();
		await reconcileSubscriberMembership(f.input);
		expect(f.subscribers.get(7)).toMatchObject({ name: "Existing name", attribs: { source: "another app" }, lists: [{ id: 2, subscription_status: "confirmed" }, { id: 1, subscription_status: "unconfirmed" }] });
		expect(f.calls.filter((call) => call.method !== "GET")).toHaveLength(1);
		const query = f.calls.find((call) => call.url.pathname === "/api/subscribers")!.url.searchParams;
		expect(query.get("query")).toBe(`subscribers.email = E'${EMAIL}'`);
		expect(query.get("per_page")).toBe("2");
	});

	test("preserves an unsubscribe arriving between lookup and add", async () => {
		const f = fixture();
		f.hooks.beforeMutation = () => f.subscribers.get(7)!.lists.push({ id: 1, subscription_status: "unsubscribed" });
		const result = await reconcileSubscriberMembership(f.input);
		expect(result.provider.membership).toBe("unsubscribed");
		expect(result.deliveryEligible).toBe(false);
		expect(f.calls.find((call) => call.method === "PUT")?.body).not.toHaveProperty("status");
	});

	test("global blocklisting and existing list unsubscription never trigger writes", async () => {
		for (const options of [{ status: "blocklisted" }, { memberships: [{ id: 1, subscription_status: "unsubscribed" }] }]) {
			const f = fixture(options);
			const result = await reconcileSubscriberMembership(f.input);
			expect(result.application).toEqual({ eligible: true, consented: true });
			expect(result.deliveryEligible).toBe(false);
			expect(result.action).toBe("none");
			expect(f.calls.every((call) => call.method === "GET")).toBe(true);
		}
	});

	test("repeated deactivation preserves a tombstone that routine add cannot restore", async () => {
		const f = fixture({ memberships: [{ id: 1, subscription_status: "confirmed" }, { id: 2, subscription_status: "confirmed" }] });
		for (const eligible of [false, false, true, true]) {
			const result = await reconcileSubscriberMembership({ ...f.input, eligible });
			expect(result.provider.membership).toBe("unsubscribed");
			expect(result.deliveryEligible).toBe(false);
		}
		expect(f.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
		expect(f.subscribers.get(7)?.lists[1]?.subscription_status).toBe("confirmed");
	});

	test("no consent or eligibility leaves absent accounts untouched", async () => {
		for (const application of [{ eligible: false, consented: true }, { eligible: true, consented: false }]) {
			const f = fixture({ absent: true });
			const result = await reconcileSubscriberMembership({ ...f.input, ...application });
			expect(result.subscriberId).toBeNull();
			expect(result.provider.membership).toBe("absent");
			expect(f.calls.every((call) => call.method === "GET")).toBe(true);
		}
	});

	test("validates stale and missing cached IDs before resolving the exact email", async () => {
		for (const cachedSubscriberId of [7, 99]) {
			const f = fixture();
			f.subscribers.get(7)!.email = "changed@example.test";
			const result = await reconcileSubscriberMembership({ ...f.input, cachedSubscriberId });
			expect(result.subscriberId).toBe(8);
			expect(f.subscribers.get(7)?.lists).toEqual([{ id: 2, subscription_status: "confirmed" }]);
			expect(f.calls.find((call) => call.method === "PUT")?.body?.ids).toEqual([8]);
		}
	});

	test("valid cached ID avoids an email query and quoted addresses are escaped", async () => {
		const f = fixture();
		await reconcileSubscriberMembership({ ...f.input, cachedSubscriberId: 7 });
		expect(f.calls.some((call) => call.url.pathname === "/api/subscribers")).toBe(false);
		const quoted = fixture({ absent: true });
		await reconcileSubscriberMembership({ ...quoted.input, email: "O'Brien@example.test" });
		expect(quoted.calls.find((call) => call.url.search)?.url.searchParams.get("query")).toBe("subscribers.email = E'o''brien@example.test'");
	});

	test("rejects negative or unknown mutation acknowledgements", async () => {
		for (const acknowledgement of [false, null, {}, "true"]) {
			const f = fixture();
			f.hooks.response = (request) => request.method === "PUT" ? Response.json({ data: acknowledgement }) : undefined;
			await errorCode(reconcileSubscriberMembership(f.input), acknowledgement === false ? "membership_rejected" : "provider_state_unknown");
		}
	});

	test("fails closed before writes on malformed, ambiguous or oversized provider reads", async () => {
		for (const response of [
			() => new Response("{"),
			() => new Response(" ".repeat(65 * 1024) + EMAIL),
			() => Response.json({ data: { results: [], total: 1 } }),
			() => Response.json({ data: { results: [{}, {}], total: 2 } }),
			() => Response.json({ data: { results: [{ id: 7, email: EMAIL, status: "unknown", lists: [] }], total: 1 } }),
			() => Response.json({ data: { results: [{ id: 7, email: "wrong@example.test", status: "enabled", lists: [] }], total: 1 } }),
		]) {
			const f = fixture();
			f.hooks.response = (request) => new URL(request.url).pathname === "/api/subscribers" ? response() : undefined;
			await errorCode(reconcileSubscriberMembership(f.input), "provider_state_unknown");
			expect(f.calls.every((call) => call.method === "GET")).toBe(true);
		}
	});

	test("does not treat a positive acknowledgement as proof of membership", async () => {
		const f = fixture();
		f.hooks.response = (request) => request.method === "PUT" ? Response.json({ data: true }) : undefined;
		await errorCode(reconcileSubscriberMembership(f.input), "provider_state_unknown");
	});

	test("does not expose HTTP response bodies or recipient data in errors", async () => {
		const f = fixture();
		f.hooks.response = () => Response.json({ message: EMAIL }, { status: 403 });
		await errorCode(reconcileSubscriberMembership(f.input), "request_failed");
	});

	test("validates input before fetching and honors a pre-aborted signal", async () => {
		const f = fixture();
		for (const invalid of [{ email: "invalid" }, { ownedListId: 0 }, { cachedSubscriberId: -1 }, { eligible: "yes" }, { timeoutMs: 0 }]) {
			await errorCode(reconcileSubscriberMembership({ ...f.input, ...invalid } as SubscriberMembershipReconciliationInput), "invalid_reconciliation");
		}
		await errorCode(reconcileSubscriberMembership({ ...f.input, signal: AbortSignal.abort(EMAIL) }), "aborted");
		expect(f.calls).toHaveLength(0);
	});

	test("bounds a fetch implementation that ignores abort", async () => {
		const f = fixture();
		const client = createListmonkRuntimeClient({
			baseUrl: "https://mail.example.test", username: "runtime", accessToken: "test-token",
			fetch: Object.assign(() => new Promise<Response>(() => {}), { preconnect() {} }),
		});
		await errorCode(reconcileSubscriberMembership({ ...f.input, client, timeoutMs: 20 }), "timed_out");
	});
	test("rejects a null successful cache response instead of accepting absence", async () => {
		const f = fixture();
		f.hooks.response = (request) => new URL(request.url).pathname === "/api/subscribers/7"
			? Response.json({ data: null }) : undefined;
		await errorCode(reconcileSubscriberMembership({ ...f.input, cachedSubscriberId: 7 }), "provider_state_unknown");
		expect(f.calls.some((call) => call.url.pathname === "/api/subscribers")).toBe(false);
	});

	test("rejects unknown opt-in, duplicate memberships and oversized membership lists", async () => {
		for (const options of [
			{ optIn: "unknown" },
			{ memberships: [{ id: 2, subscription_status: "confirmed" }, { id: 2, subscription_status: "confirmed" }] },
			{ memberships: Array.from({ length: 101 }, (_, index) => ({ id: index + 2, subscription_status: "confirmed" })) },
		]) {
			const f = fixture(options);
			await errorCode(reconcileSubscriberMembership(f.input), "provider_state_unknown");
			expect(f.calls.every((call) => call.method === "GET")).toBe(true);
		}
	});

	test("snapshots application decisions and never exposes accessor exceptions", async () => {
		const f = fixture();
		const input = { ...f.input };
		f.hooks.response = () => { input.ownedListId = 2; input.consented = false; return undefined; };
		const result = await reconcileSubscriberMembership(input);
		expect(result.listId).toBe(1);
		expect(result.application.consented).toBe(true);
		expect(f.calls.find((call) => call.method === "PUT")?.body?.target_list_ids).toEqual([1]);
		await errorCode(reconcileSubscriberMembership({ ...f.input, get email(): string { throw new Error(EMAIL); } }), "invalid_reconciliation");
	});

});
