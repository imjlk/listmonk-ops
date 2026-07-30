import type {
	ComposedOperationCatalog,
	OperationCatalog,
	OperationCatalogEntry,
} from "./catalog";

function assertNonBlank(value: string, label: string): void {
	if (value.trim().length === 0) {
		throw new Error(`Operation catalog ${label} must not be blank`);
	}
}

function assertDistinct(
	values: Iterable<string>,
	label: string,
): void {
	const seen = new Set<string>();
	for (const value of values) {
		if (seen.has(value)) {
			throw new Error(
				`Operation catalog contains duplicate ${label}: ${value}`,
			);
		}
		seen.add(value);
	}
}

export function validateOperationCatalogStructure(
	catalog: OperationCatalog,
): void {
	assertNonBlank(catalog.id, "family id");
	assertNonBlank(catalog.title, "family title");
	if (catalog.operations.length === 0) {
		throw new Error(`Operation catalog ${catalog.id} must contain operations`);
	}

	for (const operation of catalog.operations) {
		assertNonBlank(operation.id, "operation id");
		assertNonBlank(operation.mcp.name, "MCP tool name");
		if (
			(operation.spec === undefined) ===
			(operation.specMigration === undefined)
		) {
			throw new Error(
				`Operation catalog ${operation.id} must declare exactly one OperationSpec descriptor or migration exemption`,
			);
		}
	}
	assertDistinct(
		catalog.operations.map((operation) => operation.id),
		"operation id",
	);
	assertDistinct(
		catalog.operations.map((operation) => operation.mcp.name),
		"MCP tool name",
	);
	for (const operation of catalog.operations) {
		if (
			operation.spec !== undefined &&
			operation.spec.id !== operation.id
		) {
			throw new Error(
				`Operation catalog ${operation.id} binds mismatched descriptor ${operation.spec.id}`,
			);
		}
		if (
			operation.specMigration !== undefined &&
			operation.specMigration.operationId !== operation.id
		) {
			throw new Error(
				`Operation catalog ${operation.id} binds mismatched spec migration exemption ${operation.specMigration.operationId}`,
			);
		}
	}
	const expectedMigrationIds = catalog.operations
		.filter((operation) => operation.spec === undefined)
		.map((operation) => operation.id)
		.sort();
	const declaredMigrationIds = catalog.specMigrationExemptions
		.map((exemption) => exemption.operationId)
		.sort();
	if (
		JSON.stringify(expectedMigrationIds) !==
		JSON.stringify(declaredMigrationIds)
	) {
		throw new Error(
			`Operation catalog ${catalog.id} spec migration exemptions do not match uncovered operations: expected ${JSON.stringify(expectedMigrationIds)}, received ${JSON.stringify(declaredMigrationIds)}`,
		);
	}
}

/**
 * Compose catalog topology without consulting the committed runtime-contract
 * bridge. Runtime-contract regeneration uses this internal boundary so it can
 * reject cross-family collisions before producing the next bridge snapshot.
 */
export function composeOperationCatalogStructure(
	catalogs: readonly OperationCatalog[],
): ComposedOperationCatalog {
	assertDistinct(
		catalogs.map((catalog) => catalog.id),
		"family id",
	);

	for (const catalog of catalogs) {
		validateOperationCatalogStructure(catalog);
	}

	const entries: readonly OperationCatalogEntry[] = catalogs.flatMap(
		(catalog) =>
			catalog.operations.map((operation) => ({
				family: catalog.id,
				familyTitle: catalog.title,
				operation,
			})),
	);
	assertDistinct(
		entries.map((entry) => entry.operation.id),
		"operation id",
	);
	assertDistinct(
		entries.map((entry) => entry.operation.mcp.name),
		"MCP tool name",
	);

	return {
		catalogs,
		entries,
		entriesByOperationId: new Map(
			entries.map((entry) => [entry.operation.id, entry] as const),
		),
		entriesByMcpName: new Map(
			entries.map((entry) => [entry.operation.mcp.name, entry] as const),
		),
	};
}
