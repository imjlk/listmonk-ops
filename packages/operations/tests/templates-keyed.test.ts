import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import { invokeCreateTemplateOperation } from "../src";
import { createInMemoryResourceCreateStore } from "./helpers/resource-create-store.js";

type TemplateClient = Pick<ListmonkClient, "template">;

const baseInput = {
	name: "Welcome",
	body: "<p>Hello {{ .Subscriber.Name }}</p>",
};

function context(template: Partial<TemplateClient["template"]>) {
	return { client: { template } as TemplateClient };
}

describe("template create operations", () => {
	test("returns the created envelope for an unkeyed create", async () => {
		const create = mock(async () => ({
			data: { id: 12, name: "Welcome" },
		})) as unknown as TemplateClient["template"]["create"];

		const output = await invokeCreateTemplateOperation(
			context({ create }),
			baseInput,
		);

		expect(output).toMatchObject({
			created: true,
			template: { id: 12, name: "Welcome" },
		});
	});

	test("replays a keyed create through the idempotency store", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: { id: 12, name: "Welcome" },
		})) as unknown as TemplateClient["template"]["create"];
		const getById = mock(async () => ({
			data: { id: 12, name: "Welcome" },
		})) as unknown as TemplateClient["template"]["getById"];
		const ctx = {
			client: { template: { create, getById } } as unknown as TemplateClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const first = await invokeCreateTemplateOperation(ctx, {
			...baseInput,
			idempotency_key: "template-key-1",
		});
		expect(first.created).toBe(true);
		expect(first.template).toMatchObject({ id: 12 });
		expect(create).toHaveBeenCalledTimes(1);

		const retried = await invokeCreateTemplateOperation(ctx, {
			...baseInput,
			idempotency_key: "template-key-1",
		});
		expect(retried.created).toBe(false);
		expect(retried.template).toMatchObject({ id: 12 });
		expect(create).toHaveBeenCalledTimes(1);
		expect(getById).toHaveBeenCalledWith({ path: { id: 12 } });
		expect(records.get("template-key-1")).toMatchObject({
			status: "created",
			resourceId: "12",
		});

		// A different request under the same key conflicts.
		await expect(
			invokeCreateTemplateOperation(ctx, {
				...baseInput,
				name: "Other",
				idempotency_key: "template-key-1",
			}),
		).rejects.toThrow(/different create request/);

		// A key without a store is rejected as unsupported.
		await expect(
			invokeCreateTemplateOperation(
				{ client: ctx.client },
				{ ...baseInput, idempotency_key: "template-key-2" },
			),
		).rejects.toThrow(/idempotency store/);

		// A key without a resolved target cannot namespace the record.
		await expect(
			invokeCreateTemplateOperation(
				{ ...ctx, target: undefined },
				{ ...baseInput, idempotency_key: "template-key-3" },
			),
		).rejects.toThrow(/resolved Listmonk target/);
	});

	test("releases the claim when Listmonk definitively rejects a keyed create", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			error: { message: "invalid body" },
			response: { status: 400 },
		})) as unknown as TemplateClient["template"]["create"];
		const ctx = {
			client: { template: { create } } as unknown as TemplateClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCreateTemplateOperation(ctx, {
				...baseInput,
				idempotency_key: "template-rejected",
			}),
		).rejects.toThrow(/Failed to create template/);
		expect(records.has("template-rejected")).toBe(false);
	});

	test("burns the key when an accepted create returns no id", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		// Template records carry no uuid: an id-less response cannot be
		// correlated and must never fall back to a name match.
		const create = mock(async () => ({
			data: { name: "Welcome" },
		})) as unknown as TemplateClient["template"]["create"];
		const list = mock(async () => ({
			data: { results: [{ id: 12, name: "Welcome" }], total: 1 },
		})) as unknown as TemplateClient["template"]["list"];
		const ctx = {
			client: { template: { create, list } } as unknown as TemplateClient,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCreateTemplateOperation(ctx, {
				...baseInput,
				idempotency_key: "template-unresolved",
			}),
		).rejects.toThrow(/could not be correlated/);
		expect(records.get("template-unresolved")?.status).toBe("unknown");
		// The name search is never consulted for binding.
		expect(list).not.toHaveBeenCalled();
	});
});

describe("template reconcile manifest", () => {
	test("rejects an idempotency key inside a manifest entry", async () => {
		const { invokeReconcileTemplateManifestOperation } = await import(
			"../src"
		);
		await expect(
			invokeReconcileTemplateManifestOperation(undefined as never, {
				schema_version: 1,
				templates: [
					{
						name: "Manifest",
						body: "<p>Hello</p>",
						idempotency_key: "manifest-key",
					},
				],
			}),
		).rejects.toThrow();
	});
});
