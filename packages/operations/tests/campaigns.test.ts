import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import { invokeCreateCampaignOperation } from "../src";
import { createInMemoryResourceCreateStore } from "./helpers/resource-create-store.js";

type CampaignClient = Pick<ListmonkClient, "campaign">;

const baseInput = {
	name: "Launch",
	subject: "Subject",
	from_email: "sender@example.com",
	body: "<p>Hello</p>",
	template_id: 3,
	lists: [4],
};

function context(campaign: Partial<CampaignClient["campaign"]>) {
	return { client: { campaign } as CampaignClient };
}

describe("campaign create operations", () => {
	test("returns the created envelope for an unkeyed create", async () => {
		const create = mock(async () => ({
			data: { id: 21, name: "Launch", status: "draft" },
		})) as unknown as CampaignClient["campaign"]["create"];

		const output = await invokeCreateCampaignOperation(
			context({ create }),
			baseInput,
		);

		expect(output).toMatchObject({
			created: true,
			campaign: { id: 21, name: "Launch", status: "draft" },
		});
	});

	test("replays a keyed create through the idempotency store", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: { id: 21, name: "Launch" },
		})) as unknown as CampaignClient["campaign"]["create"];
		const getById = mock(async () => ({
			data: { id: 21, name: "Launch" },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const ctx = {
			client: { campaign: { create, getById } } as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const first = await invokeCreateCampaignOperation(ctx, {
			...baseInput,
			idempotency_key: "campaign-key-1",
		});
		expect(first.created).toBe(true);
		expect(first.campaign).toMatchObject({ id: 21 });
		expect(create).toHaveBeenCalledTimes(1);

		const retried = await invokeCreateCampaignOperation(ctx, {
			...baseInput,
			idempotency_key: "campaign-key-1",
		});
		expect(retried.created).toBe(false);
		expect(retried.campaign).toMatchObject({ id: 21 });
		expect(create).toHaveBeenCalledTimes(1);
		expect(getById).toHaveBeenCalledWith({ path: { id: 21 } });
		expect(records.get("campaign-key-1")).toMatchObject({
			status: "created",
			resourceId: "21",
		});

		// A different request under the same key conflicts.
		await expect(
			invokeCreateCampaignOperation(ctx, {
				...baseInput,
				name: "Other",
				idempotency_key: "campaign-key-1",
			}),
		).rejects.toThrow(/different create request/);

		// A key without a store is rejected as unsupported.
		await expect(
			invokeCreateCampaignOperation(
				{ client: ctx.client },
				{ ...baseInput, idempotency_key: "campaign-key-2" },
			),
		).rejects.toThrow(/idempotency store/);

		// A key without a resolved target cannot namespace the record.
		await expect(
			invokeCreateCampaignOperation(
				{ ...ctx, target: undefined },
				{ ...baseInput, idempotency_key: "campaign-key-3" },
			),
		).rejects.toThrow(/resolved Listmonk target/);
	});

	test("releases the claim when Listmonk definitively rejects a keyed create", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			error: { message: "invalid template" },
			response: { status: 400 },
		})) as unknown as CampaignClient["campaign"]["create"];
		const ctx = {
			client: { campaign: { create } } as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCreateCampaignOperation(ctx, {
				...baseInput,
				idempotency_key: "campaign-rejected",
			}),
		).rejects.toThrow(/Failed to create campaign/);
		expect(records.has("campaign-rejected")).toBe(false);
	});

	test("burns the key when an accepted create cannot be correlated", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: undefined,
		})) as unknown as CampaignClient["campaign"]["create"];
		const ctx = {
			client: { campaign: { create } } as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCreateCampaignOperation(ctx, {
				...baseInput,
				idempotency_key: "campaign-unresolved",
			}),
		).rejects.toThrow(/could not be correlated/);
		expect(records.get("campaign-unresolved")?.status).toBe("unknown");
	});

	test("binds an id-less created campaign through its immutable uuid", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: { name: "Launch", uuid: "uuid-new" },
		})) as unknown as CampaignClient["campaign"]["create"];
		const list = mock(async () => ({
			data: {
				results: [
					{ id: 20, name: "Launch", uuid: "uuid-old" },
					{ id: 21, name: "Launch", uuid: "uuid-new" },
				],
				total: 2,
				per_page: 100,
				page: 1,
			},
		})) as unknown as CampaignClient["campaign"]["list"];
		const ctx = {
			client: { campaign: { create, list } } as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const output = await invokeCreateCampaignOperation(ctx, {
			...baseInput,
			idempotency_key: "campaign-uuid",
		});

		expect(output).toMatchObject({ created: true, campaign: { id: 21 } });
		expect(records.get("campaign-uuid")).toMatchObject({
			status: "created",
			resourceId: "21",
		});
	});

	test("replays a keyed retry whose nested objects merely reorder keys", async () => {
		const { store } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: { id: 41, name: "Launch" },
		})) as unknown as CampaignClient["campaign"]["create"];
		const getById = mock(async () => ({
			data: { id: 41, name: "Launch" },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const ctx = {
			client: { campaign: { create, getById } } as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const first = await invokeCreateCampaignOperation(ctx, {
			...baseInput,
			headers: [{ "X-A": "1", "X-B": "2" }],
			attribs: { theme: "dark", locale: "ko" },
			idempotency_key: "campaign-reorder",
		});
		expect(first.created).toBe(true);

		// Same request, same nested values, different insertion order: the
		// canonical hash must not treat it as a different create.
		const retried = await invokeCreateCampaignOperation(ctx, {
			...baseInput,
			headers: [{ "X-B": "2", "X-A": "1" }],
			attribs: { locale: "ko", theme: "dark" },
			idempotency_key: "campaign-reorder",
		});
		expect(retried.created).toBe(false);
		expect(retried.campaign).toMatchObject({ id: 41 });
		expect(create).toHaveBeenCalledTimes(1);
	});

	test("serializes concurrent keyed creates into one POST and one replay", async () => {
		const { store } = createInMemoryResourceCreateStore();
		const create = mock(async () => {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
			return { data: { id: 31, name: "Launch" } };
		}) as unknown as CampaignClient["campaign"]["create"];
		const getById = mock(async () => ({
			data: { id: 31, name: "Launch" },
		})) as unknown as CampaignClient["campaign"]["getById"];
		const ctx = {
			client: { campaign: { create, getById } } as unknown as CampaignClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const [first, second] = await Promise.all([
			invokeCreateCampaignOperation(ctx, {
				...baseInput,
				idempotency_key: "campaign-concurrent",
			}),
			invokeCreateCampaignOperation(ctx, {
				...baseInput,
				idempotency_key: "campaign-concurrent",
			}),
		]);

		expect(create).toHaveBeenCalledTimes(1);
		const outcomes = [first, second].sort((a, b) =>
			a.created === b.created ? 0 : a.created ? 1 : -1,
		);
		expect(outcomes[0]).toMatchObject({
			created: false,
			campaign: { id: 31 },
		});
		expect(outcomes[1]).toMatchObject({
			created: true,
			campaign: { id: 31 },
		});
	});
});
