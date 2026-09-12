import type { ListmonkClient } from "@listmonk-ops/openapi";
import { describe, expect, mock, test } from "bun:test";
import {
	renderBounce,
	renderBounces,
	renderDeleteBounce,
	renderDeleteSubscriberBounces,
	renderSubscriberBounces,
	type BouncesCliContext,
} from "../src/commands/bounces";

function output() {
	return {
		info: mock(() => undefined),
		json: mock(() => undefined),
		success: mock(() => undefined),
		table: mock(() => undefined),
		warning: mock(() => undefined),
	};
}

describe("bounce CLI actions", () => {
	test("renders bounces through the shared operation", async () => {
		const list = mock(async () => ({
			data: {
				results: [
					{
						id: 1,
						type: "hard",
						source: "api",
						email: "reader@example.com",
						subscriber_id: 663,
					},
				],
				total: 1,
				per_page: 20,
				page: 1,
			},
		}));
		const cliContext = {
			client: {
				bounce: { list },
				subscriber: {},
			} as unknown as Pick<ListmonkClient, "bounce" | "subscriber">,
			output: output(),
		} satisfies BouncesCliContext;

		await renderBounces(cliContext, { page: 1, per_page: 20 });

		expect(list).toHaveBeenCalledWith({ page: 1, per_page: 20 });
		expect(cliContext.output.table).toHaveBeenCalledWith([
			{
				id: 1,
				type: "hard",
				source: "api",
				email: "reader@example.com",
				subscriber_id: 663,
			},
		]);
	});

	test("filters and orders bounces through the shared operation", async () => {
		const list = mock(async () => ({
			data: { results: [], total: 0, per_page: 20, page: 1 },
		}));
		const cliContext = {
			client: {
				bounce: { list },
				subscriber: {},
			} as unknown as Pick<ListmonkClient, "bounce" | "subscriber">,
			output: output(),
		} satisfies BouncesCliContext;

		await renderBounces(cliContext, {
			campaign_id: 1,
			source: "api",
			order_by: "created_at",
			order: "desc",
		});

		expect(list).toHaveBeenCalledWith({
			page: 1,
			per_page: 20,
			campaign_id: 1,
			source: "api",
			order_by: "created_at",
			order: "desc",
		});
		expect(cliContext.output.info).toHaveBeenCalledWith("No bounces found");
	});

	test("renders a single bounce through the shared operation", async () => {
		const getById = mock(async () => ({
			data: {
				id: 1,
				type: "hard",
				source: "api",
				meta: { reason: "550 mailbox unavailable" },
				subscriber_id: 663,
				campaign: { id: 1, name: "Test campaign" },
			},
		}));
		const cliContext = {
			client: {
				bounce: { getById },
				subscriber: {},
			} as unknown as Pick<ListmonkClient, "bounce" | "subscriber">,
			output: output(),
		} satisfies BouncesCliContext;

		await renderBounce(cliContext, { id: 1 });

		expect(getById).toHaveBeenCalledWith({ path: { id: 1 } });
		expect(cliContext.output.json).toHaveBeenCalledWith({
			id: 1,
			type: "hard",
			source: "api",
			meta: { reason: "550 mailbox unavailable" },
			subscriber_id: 663,
			campaign: { id: 1, name: "Test campaign" },
		});
	});

	test("deletes a bounce through the shared operation", async () => {
		const deleteById = mock(async () => ({ data: true }));
		const cliContext = {
			client: {
				bounce: { deleteById },
				subscriber: {},
			} as unknown as Pick<ListmonkClient, "bounce" | "subscriber">,
			output: output(),
		} satisfies BouncesCliContext;

		await renderDeleteBounce(cliContext, { id: 9 });

		expect(deleteById).toHaveBeenCalledWith({ path: { id: 9 } });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Bounce deleted: 9",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({
			id: 9,
			deleted: true,
		});
	});

	test("renders a subscriber's empty bounce history as an info line", async () => {
		const getBounces = mock(async () => ({ data: [] }));
		const cliContext = {
			client: {
				bounce: {},
				subscriber: { getBounces },
			} as unknown as Pick<ListmonkClient, "bounce" | "subscriber">,
			output: output(),
		} satisfies BouncesCliContext;

		await renderSubscriberBounces(cliContext, { subscriber_id: 663 });
		expect(cliContext.output.info).toHaveBeenCalledWith(
			"No bounces found for subscriber 663",
		);
	});

	test("renders the subscriber bounce deletion acknowledgement", async () => {
		const deleteBounces = mock(async () => ({ data: true }));
		const cliContext = {
			client: {
				bounce: {},
				subscriber: { deleteBounces },
			} as unknown as Pick<ListmonkClient, "bounce" | "subscriber">,
			output: output(),
		} satisfies BouncesCliContext;

		await renderDeleteSubscriberBounces(cliContext, { subscriber_id: 663 });
		expect(cliContext.output.success).toHaveBeenCalledWith(
			"Deleted bounces for subscriber: 663",
		);
		expect(cliContext.output.json).toHaveBeenCalledWith({
			id: 663,
			deleted: true,
		});
	});
});
