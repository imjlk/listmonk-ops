import type {
	ResourceCreateIdempotencyStore,
	StoredResourceCreateRecord,
} from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	createListOperation,
	deleteListOperation,
	getListOperation,
	getListOperationByMcpName,
	getListsOperation,
	invokeCreateListOperation,
	invokeDeleteListOperation,
	invokeGetListOperation,
	invokeGetListsOperation,
	invokeListOperationByMcpName,
	invokeUpdateListOperation,
	listOperations,
	OperationExecutionError,
	OperationInputError,
	updateListOperation,
} from "../src";

type ListClient = Pick<ListmonkClient, "list">;

function context(list: Partial<ListClient["list"]>) {
	return { client: { list } as ListClient };
}

/**
 * In-memory mirror of the file-backed claim/commit/release semantics with a
 * promise-chain mutex so concurrent claims serialize like the real store.
 * Owner liveness is not modeled: a pending claim never goes stale here.
 */
function createInMemoryResourceCreateStore() {
	const records = new Map<string, StoredResourceCreateRecord>();
	let chain: Promise<unknown> = Promise.resolve();
	function serialized<Result>(action: () => Result): Promise<Result> {
		const run = chain.then(action, action);
		chain = run.then(
			() => undefined,
			() => undefined,
		);
		return run;
	}
	const store: ResourceCreateIdempotencyStore = {
		claim: (options) =>
			serialized(() => {
				const existing = records.get(options.key);
				if (existing !== undefined) {
					if (
						existing.payloadHash !== options.payloadHash ||
						existing.targetHash !== options.targetHash ||
						existing.resourceKind !== options.resourceKind
					) {
						const reason =
							existing.targetHash !== options.targetHash
								? ("target" as const)
								: existing.payloadHash !== options.payloadHash
									? ("payload" as const)
									: ("resourceKind" as const);
						return { kind: "conflict" as const, reason, existing };
					}
					if (existing.status === "created") {
						return { kind: "replay" as const, record: existing };
					}
					return { kind: "pending" as const, record: existing };
				}
				const now = new Date().toISOString();
				const record: StoredResourceCreateRecord = {
					key: options.key,
					payloadHash: options.payloadHash,
					targetHash: options.targetHash,
					resourceKind: options.resourceKind,
					status: "pending",
					claimToken: `token-${records.size + 1}-${Math.random()}`,
					owner: { pid: process.pid, hostname: "test" },
					createdAt: now,
					updatedAt: now,
				};
				records.set(options.key, record);
				return {
					kind: "new" as const,
					claimToken: record.claimToken,
					record,
					recovered: false,
				};
			}),
		commit: (options) =>
			serialized(() => {
				const existing = records.get(options.key);
				if (
					existing !== undefined &&
					existing.claimToken === options.claimToken &&
					existing.status === "pending"
				) {
					records.set(options.key, {
						...existing,
						status: "created",
						resourceId: options.resourceId,
						updatedAt: new Date().toISOString(),
					});
				}
			}),
		release: (options) =>
			serialized(() => {
				const existing = records.get(options.key);
				if (
					existing !== undefined &&
					existing.claimToken === options.claimToken &&
					existing.status === "pending"
				) {
					records.delete(options.key);
				}
			}),
	};
	return { store, records };
}

describe("subscriber-list operations", () => {
	test("normalizes paginated list output", async () => {
		const list = mock(async () => ({
			data: { results: [{ id: 7, name: "News" }] },
		})) as unknown as ListClient["list"]["list"];

		const output = await invokeGetListsOperation(context({ list }), {});

		expect(list).toHaveBeenCalledWith({ query: { page: 1, per_page: 20 } });
		expect(output).toEqual({
			results: [{ id: 7, name: "News" }],
			total: 0,
			per_page: 20,
			page: 1,
		});
	});

	test("keeps the generic invoke API compatible", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 20, page: 1 },
		})) as unknown as ListClient["list"]["list"];

		await expect(
			getListsOperation.invoke(context({ list }), {}),
		).resolves.toEqual({ results: [], total: 0, per_page: 20, page: 1 });
	});

	test("forwards documented numeric page sizes without a local cap", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, page: 1, per_page: 5000 },
		})) as unknown as ListClient["list"]["list"];

		await expect(
			invokeGetListsOperation(context({ list }), { per_page: 5000 }),
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
			invokeGetListOperation(clientContext, { id: "7" }),
		).resolves.toMatchObject({ id: 7 });
		await expect(
			invokeUpdateListOperation(clientContext, {
				id: "7",
				name: "Updates",
			}),
		).resolves.toMatchObject({ name: "Updates" });
		await expect(
			invokeDeleteListOperation(clientContext, { id: "7" }),
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

		const output = await invokeCreateListOperation(
			context({
				create: create as unknown as ListClient["list"]["create"],
				list: list as unknown as ListClient["list"]["list"],
			}),
			{ name: "Created" },
		);

		expect(output).toMatchObject({
			created: true,
			list: { id: 9, name: "Created" },
		});
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

		const output = await invokeCreateListOperation(
			context({
				create: create as unknown as ListClient["list"]["create"],
				list: list as unknown as ListClient["list"]["list"],
			}),
			{ name: "Created" },
		);

		expect(output).toMatchObject({ created: true, list: { id: 109 } });
		expect(list).toHaveBeenCalledTimes(2);
		expect(list).toHaveBeenNthCalledWith(2, {
			query: { page: 2, per_page: 100, query: "Created" },
		});
	});
	test("replays a keyed create through the idempotency store", async () => {
		const { store } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: { id: 31, name: "Keyed" },
		})) as unknown as ListClient["list"]["create"];
		const getById = mock(async () => ({
			data: { id: 31, name: "Keyed" },
		})) as unknown as ListClient["list"]["getById"];
		const hash = (value: string) => `hash:${value.length}:${value}`;
		const ctx = {
			client: { list: { create, getById } } as unknown as Pick<
				ListmonkClient,
				"list"
			>,
			createIdempotencyStore: store,
			hashCreatePayload: hash,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const first = await invokeCreateListOperation(ctx, {
			name: "Keyed",
			idempotency_key: "list-key-1",
		});
		expect(first.created).toBe(true);
		expect(first.list).toMatchObject({ id: 31 });
		expect(create).toHaveBeenCalledTimes(1);

		// The identical retry replays the bound list without creating.
		const retried = await invokeCreateListOperation(ctx, {
			name: "Keyed",
			idempotency_key: "list-key-1",
		});
		expect(retried.created).toBe(false);
		expect(retried.list).toMatchObject({ id: 31 });
		expect(create).toHaveBeenCalledTimes(1);
		expect(getById).toHaveBeenCalledWith({ path: { list_id: 31 } });

		// A different request under the same key conflicts.
		await expect(
			invokeCreateListOperation(ctx, {
				name: "Other",
				idempotency_key: "list-key-1",
			}),
		).rejects.toThrow(/different create request/);

		// A key without a store is rejected as unsupported.
		await expect(
			invokeCreateListOperation(
				{ client: ctx.client },
				{ name: "Keyed", idempotency_key: "list-key-2" },
			),
		).rejects.toThrow(/idempotency store/);

		// A key without a resolved target cannot namespace the record.
		await expect(
			invokeCreateListOperation(
				{ ...ctx, target: undefined },
				{ name: "Keyed", idempotency_key: "list-key-3" },
			),
		).rejects.toThrow(/resolved Listmonk target/);
	});

	test("preserves the original failure when a replay cannot load the bound list", async () => {
		const { store } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: { id: 31, name: "Keyed" },
		})) as unknown as ListClient["list"]["create"];
		const getById = mock(async () => ({
			data: { id: 31, name: "Keyed" },
		})) as unknown as ListClient["list"]["getById"];
		const hash = (value: string) => `hash:${value}`;
		const ctx = {
			client: { list: { create, getById } } as unknown as Pick<
				ListmonkClient,
				"list"
			>,
			createIdempotencyStore: store,
			hashCreatePayload: hash,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		// Bind the key while the API is healthy.
		await invokeCreateListOperation(ctx, {
			name: "Keyed",
			idempotency_key: "list-key-1",
		});

		// A transient read failure must surface as itself, not as a claim
		// that the recorded list was deleted.
		getById.mockImplementation(async () => {
			throw new Error("transient outage");
		});
		let replayError: unknown;
		try {
			await invokeCreateListOperation(ctx, {
				name: "Keyed",
				idempotency_key: "list-key-1",
			});
		} catch (error) {
			replayError = error;
		}
		expect(replayError).toBeInstanceOf(Error);
		expect((replayError as Error).message).toContain("could not load list 31");
		// normalizeOperationExecutionError wraps the replay error once; the
		// original read failure must survive one level deeper as its cause.
		const replayFailure = (replayError as Error).cause as Error;
		expect(replayFailure.message).toContain("could not load list 31");
		expect(replayFailure.cause).toBeInstanceOf(Error);
		expect((replayFailure.cause as Error).message).toBe("transient outage");
	});

	test("serializes concurrent keyed creates into one POST and one replay", async () => {
		const { store } = createInMemoryResourceCreateStore();
		const create = mock(async () => {
			await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
			return { data: { id: 41, name: "Keyed" } };
		}) as unknown as ListClient["list"]["create"];
		const getById = mock(async () => ({
			data: { id: 41, name: "Keyed" },
		})) as unknown as ListClient["list"]["getById"];
		const ctx = {
			client: { list: { create, getById } } as unknown as Pick<
				ListmonkClient,
				"list"
			>,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const [first, second] = await Promise.all([
			invokeCreateListOperation(ctx, {
				name: "Keyed",
				idempotency_key: "list-concurrent",
			}),
			invokeCreateListOperation(ctx, {
				name: "Keyed",
				idempotency_key: "list-concurrent",
			}),
		]);

		expect(create).toHaveBeenCalledTimes(1);
		const outcomes = [first, second].sort((a, b) =>
			a.created === b.created ? 0 : a.created ? 1 : -1,
		);
		expect(outcomes[0]).toMatchObject({ created: false, list: { id: 41 } });
		expect(outcomes[1]).toMatchObject({ created: true, list: { id: 41 } });
	});

	test("keeps the claim pending when a keyed create cannot resolve an id", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		const create = mock(async () => ({
			data: { name: "Unresolved" },
		})) as unknown as ListClient["list"]["create"];
		const list = mock(async () => ({
			data: { results: [], total: 0, page: 1, per_page: 100 },
		})) as unknown as ListClient["list"]["list"];
		const ctx = {
			client: { list: { create, list } } as unknown as Pick<
				ListmonkClient,
				"list"
			>,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCreateListOperation(ctx, {
				name: "Unresolved",
				idempotency_key: "list-unresolved",
			}),
		).rejects.toThrow(/could not be resolved/);
		// The pending claim survives so a retry reconciles instead of
		// issuing a second POST under the same key.
		expect(records.get("list-unresolved")?.status).toBe("pending");
	});

	test("keeps the claim pending when a read-back fails after an accepted create", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		// The POST is accepted but returns an empty body; the subsequent
		// name read-back dies with a connection error that would look
		// pre-dispatch in isolation. The claim must not be released.
		const create = mock(async () => ({
			data: undefined,
		})) as unknown as ListClient["list"]["create"];
		const list = mock(async () => {
			const error = new Error("fetch failed") as NodeJS.ErrnoException;
			error.code = "ECONNREFUSED";
			throw error;
		}) as unknown as ListClient["list"]["list"];
		const ctx = {
			client: { list: { create, list } } as unknown as Pick<
				ListmonkClient,
				"list"
			>,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCreateListOperation(ctx, {
				name: "Accepted",
				idempotency_key: "list-readback",
			}),
		).rejects.toThrow(
			/accepted but the created record could not be resolved/,
		);
		expect(records.get("list-readback")?.status).toBe("pending");
	});

	test("refuses to bind a key when an empty-body create matches two same-named lists", async () => {
		const { store, records } = createInMemoryResourceCreateStore();
		// Listmonk names are not unique: with a pre-existing same-named
		// list, the empty-body read-back cannot tell which list the create
		// produced and must not bind the key to either.
		const create = mock(async () => ({
			data: undefined,
		})) as unknown as ListClient["list"]["create"];
		const list = mock(async () => ({
			data: {
				results: [
					{ id: 71, name: "Duplicated" },
					{ id: 72, name: "Duplicated" },
				],
				total: 2,
				page: 1,
				per_page: 100,
			},
		})) as unknown as ListClient["list"]["list"];
		const ctx = {
			client: { list: { create, list } } as unknown as Pick<
				ListmonkClient,
				"list"
			>,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		await expect(
			invokeCreateListOperation(ctx, {
				name: "Duplicated",
				idempotency_key: "list-duplicated",
			}),
		).rejects.toThrow(/multiple lists named "Duplicated"/);
		expect(records.get("list-duplicated")?.status).toBe("pending");
	});

	test("recovers a stale claim by adopting a uniquely named list", async () => {
		const commits: Array<{ key: string; claimToken: string; resourceId: string }> =
			[];
		let recoverOnce = true;
		const store = {
			claim: async () => {
				if (recoverOnce) {
					recoverOnce = false;
					return {
						kind: "new" as const,
						claimToken: "token-recovered",
						record: {} as never,
						recovered: true,
					};
				}
				return { kind: "replay" as const, record: {} as never };
			},
			commit: async (options: { key: string; claimToken: string; resourceId: string }) => {
				commits.push(options);
			},
			release: async () => {},
		};
		const create = mock(async () => ({
			data: { id: 99, name: "Recovered" },
		})) as unknown as ListClient["list"]["create"];
		const list = mock(async () => ({
			data: { results: [{ id: 55, name: "Recovered" }], total: 1, page: 1, per_page: 100 },
		})) as unknown as ListClient["list"]["list"];
		const ctx = {
			client: { list: { create, list } } as unknown as Pick<
				ListmonkClient,
				"list"
			>,
			createIdempotencyStore: store,
			hashCreatePayload: (value: string) => `hash:${value}`,
			target: { baseUrl: "https://listmonk.example", username: "admin" },
		};

		const result = await invokeCreateListOperation(ctx, {
			name: "Recovered",
			idempotency_key: "list-recovered",
		});

		expect(result).toMatchObject({ created: false, list: { id: 55 } });
		expect(create).not.toHaveBeenCalled();
		expect(commits).toEqual([
			{ key: "list-recovered", claimToken: "token-recovered", resourceId: "55" },
		]);
	});

	test("does not turn an update API error into success", async () => {
		const update = mock(async () => ({ error: { error: "conflict" } }));

		const invocation = invokeUpdateListOperation(
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

	test("rejects empty list updates before calling the API", async () => {
		const update = mock(async () => ({
			data: { id: 3, name: "Unchanged" },
		}));

		await expect(
			invokeUpdateListOperation(
				context({
					update: update as unknown as ListClient["list"]["update"],
				}),
				{ id: 3 },
			),
		).rejects.toThrow("At least one list field must be provided for update");
		expect(update).not.toHaveBeenCalled();

		await expect(
			invokeUpdateListOperation(
				context({
					update: update as unknown as ListClient["list"]["update"],
				}),
				{
					id: 3,
					name: undefined,
					type: undefined,
					optin: undefined,
					description: undefined,
					tags: undefined,
				},
			),
		).rejects.toThrow("At least one list field must be provided for update");
		expect(update).not.toHaveBeenCalled();
	});

	test("dispatches MCP names through named operation invokers", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 20, page: 1 },
		})) as unknown as ListClient["list"]["list"];

		const invocation = await invokeListOperationByMcpName(
			context({ list }),
			"listmonk_get_lists",
			{},
		);

		expect(invocation?.operation).toBe(getListsOperation);
		expect(invocation?.output).toEqual({
			results: [],
			total: 0,
			per_page: 20,
			page: 1,
		});
		await expect(
			invokeListOperationByMcpName(
				context({}),
				"listmonk_unknown_list_tool",
				{},
			),
		).resolves.toBeUndefined();
	});

	test("keeps every registered MCP list operation dispatchable", async () => {
		for (const operation of listOperations) {
			const outcome = await invokeListOperationByMcpName(
				context({}),
				operation.mcp.name,
				{},
			).then(
				(value) => ({ status: "fulfilled" as const, value }),
				(error: unknown) => ({ status: "rejected" as const, error }),
			);

			if (outcome.status === "fulfilled") {
				expect(outcome.value).toBeDefined();
			} else {
				expect(outcome.error).toBeInstanceOf(Error);
			}
		}
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
			invokeGetListOperation(context({}), {}),
		).rejects.toEqual(
			expect.objectContaining<Partial<OperationInputError>>({
				name: "OperationInputError",
				message: "Missing required parameter: id",
			}),
		);
	});
});
