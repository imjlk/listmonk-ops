import { describe, expect, test } from "bun:test";
import {
	cliOperationCatalog,
	listCliOperationCatalogSummaries,
} from "../src/operation-catalog";
import { getOperationCatalogOutput } from "../src/commands/operations";

describe("CLI operation catalog", () => {
	test("exposes every shared operation without requiring Listmonk credentials", () => {
		expect(cliOperationCatalog.entries).toHaveLength(134);
		expect(listCliOperationCatalogSummaries()).toHaveLength(134);
		expect(getOperationCatalogOutput("discovery").operations).toHaveLength(8);
		expect(getOperationCatalogOutput("campaigns").operations).toHaveLength(15);
		expect(getOperationCatalogOutput("media").operations).toHaveLength(4);
		expect(getOperationCatalogOutput("bounces").operations).toHaveLength(6);
		expect(getOperationCatalogOutput("sequences").operations).toHaveLength(14);
		expect(getOperationCatalogOutput("transactional").operations).toEqual([
			expect.objectContaining({
				mcpName: "listmonk_send_transactional",
			}),
			expect.objectContaining({ mcpName: "listmonk_transactional_records" }),
			expect.objectContaining({ mcpName: "listmonk_reconcile_transactional" }),
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
