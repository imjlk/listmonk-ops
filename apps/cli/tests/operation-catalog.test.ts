import { describe, expect, test } from "bun:test";
import {
	cliOperationCatalog,
	listCliOperationCatalogSummaries,
} from "../src/operation-catalog";
import { getOperationCatalogOutput } from "../src/commands/operations";

describe("CLI operation catalog", () => {
	test("exposes every shared operation without requiring Listmonk credentials", () => {
		expect(cliOperationCatalog.entries).toHaveLength(95);
		expect(listCliOperationCatalogSummaries()).toHaveLength(95);
		expect(getOperationCatalogOutput("discovery").operations).toHaveLength(7);
		expect(getOperationCatalogOutput("campaigns").operations).toHaveLength(11);
		expect(getOperationCatalogOutput("media").operations).toHaveLength(4);
		expect(getOperationCatalogOutput("sequences").operations).toHaveLength(14);
		expect(getOperationCatalogOutput("transactional").operations).toEqual([
			expect.objectContaining({
				mcpName: "listmonk_send_transactional",
			}),
		]);
		expect(getOperationCatalogOutput("campaigns").operations).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "campaigns.schedule",
					spec: expect.objectContaining({
						resource: "campaign",
						verb: "schedule",
					}),
				}),
			]),
		);
	});
});
