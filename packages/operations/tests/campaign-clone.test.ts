import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import { invokeCloneCampaignOperation } from "../src";
import { createInMemoryResourceCreateStore } from "./helpers/resource-create-store.js";

type CampaignClient = Pick<ListmonkClient, "campaign">;

const source = {
	id: 11,
	name: "Original",
	subject: "Subject",
	from_email: "sender@example.com",
	body: "<p>Hello</p>",
	lists: [{ id: 4, name: "List 4" }],
};

function context(campaign: Partial<CampaignClient["campaign"]>) {
	return { client: { campaign } as CampaignClient };
}

describe("campaign clone operations", () => {
	test("returns the created envelope for an unkeyed clone", async () => {
		const getById = mock(async () => ({ data: source })) as unknown as CampaignClient["campaign"]["getById"];
		const list = mock(async () => ({
			data: { results: [], total: 0 },
		})) as unknown as CampaignClient["campaign"]["list"];
		const create = mock(async () => ({
			data: { id: 21, name: "Copy", status: "draft" },
		})) as unknown as CampaignClient["campaign"]["create"];

		const output = await invokeCloneCampaignOperation(
			context({ getById, list, create }),
			{ id: 11, name: "Copy" },
		);

		expect(output).toMatchObject({
			created: true,
			campaign: { id: 21, name: "Copy", status: "draft" },
		});
	});

	test("replays a keyed clone through the idempotency store", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const getById = mock(async (options: { path: { id: number } }) => ({
			data: options.path.id === 11 ? source : { id: 21, name: "Copy" },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const list = mock(async () => ({
			data: { results: [], total: 0 },
		})) as unknown as CampaignClient["campaign"]["list"];
		const create = mock(async () => ({
			data: { id: 21, name: "Copy" },
		})) as unknown as CampaignClient["campaign"]["create"];
		const ctx = {
			client: {
				campaign: { getById, list, create },
			} as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const first = await invokeCloneCampaignOperation(ctx, {
			id: 11,
			name: "Copy",
			idempotency_key: "clone-key-1",
		});
		expect(first.created).toBe(true);
		expect(first.campaign).toMatchObject({ id: 21 });
		expect(create).toHaveBeenCalledTimes(1);

		const retried = await invokeCloneCampaignOperation(ctx, {
			id: 11,
			name: "Copy",
			idempotency_key: "clone-key-1",
		});
		expect(retried.created).toBe(false);
		expect(retried.campaign).toMatchObject({ id: 21 });
		expect(create).toHaveBeenCalledTimes(1);
		expect(records.get("clone-key-1")).toMatchObject({
			status: "created",
			resourceId: "21",
		});

		// A different request under the same key conflicts.
		await expect(
			invokeCloneCampaignOperation(ctx, {
				id: 11,
				name: "Other",
				idempotency_key: "clone-key-1",
			}),
		).rejects.toThrow(/different create request/);

		// A key without a store is rejected as unsupported.
		await expect(
			invokeCloneCampaignOperation(
				{ client: ctx.client },
				{ id: 11, name: "Copy", idempotency_key: "clone-key-2" },
			),
		).rejects.toThrow(/idempotency store/);

		// A key without a resolved target cannot namespace the record.
		await expect(
			invokeCloneCampaignOperation(
				{ ...ctx, target: undefined },
				{ id: 11, name: "Copy", idempotency_key: "clone-key-3" },
			),
		).rejects.toThrow(/resolved Listmonk target/);
	});

	test("binds an id-less cloned record through its immutable uuid", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const getById = mock(async () => ({ data: source })) as unknown as CampaignClient["campaign"]["getById"];
		const create = mock(async () => ({
			data: { name: "Copy", uuid: "uuid-new" },
		})) as unknown as CampaignClient["campaign"]["create"];
		// The uuid scan lists all campaigns; the same name appears twice but
		// only one carries the clone's uuid.
		const list = mock(async () => ({
			data: {
				results: [
					{ id: 30, name: "Copy", uuid: "uuid-old" },
					{ id: 21, name: "Copy", uuid: "uuid-new" },
				],
				total: 2,
				per_page: 100,
				page: 1,
			},
		})) as unknown as CampaignClient["campaign"]["list"];
		const ctx = {
			client: {
				campaign: { getById, list, create },
			} as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const output = await invokeCloneCampaignOperation(ctx, {
			id: 11,
			name: "Copy",
			idempotency_key: "clone-uuid",
		});

		expect(output).toMatchObject({ created: true, campaign: { id: 21 } });
		expect(records.get("clone-uuid")).toMatchObject({
			status: "created",
			resourceId: "21",
		});
	});

	test("burns the key when a keyed clone cannot be correlated", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const getById = mock(async () => ({ data: source })) as unknown as CampaignClient["campaign"]["getById"];
		const create = mock(async () => ({
			data: undefined,
		})) as unknown as CampaignClient["campaign"]["create"];
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 100, page: 1 },
		})) as unknown as CampaignClient["campaign"]["list"];
		const ctx = {
			client: {
				campaign: { getById, list, create },
			} as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCloneCampaignOperation(ctx, {
				id: 11,
				name: "Copy",
				idempotency_key: "clone-unresolved",
			}),
		).rejects.toThrow(/could not be correlated/);
		expect(records.get("clone-unresolved")?.status).toBe("unknown");
		// The name-snapshot fallback is never consulted for keyed clones.
		expect(list).not.toHaveBeenCalled();
	});

	test("releases the claim when clone preparation fails before any POST", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const getById = mock(async () => ({
			error: { message: "not found" },
			response: { status: 404 },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const create = mock(async () => ({
			data: { id: 21, name: "Copy" },
		})) as unknown as CampaignClient["campaign"]["create"];
		const ctx = {
			client: { campaign: { getById, create } } as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCloneCampaignOperation(ctx, {
				id: 11,
				name: "Copy",
				idempotency_key: "clone-prep-failed",
			}),
		).rejects.toThrow(/Failed to load campaign 11/);
		// No POST was issued, so the key is released for a fresh retry —
		// not burned as unknown.
		expect(create).not.toHaveBeenCalled();
		expect(records.has("clone-prep-failed")).toBe(false);
	});

	test("releases the claim when Listmonk definitively rejects a keyed clone", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const getById = mock(async () => ({ data: source })) as unknown as CampaignClient["campaign"]["getById"];
		const create = mock(async () => ({
			error: { message: "invalid source" },
			response: { status: 400 },
		})) as unknown as CampaignClient["campaign"]["create"];
		const ctx = {
			client: {
				campaign: { getById, create },
			} as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCloneCampaignOperation(ctx, {
				id: 11,
				name: "Copy",
				idempotency_key: "clone-rejected",
			}),
		).rejects.toThrow(/Failed to clone campaign/);
		expect(records.has("clone-rejected")).toBe(false);
	});
});
