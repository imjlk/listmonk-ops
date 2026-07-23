import { describe, expect, it, mock } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { ListmonkAbTestIntegration } from "../src/listmonk-integration";

function makeClient(overrides: {
	manageLists?: (...args: unknown[]) => Promise<unknown>;
} = {}): ListmonkClient {
	const manageLists = mock(
		overrides.manageLists ?? (async () => ({ data: true })),
	);
	return {
		subscriber: { manageLists },
	} as unknown as ListmonkClient;
}

describe("ListmonkAbTestIntegration.addSubscribersToListBulk", () => {
	it("chunks subscriber ids and calls manageLists per chunk", async () => {
		const calls: { ids: number[]; target_list_ids: number[] }[] = [];
		const client = makeClient({
			manageLists: async (options: unknown) => {
				const body = (options as { body: unknown }).body as {
					ids: number[];
					target_list_ids: number[];
				};
				calls.push({
					ids: body.ids,
					target_list_ids: body.target_list_ids,
				});
				return { data: true };
			},
		});
		const integration = new ListmonkAbTestIntegration(client);
		const subscriberIds = Array.from({ length: 1200 }, (_, i) => i + 1);
		const result = await integration.addSubscribersToListBulk(
			subscriberIds,
			42,
			{ chunkSize: 500 },
		);
		expect(result.addedCount).toBe(1200);
		expect(calls).toHaveLength(3);
		expect(calls[0]?.ids).toHaveLength(500);
		expect(calls[0]?.target_list_ids).toEqual([42]);
		expect(calls[1]?.ids).toHaveLength(500);
		expect(calls[2]?.ids).toHaveLength(200);
		expect(calls[2]?.target_list_ids).toEqual([42]);
	});

	it("uses action: add for every chunk", async () => {
		const actions: string[] = [];
		const client = makeClient({
			manageLists: async (options: unknown) => {
				const body = (options as { body: unknown }).body as {
					action: string;
				};
				actions.push(body.action);
				return { data: true };
			},
		});
		const integration = new ListmonkAbTestIntegration(client);
		await integration.addSubscribersToListBulk([1, 2, 3], 99, {
			chunkSize: 2,
		});
		expect(actions).toEqual(["add", "add"]);
	});

	it("invokes onProgress after each chunk with the running count", async () => {
		const client = makeClient();
		const integration = new ListmonkAbTestIntegration(client);
		const progress: number[] = [];
		await integration.addSubscribersToListBulk(
			Array.from({ length: 1200 }, (_, i) => i + 1),
			7,
			{ chunkSize: 500, onProgress: (count) => progress.push(count) },
		);
		expect(progress).toEqual([500, 1000, 1200]);
	});

	it("throws on an error envelope without partial mutation success", async () => {
		const client = makeClient({
			manageLists: async () => ({ error: "permission denied" }),
		});
		const integration = new ListmonkAbTestIntegration(client);
		await expect(
			integration.addSubscribersToListBulk([1, 2, 3], 5, { chunkSize: 2 }),
		).rejects.toThrow("permission denied");
	});

	it("handles an empty subscriber list as a no-op", async () => {
		const manageLists = mock(async () => ({ data: true }));
		const client = { subscriber: { manageLists } } as unknown as ListmonkClient;
		const integration = new ListmonkAbTestIntegration(client);
		const result = await integration.addSubscribersToListBulk([], 5);
		expect(result.addedCount).toBe(0);
		expect(manageLists).not.toHaveBeenCalled();
	});
});
