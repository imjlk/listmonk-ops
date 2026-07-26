import { describe, expect, test } from "bun:test";
import {
	cliOperationCatalog,
	listCliOperationCatalogSummaries,
} from "../src/operation-catalog";
import { getOperationCatalogOutput } from "../src/commands/operations";

describe("CLI operation catalog", () => {
	test("exposes every shared operation without requiring Listmonk credentials", () => {
		expect(cliOperationCatalog.entries).toHaveLength(53);
		expect(listCliOperationCatalogSummaries()).toHaveLength(53);
		expect(getOperationCatalogOutput("campaigns").operations).toHaveLength(11);
		expect(getOperationCatalogOutput("media").operations).toHaveLength(3);
		expect(getOperationCatalogOutput("transactional").operations).toEqual([
			expect.objectContaining({
				mcpName: "listmonk_send_transactional",
			}),
		]);
	});
});
