import type { ListmonkClient } from "@listmonk-ops/openapi";
import { OperationExecutionError } from "@listmonk-ops/operations";
import { describe, expect, mock, test } from "bun:test";
import {
	createListCommandError,
	renderCreateSubscriberList,
	renderDeleteSubscriberList,
	renderSubscriberList,
	renderSubscriberLists,
	renderUpdateSubscriberList,
	parseListTags,
	type ListsCliContext,
} from "../src/commands/lists";

type ListClient = Pick<ListmonkClient, "list">;

function context(list: Partial<ListClient["list"]>) {
	return {
		client: { list } as ListClient,
		output: {
			info: mock(() => undefined),
			json: mock(() => undefined),
			success: mock(() => undefined),
			table: mock(() => undefined),
		},
	} satisfies ListsCliContext;
}

describe("lists CLI actions", () => {
	test("parses an explicit empty tag list for clearing tags", () => {
		expect(parseListTags(undefined)).toBeUndefined();
		expect(parseListTags("")).toEqual([]);
		expect(parseListTags(",")).toEqual([]);
		expect(parseListTags("product, ,weekly")).toEqual([
			"product",
			"weekly",
		]);
	});

	test("does not duplicate operation error context", () => {
		const operationError = new OperationExecutionError(
			"lists.get",
			new Error("Failed to fetch list: not found"),
		);
		expect(
			createListCommandError("Failed to get list", operationError),
		).toBe(operationError);

		const authenticationError = new Error("Missing LISTMONK_API_TOKEN");
		const commandError = createListCommandError(
			"Failed to get list",
			authenticationError,
		);
		expect(commandError.message).toBe(
			"Failed to get list: Missing LISTMONK_API_TOKEN",
		);
		expect(commandError.cause).toBe(authenticationError);
	});

	test("renders a paginated list through the shared operation", async () => {
		const list = mock(async () => ({
			data: {
				results: [{ id: 4, name: "News" }],
				total: 1,
				page: 2,
				per_page: 5,
			},
		})) as unknown as ListClient["list"]["list"];
		const cliContext = context({ list });

		await renderSubscriberLists(cliContext, { page: 2, per_page: 5 });

		expect(list).toHaveBeenCalledWith({ query: { page: 2, per_page: 5 } });
		expect(cliContext.output.table).toHaveBeenCalledWith([
			{ id: 4, name: "News" },
		]);
		expect(cliContext.output.info).not.toHaveBeenCalled();
	});

	test("renders the empty-list message", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, page: 1, per_page: 20 },
		})) as unknown as ListClient["list"]["list"];
		const cliContext = context({ list });

		await renderSubscriberLists(cliContext, {});

		expect(cliContext.output.info).toHaveBeenCalledWith("No lists found");
		expect(cliContext.output.table).not.toHaveBeenCalled();
	});

	test("renders one list through the shared operation", async () => {
		const getById = mock(async () => ({
			data: { id: 8, name: "Updates" },
		})) as unknown as ListClient["list"]["getById"];
		const cliContext = context({ getById });

		await renderSubscriberList(cliContext, { id: 8 });

		expect(getById).toHaveBeenCalledWith({ path: { list_id: 8 } });
		expect(cliContext.output.json).toHaveBeenCalledWith({
			id: 8,
			name: "Updates",
		});
	});

	test("surfaces API errors instead of rendering empty data", async () => {
		const getById = mock(async () => ({
			error: new Error("not found"),
		})) as unknown as ListClient["list"]["getById"];
		const cliContext = context({ getById });

		await expect(
			renderSubscriberList(cliContext, { id: 404 }),
		).rejects.toThrow("Failed to fetch list: not found");
		expect(cliContext.output.json).not.toHaveBeenCalled();
	});

	test("creates a list through the shared operation", async () => {
		const create = mock(async () => ({
			data: { id: 12, name: "Product" },
		})) as unknown as ListClient["list"]["create"];
		const cliContext = context({ create });

		await renderCreateSubscriberList(cliContext, {
			name: "Product",
			type: "public",
			tags: ["product", "weekly"],
		});

		expect(create).toHaveBeenCalledWith({
			body: {
				name: "Product",
				type: "public",
				optin: "single",
				description: "",
				tags: ["product", "weekly"],
			},
		});
		expect(cliContext.output.success).toHaveBeenCalledWith("List created: 12");
		expect(cliContext.output.json).toHaveBeenCalledWith({
			id: 12,
			name: "Product",
		});
	});

	test("updates a list through the shared operation", async () => {
		const update = mock(async () => ({
			data: { id: 12, name: "Product updates" },
		})) as unknown as ListClient["list"]["update"];
		const cliContext = context({ update });

		await renderUpdateSubscriberList(cliContext, {
			id: 12,
			name: "Product updates",
			tags: ["product"],
		});

		expect(update).toHaveBeenCalledWith({
			path: { list_id: 12 },
			body: { name: "Product updates", tags: ["product"] },
		});
		expect(cliContext.output.success).toHaveBeenCalledWith("List updated: 12");
	});

	test("requires at least one field for list updates", async () => {
		const update = mock(async () => ({
			data: { id: 12, name: "Unchanged" },
		}));
		const cliContext = context({
			update: update as unknown as ListClient["list"]["update"],
		});

		await expect(
			renderUpdateSubscriberList(cliContext, { id: 12 }),
		).rejects.toThrow("At least one list field must be provided");
		expect(update).not.toHaveBeenCalled();

		await expect(
			renderUpdateSubscriberList(cliContext, {
			id: 12,
			name: undefined,
			type: undefined,
			optin: undefined,
			description: undefined,
			tags: undefined,
			}),
		).rejects.toThrow("At least one list field must be provided");
		expect(update).not.toHaveBeenCalled();
	});

	test("deletes a list through the shared operation", async () => {
		const remove = mock(async () => ({
			data: true,
		})) as unknown as ListClient["list"]["delete"];
		const cliContext = context({ delete: remove });

		await renderDeleteSubscriberList(cliContext, { id: 12 });

		expect(remove).toHaveBeenCalledWith({ path: { list_id: 12 } });
		expect(cliContext.output.success).toHaveBeenCalledWith("List deleted: 12");
		expect(cliContext.output.json).toHaveBeenCalledWith({
			id: 12,
			deleted: true,
		});
	});
});
