import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	createListOperation,
	deleteListOperation,
	getListOperation,
	getListOperationByMcpName,
	getListsOperation,
	listOperations,
	OperationExecutionError,
	OperationInputError,
	updateListOperation,
} from "../src";

type ListClient = Pick<ListmonkClient, "list">;

function context(list: Partial<ListClient["list"]>) {
	return { client: { list } as ListClient };
}

describe("subscriber-list operations", () => {
	test("normalizes paginated list output", async () => {
		const list = mock(async () => ({
			data: { results: [{ id: 7, name: "News" }] },
		})) as unknown as ListClient["list"]["list"];

		const output = await getListsOperation.invoke(context({ list }), {});

		expect(list).toHaveBeenCalledWith({ query: { page: 1, per_page: 20 } });
		expect(output).toEqual({
			results: [{ id: 7, name: "News" }],
			total: 0,
			per_page: 20,
			page: 1,
		});
	});

	test("forwards documented numeric page sizes without a local cap", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, page: 1, per_page: 5000 },
		})) as unknown as ListClient["list"]["list"];

		await expect(
			getListsOperation.invoke(context({ list }), { per_page: 5000 }),
		).resolves.toMatchObject({ per_page: 5000 });
		expect(list).toHaveBeenCalledWith({ query: { page: 1, per_page: 5000 } });
	});

	test("coerces IDs before get, update, and delete calls", async () => {
		const getById = mock(async () => ({ data: { id: 7, name: "News" } }));
		const update = mock(async () => ({ data: { id: 7, name: "Updates" } }));
		const remove = mock(async () => ({ data: true }));
		const clientContext = context({
			getById: getById as unknown as ListClient["list"]["getById"],
			update: update as unknown as ListClient["list"]["update"],
			delete: remove as unknown as ListClient["list"]["delete"],
		});

		await expect(
			getListOperation.invoke(clientContext, { id: "7" }),
		).resolves.toMatchObject({ id: 7 });
		await expect(
			updateListOperation.invoke(clientContext, { id: "7", name: "Updates" }),
		).resolves.toMatchObject({ name: "Updates" });
		await expect(
			deleteListOperation.invoke(clientContext, { id: "7" }),
		).resolves.toEqual({ id: 7, deleted: true });

		expect(getById).toHaveBeenCalledWith({ path: { list_id: 7 } });
		expect(update).toHaveBeenCalledWith({
			path: { list_id: 7 },
			body: { name: "Updates" },
		});
		expect(remove).toHaveBeenCalledWith({ path: { list_id: 7 } });
	});

	test("resolves a create response whose body is empty", async () => {
		const create = mock(async () => ({ data: undefined }));
		const list = mock(async () => ({
			data: {
				results: [{ id: 9, name: "Created" }],
				total: 1,
				page: 1,
				per_page: 100,
			},
		}));

		const output = await createListOperation.invoke(
			context({
				create: create as unknown as ListClient["list"]["create"],
				list: list as unknown as ListClient["list"]["list"],
			}),
			{ name: "Created" },
		);

		expect(output).toMatchObject({ id: 9, name: "Created" });
		expect(create).toHaveBeenCalledWith({
			body: {
				name: "Created",
				type: "private",
				optin: "single",
				description: "",
				tags: [],
			},
		});
		expect(list).toHaveBeenCalledWith({
			query: { page: 1, per_page: 100, query: "Created" },
		});
	});

	test("searches every result page when resolving an empty create response", async () => {
		const create = mock(async () => ({ data: undefined }));
		const list = mock(async (options: { query: { page: number } }) => ({
			data: {
				results:
					options.query.page === 2 ? [{ id: 109, name: "Created" }] : [],
				total: 250,
				page: options.query.page,
				per_page: 100,
			},
		}));

		const output = await createListOperation.invoke(
			context({
				create: create as unknown as ListClient["list"]["create"],
				list: list as unknown as ListClient["list"]["list"],
			}),
			{ name: "Created" },
		);

		expect(output).toMatchObject({ id: 109 });
		expect(list).toHaveBeenCalledTimes(2);
		expect(list).toHaveBeenNthCalledWith(2, {
			query: { page: 2, per_page: 100, query: "Created" },
		});
	});

	test("does not turn an update API error into success", async () => {
		const update = mock(async () => ({ error: { error: "conflict" } }));

		const invocation = updateListOperation.invoke(
			context({
				update: update as unknown as ListClient["list"]["update"],
			}),
			{ id: 3, name: "Duplicate" },
		);

		await expect(invocation).rejects.toEqual(
			expect.objectContaining<Partial<OperationExecutionError>>({
				name: "OperationExecutionError",
				operationId: "lists.update",
				message: "Failed to update list: conflict",
			}),
		);
	});

	test("exposes JSON schemas and safety metadata through the registry", () => {
		expect(listOperations).toHaveLength(5);
		expect(getListsOperation.inputJsonSchema.type).toBe("object");
		expect(getListsOperation.inputJsonSchema.required).toBeUndefined();
		expect(getListsOperation.outputJsonSchema.type).toBe("object");
		expect(createListOperation.inputJsonSchema.required).toEqual(["name"]);
		expect(getListOperation.inputJsonSchema.properties?.id).toMatchObject({
			anyOf: [{ type: "integer" }, { type: "string" }],
		});
		expect(getListOperation.safety.readOnlyHint).toBe(true);
		expect(deleteListOperation.safety.destructiveHint).toBe(true);
		expect(
			getListOperationByMcpName("listmonk_update_list"),
		).toBe(updateListOperation);
	});

	test("reports a missing required top-level parameter consistently", async () => {
		await expect(
			getListOperation.invoke(context({}), {}),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
				message: "Missing required parameter: id",
			}),
		);
	});
});
