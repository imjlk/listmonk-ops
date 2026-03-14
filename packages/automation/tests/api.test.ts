import { describe, expect, test } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { getCampaign, getListById, getTemplateById } from "../src/api";

describe("automation api helpers", () => {
	test("getCampaign throws when data is missing", async () => {
		const client = {
			campaign: {
				getById: async () => ({ data: undefined }),
			},
		} as unknown as ListmonkClient;

		await expect(getCampaign(client, 42)).rejects.toThrow(
			"Failed to fetch campaign 42: received empty data",
		);
	});

	test("getListById throws when response returns an error", async () => {
		const client = {
			list: {
				getById: async () => ({ error: "list unavailable" }),
			},
		} as unknown as ListmonkClient;

		await expect(getListById(client, 7)).rejects.toThrow(
			"Failed to fetch list 7: list unavailable",
		);
	});

	test("getTemplateById throws when data is missing", async () => {
		const client = {
			template: {
				getById: async () => ({ data: undefined }),
			},
		} as unknown as ListmonkClient;

		await expect(getTemplateById(client, 9)).rejects.toThrow(
			"Failed to fetch template 9: received empty data",
		);
	});
});
