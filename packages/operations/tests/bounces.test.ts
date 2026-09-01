import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	bouncesOperations,
	bouncesOperationCatalog,
	getBounce,
	getBouncesOperationByMcpName,
	invokeBouncesOperationByMcpName,
	invokeDeleteBounceOperation,
	invokeGetBounceOperation,
	invokeListBouncesOperation,
	invokePruneBouncesOperation,
} from "../src/bounces";
import { OperationExecutionError } from "../src/operation";
import {
	isResourceMissingError,
	ResourceResponseError,
} from "../src/resource-helpers";

type BounceClient = Pick<ListmonkClient, "bounce">;

function bounceContext(methods: Partial<BounceClient["bounce"]>): {
	client: BounceClient;
} {
	return { client: { bounce: methods } as BounceClient };
}

const bounceRecord = {
	id: 1,
	type: "hard",
	source: "api",
	meta: { reason: "550 mailbox unavailable" },
	created_at: "2026-08-31T23:28:53.63484Z",
	email: "reader@example.com",
	subscriber_uuid: "9971bfc7-7a32-444b-9e00-099924ea31f0",
	subscriber_id: 663,
	subscriber_status: "enabled",
	campaign: { id: 1, name: "Test campaign" },
};

describe("shared bounce operations", () => {
	test("exposes a registry with per-operation safety metadata", () => {
		expect(bouncesOperations).toHaveLength(4);
		for (const operation of bouncesOperations) {
			expect(operation.inputJsonSchema.type).toBe("object");
			expect(operation.outputJsonSchema.type).toBe("object");
		}
		expect(bouncesOperations[0]?.safety).toEqual({
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: true,
		});
		expect(bouncesOperations[2]?.safety).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: true,
		});
		expect(bouncesOperations[3]?.safety).toEqual({
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
			openWorldHint: true,
		});
		expect(bouncesOperationCatalog.id).toBe("bounces");
		expect(
			getBouncesOperationByMcpName("listmonk_get_bounce"),
		).toBe(bouncesOperations[1]);
		expect(getBouncesOperationByMcpName("listmonk_delete_bounce")).toBe(
			bouncesOperations[2],
		);
		expect(getBouncesOperationByMcpName("listmonk_unknown_bounce")).toBe(
			undefined,
		);
	});

	test("lists bounces through the normalized page contract", async () => {
		const list = mock(async () => ({
			data: {
				results: [bounceRecord],
				total: 1,
				per_page: 50,
				page: 2,
			},
		}));

		await expect(
			invokeListBouncesOperation(
				bounceContext({ list: list as BounceClient["bounce"]["list"] }),
				{
					page: "2",
					per_page: "50",
					campaign_id: "1",
					source: "api",
					order_by: "created_at",
					order: "desc",
				},
			),
		).resolves.toEqual({
			results: [bounceRecord],
			total: 1,
			per_page: 50,
			page: 2,
		});
		expect(list).toHaveBeenCalledWith({
			page: 2,
			per_page: 50,
			campaign_id: 1,
			source: "api",
			order_by: "created_at",
			order: "desc",
		});
	});

	test("omits absent filters instead of sending undefined values", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 20, page: 1 },
		}));

		await invokeListBouncesOperation(
			bounceContext({ list: list as BounceClient["bounce"]["list"] }),
			{},
		);

		expect(list).toHaveBeenCalledWith({ page: 1, per_page: 20 });
	});

	test("rejects an unsupported ordering field before the API call", async () => {
		const list = mock(async () => ({ data: { results: [] } }));
		await expect(
			invokeListBouncesOperation(
				bounceContext({ list: list as BounceClient["bounce"]["list"] }),
				{ order_by: "total" },
			),
		).rejects.toThrow();
		expect(list).not.toHaveBeenCalled();
	});

	test("gets a bounce from the observed flat response shape", async () => {
		const getById = mock(async () => ({ data: bounceRecord }));

		await expect(
			invokeGetBounceOperation(
				bounceContext({
					getById: getById as BounceClient["bounce"]["getById"],
				}),
				{ id: "1" },
			),
		).resolves.toEqual(bounceRecord);
		expect(getById).toHaveBeenCalledWith({ path: { id: 1 } });
	});

	test("tolerates the documented collection-shaped single-bounce response", async () => {
		const getById = mock(async () => ({
			data: { results: [bounceRecord] },
		}));

		await expect(
			invokeGetBounceOperation(
				bounceContext({
					getById: getById as BounceClient["bounce"]["getById"],
				}),
				{ id: 1 },
			),
		).resolves.toEqual(bounceRecord);
	});

	test("fails a wrapped single-bounce response without a record", async () => {
		const getById = mock(async () => ({ data: { results: [] } }));
		const context = bounceContext({
			getById: getById as BounceClient["bounce"]["getById"],
		});

		// The executor classifies the missing record so direct callers can
		// use isResourceMissingError on both transport-404 and wrapped-empty
		// paths; the invoker additionally wraps it as an execution error.
		const executorError = await getBounce(context, { id: 7 }).catch(
			(failure: unknown) => failure,
		);
		expect(isResourceMissingError(executorError)).toBe(true);
		expect((executorError as ResourceResponseError).status).toBe(404);

		const invokerError = await invokeGetBounceOperation(context, {
			id: 7,
		}).catch((failure: unknown) => failure);
		expect(invokerError).toBeInstanceOf(OperationExecutionError);
		expect((invokerError as Error).message).toContain("Bounce 7 not found");
	});

	test("falls back to the caller's page window when the envelope omits it", async () => {
		const list = mock(async () => ({
			data: { results: [bounceRecord] },
		}));

		await expect(
			invokeListBouncesOperation(
				bounceContext({ list: list as BounceClient["bounce"]["list"] }),
				{ page: 3, per_page: 50 },
			),
		).resolves.toMatchObject({
			results: [bounceRecord],
			total: 1,
			per_page: 50,
			page: 3,
		});
	});

	test("surfaces transport failures through the operation error contract", async () => {
		const list = mock(async () => ({
			error: "invalid API credentials",
			response: { status: 403 },
		}));

		const error = await invokeListBouncesOperation(
			bounceContext({
				list: list as unknown as BounceClient["bounce"]["list"],
			}),
			{},
		).catch((failure: unknown) => failure);

		expect(error).toBeInstanceOf(OperationExecutionError);
		expect(error).toHaveProperty("operationId", "bounces.list");
		expect((error as Error).message).toContain("invalid API credentials");
	});

	test("deletes a bounce and reports the documented no-op acknowledgement", async () => {
		const deleteById = mock(async () => ({ data: true }));

		await expect(
			invokeDeleteBounceOperation(
				bounceContext({
					deleteById: deleteById as BounceClient["bounce"]["deleteById"],
				}),
				{ id: "12" },
			),
		).resolves.toEqual({ id: 12, deleted: true });
		expect(deleteById).toHaveBeenCalledWith({ path: { id: 12 } });
	});

	test("rejects a negative delete acknowledgement", async () => {
		const deleteById = mock(async () => ({ data: false }));

		await expect(
			invokeDeleteBounceOperation(
				bounceContext({
					deleteById: deleteById as BounceClient["bounce"]["deleteById"],
				}),
				{ id: 12 },
			),
		).rejects.toThrow("negative acknowledgement");
	});

	test("previews and prunes bounce batches through the echoed id set", async () => {
		const list = mock(async () => ({
			data: {
				results: [bounceRecord, { ...bounceRecord, id: 2 }],
				total: 2,
				per_page: 100,
				page: 1,
			},
		}));

		await expect(
			invokePruneBouncesOperation(
				bounceContext({ list: list as BounceClient["bounce"]["list"] }),
				{},
			),
		).resolves.toEqual({
			dry_run: true,
			bounce_ids: [1, 2],
			total: 2,
			page: 1,
			per_page: 100,
		});

		const deleteById = mock(async () => ({ data: true }));
		await expect(
			invokePruneBouncesOperation(
				bounceContext({
					deleteById: deleteById as BounceClient["bounce"]["deleteById"],
				}),
				{ dry_run: false, bounce_ids: ["2", "1", "1"] },
			),
		).resolves.toEqual({
			dry_run: false,
			bounce_ids: [1, 2],
			acknowledged: 2,
		});
		expect(deleteById).toHaveBeenCalledTimes(2);
	});

	test("converges a destructive prune that echoes an empty selection", async () => {
		const deleteById = mock(async () => ({ data: true }));
		await expect(
			invokePruneBouncesOperation(
				bounceContext({
					deleteById: deleteById as BounceClient["bounce"]["deleteById"],
				}),
				{ dry_run: false, bounce_ids: [] },
			),
		).resolves.toEqual({
			dry_run: false,
			bounce_ids: [],
			acknowledged: 0,
		});
		expect(deleteById).not.toHaveBeenCalled();
	});

	test("rejects a destructive prune without the echoed id set", async () => {
		const deleteById = mock(async () => ({ data: true }));
		await expect(
			invokePruneBouncesOperation(
				bounceContext({
					deleteById: deleteById as BounceClient["bounce"]["deleteById"],
				}),
				{ dry_run: false },
			),
		).rejects.toThrow("bounce_ids");
		expect(deleteById).not.toHaveBeenCalled();
	});

	test("rejects a negative prune acknowledgement mid-batch", async () => {
		const deleteById = mock(async ({ path }: { path: { id: number } }) => ({
			data: path.id !== 2,
		}));
		await expect(
			invokePruneBouncesOperation(
				bounceContext({
					deleteById: deleteById as unknown as BounceClient["bounce"]["deleteById"],
				}),
				{ dry_run: false, bounce_ids: [1, 2] },
			),
		).rejects.toThrow("Failed to delete bounce 2");
	});

	test("dispatches MCP names through the named operations", async () => {
		const list = mock(async () => ({
			data: { results: [bounceRecord], total: 1, per_page: 20, page: 1 },
		}));
		const context = bounceContext({
			list: list as BounceClient["bounce"]["list"],
		});

		await expect(
			invokeBouncesOperationByMcpName(
				context,
				"listmonk_get_bounces",
				{},
			),
		).resolves.toMatchObject({
			operation: bouncesOperations[0],
			output: { results: [bounceRecord], total: 1 },
		});
		await expect(
			invokeBouncesOperationByMcpName(context, "listmonk_unknown_bounce", {}),
		).resolves.toBe(undefined);
	});
});
