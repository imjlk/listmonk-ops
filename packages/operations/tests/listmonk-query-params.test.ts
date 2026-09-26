import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	LISTMONK_SORT_ORDERS,
	toListmonkSortOrder,
} from "../src/listmonk-sort-order";
import {
	getCampaignsOperation,
	invokeGetCampaignsOperation,
} from "../src/campaigns";
import {
	getSubscribersOperation,
	invokeGetSubscribersOperation,
} from "../src/subscribers";
import { OperationInputError } from "../src/operation";

type CampaignClient = Pick<ListmonkClient, "campaign">;
type SubscriberClient = Pick<ListmonkClient, "subscriber">;

const emptyPage = { data: { results: [], total: 0, per_page: 20, page: 1 } };

describe("Listmonk sort order", () => {
	test("maps either spelling to the lowercase value Listmonk honors", () => {
		// Listmonk 6.2 compares `order` with lowercase asc/desc and silently
		// sorts descending otherwise, so uppercase ASC never ascended.
		expect(toListmonkSortOrder("asc")).toBe("asc");
		expect(toListmonkSortOrder("ASC")).toBe("asc");
		expect(toListmonkSortOrder("desc")).toBe("desc");
		expect(toListmonkSortOrder("DESC")).toBe("desc");
	});

	test("publishes lowercase and legacy uppercase spellings to CLI and MCP", () => {
		for (const operation of [getCampaignsOperation, getSubscribersOperation]) {
			expect(operation.inputJsonSchema.properties?.order).toMatchObject({
				enum: [...LISTMONK_SORT_ORDERS],
			});
		}
	});

	test("sends campaign list order lowercase", async () => {
		const list = mock(async () => emptyPage);
		const context = {
			client: { campaign: { list } } as unknown as CampaignClient,
		};

		await invokeGetCampaignsOperation(context, {
			order: "ASC",
			order_by: "created_at",
		});
		await invokeGetCampaignsOperation(context, { order: "desc" });

		expect(list).toHaveBeenNthCalledWith(1, {
			query: { page: 1, per_page: 20, order: "asc", order_by: "created_at" },
		});
		expect(list).toHaveBeenNthCalledWith(2, {
			query: { page: 1, per_page: 20, order: "desc" },
		});
	});

	test("sends subscriber list order lowercase", async () => {
		const list = mock(async () => emptyPage);
		const context = {
			client: { subscriber: { list } } as unknown as SubscriberClient,
		};

		await invokeGetSubscribersOperation(context, {
			order: "ASC",
			order_by: "name",
		});

		expect(list).toHaveBeenCalledWith({
			query: { page: 1, per_page: 20, order_by: "name", order: "asc" },
		});
	});

	test("rejects unknown sort directions before requests", async () => {
		const list = mock(async () => emptyPage);
		await expect(
			invokeGetSubscribersOperation(
				{ client: { subscriber: { list } } as unknown as SubscriberClient },
				{ order: "ascending" },
			),
		).rejects.toBeInstanceOf(OperationInputError);
		expect(list).not.toHaveBeenCalled();
	});
});
