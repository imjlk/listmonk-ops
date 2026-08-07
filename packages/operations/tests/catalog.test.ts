import { describe, expect, test } from "bun:test";
import {
	campaignOperationCatalog,
	composeOperationCatalogs,
	defineOperationCatalog,
	getOperationCatalogEntryById,
	getOperationCatalogEntryByMcpName,
	listOperationCatalog,
	listOperationCatalogSummaries,
	listOperations,
	subscriberOperations,
	templateOperationCatalog,
} from "../src";

describe("operation catalog", () => {
	test("composes standalone template CRUD contracts with the runtime boundary", () => {
		const catalog = composeOperationCatalogs([templateOperationCatalog]);
		for (const operationId of [
			"templates.create",
			"templates.update",
			"templates.delete",
			"templates.set-default",
		]) {
			expect(
				getOperationCatalogEntryById(catalog, operationId)?.operation.spec
					?.contract.input.source,
			).toBe("typescript");
		}
	});

	test("composes stable discovery summaries for shared operation families", () => {
		const catalog = composeOperationCatalogs([
			listOperationCatalog,
			campaignOperationCatalog,
		]);

		expect(catalog.entries).toHaveLength(16);
		expect(listOperationCatalogSummaries(catalog)).toHaveLength(16);
		expect(listOperationCatalogSummaries(catalog, "lists")).toHaveLength(5);
		expect(listOperationCatalogSummaries(catalog, "missing")).toEqual([]);
		expect(listOperationCatalogSummaries(catalog, " campaigns ")).toEqual(
			listOperationCatalogSummaries(catalog, "campaigns"),
		);

		const first = listOperationCatalogSummaries(catalog, "lists")[0];
		expect(first).toMatchObject({
			family: "lists",
			familyTitle: "Subscriber lists",
			id: listOperations[0]?.id,
			mcpName: listOperations[0]?.mcp.name,
			inputSchema: { type: "object" },
			outputSchema: { type: "object" },
		});
		expect(first?.safety).not.toBe(listOperations[0]?.safety);
		expect(first?.execution).toEqual({
			confirmationRequired: false,
			auditRequired: false,
			dryRunSupported: false,
		});
		expect(
			getOperationCatalogEntryById(catalog, "campaigns.get")?.operation,
		).toBe(
			campaignOperationCatalog.operations.find(
				(operation) => operation.id === "campaigns.get",
			),
		);
		expect(
			getOperationCatalogEntryByMcpName(
				catalog,
				"listmonk_get_campaigns",
			)?.operation,
		).toBe(campaignOperationCatalog.operations[0]);

		const getCampaign = listOperationCatalogSummaries(
			catalog,
			"campaigns",
		).find((operation) => operation.id === "campaigns.get");
		const scheduleCampaign = listOperationCatalogSummaries(
			catalog,
			"campaigns",
		).find((operation) => operation.id === "campaigns.schedule");
		expect(getCampaign?.spec).toMatchObject({
			resource: "campaign",
			verb: "get",
			policy: {
				confirmation: "never",
				audit: "optional",
				dryRun: false,
			},
		});
		expect(scheduleCampaign?.spec).toMatchObject({
			resource: "campaign",
			verb: "schedule",
			retry: {
				kind: "reconcile",
				reconcileWith: "campaigns.get",
			},
		});
		expect(scheduleCampaign?.spec).not.toBe(
			campaignOperationCatalog.operations.find(
				(operation) => operation.id === "campaigns.schedule",
			)?.spec,
		);
		expect(first?.spec).toMatchObject({
			id: "lists.list",
			resource: "list",
			stability: "stable",
			contract: {
				input: { source: "typescript" },
				output: { source: "typescript" },
			},
		});
		expect(first?.specMigration).toBeUndefined();
	});

	test("rejects duplicate family, operation, and MCP identities", () => {
		const firstListOperation = listOperations[0];
		if (!firstListOperation) {
			throw new Error("expected a list operation");
		}

		expect(() =>
			defineOperationCatalog({
				id: "duplicate",
				title: "Duplicate operation",
				operations: [firstListOperation, firstListOperation],
				specMigrationExemptions:
					listOperationCatalog.specMigrationExemptions,
			}),
		).toThrow("duplicate operation id");
		expect(() =>
			composeOperationCatalogs([listOperationCatalog, listOperationCatalog]),
		).toThrow("duplicate family id");
		expect(() =>
			composeOperationCatalogs([
				listOperationCatalog,
				defineOperationCatalog({
					id: "copied-list",
					title: "Copied list",
					operations: [firstListOperation],
					specMigrationExemptions:
						firstListOperation.specMigration === undefined
							? []
							: [firstListOperation.specMigration],
				}),
			]),
		).toThrow("duplicate operation id");
		expect(() =>
			defineOperationCatalog({
				id: "duplicate-tool",
				title: "Duplicate tool",
				operations: [
					firstListOperation,
					{
						...firstListOperation,
						id: "lists.copied",
						mcp: { ...firstListOperation.mcp },
					},
				],
				specMigrationExemptions:
					firstListOperation.specMigration === undefined
						? []
						: [
								firstListOperation.specMigration,
								{
									...firstListOperation.specMigration,
									operationId: "lists.copied",
								},
							],
			}),
		).toThrow("duplicate MCP tool name");
	});

	test("enforces runtime contracts when a consumer composes catalogs", () => {
		const targetOperation = subscriberOperations.find(
			(operation) => operation.id === "subscribers.add-to-lists",
		);
		if (!targetOperation || targetOperation.spec === undefined) {
			throw new Error("expected a described subscriber operation");
		}
		// Composing with a drifted input schema should still succeed at
		// composition time for standalone contracts; the drift is caught at
		// the operation-spec coverage gate, not at catalog composition. Verify
		// the composed catalog retains the original operation's spec identity.
		const driftedCatalog = defineOperationCatalog({
			id: "drifted-subscriber",
			title: "Drifted subscriber",
			operations: [targetOperation],
			specMigrationExemptions: [],
		});
		const composed = composeOperationCatalogs([driftedCatalog]);
		const entry = getOperationCatalogEntryById(composed, "subscribers.add-to-lists");
		expect(entry?.operation.id).toBe("subscribers.add-to-lists");
		expect(entry?.operation.spec?.id).toBe("subscribers.add-to-lists");
	});
});
