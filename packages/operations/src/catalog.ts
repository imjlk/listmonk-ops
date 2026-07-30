import type {
	ObjectJsonSchema,
	OperationMcpMetadata,
	OperationSafety,
} from "./operation";
import {
	assertRuntimeOperationContracts,
	projectOperationSpec,
	type AnyOperationSpec,
	type OperationSpecMigrationExemption,
} from "./specs";
import type { z } from "zod";
import {
	getOperationExecutionPolicy,
	type OperationExecutionPolicy,
} from "./execution-policy";
import {
	composeOperationCatalogStructure,
	validateOperationCatalogStructure,
} from "./catalog-internal";

/**
 * The runtime metadata every shared operation already exposes. The catalog
 * deliberately omits `invoke`: each surface keeps using its named domain
 * invokers so the runtime architecture stays explicit and graph-visible.
 * Input schemas remain available only for transport-side safety controls that
 * must account for preprocessing and defaults.
 */
export type OperationCatalogItem = Readonly<{
	id: string;
	title: string;
	description: string;
	inputSchema: z.ZodType;
	inputJsonSchema: ObjectJsonSchema;
	outputJsonSchema: ObjectJsonSchema;
	safety: OperationSafety;
	mcp: OperationMcpMetadata;
	spec?: AnyOperationSpec | undefined;
	specMigration?: OperationSpecMigrationExemption | undefined;
}>;

export type OperationCatalog<
	Operations extends readonly OperationCatalogItem[] = readonly OperationCatalogItem[],
> = Readonly<{
	id: string;
	title: string;
	operations: Operations;
	specMigrationExemptions: readonly OperationSpecMigrationExemption[];
}>;

export type OperationCatalogEntry = Readonly<{
	family: string;
	familyTitle: string;
	operation: OperationCatalogItem;
}>;

export type ComposedOperationCatalog = Readonly<{
	catalogs: readonly OperationCatalog[];
	entries: readonly OperationCatalogEntry[];
	entriesByOperationId: ReadonlyMap<string, OperationCatalogEntry>;
	entriesByMcpName: ReadonlyMap<string, OperationCatalogEntry>;
}>;

export type OperationCatalogSummary = Readonly<{
	family: string;
	familyTitle: string;
	id: string;
	mcpName: string;
	title: string;
	description: string;
	inputSchema: ObjectJsonSchema;
	outputSchema: ObjectJsonSchema;
	safety: OperationSafety;
	execution: OperationExecutionPolicy;
	spec?: AnyOperationSpec | undefined;
	specMigration?: OperationSpecMigrationExemption | undefined;
}>;

function validateRuntimeContracts(catalog: OperationCatalog): void {
	for (const operation of catalog.operations) {
		if (operation.spec === undefined) continue;
		assertRuntimeOperationContracts(operation.spec, {
			input: operation.inputJsonSchema,
			output: operation.outputJsonSchema,
		});
	}
}

/**
 * Declare one independently owned operation family. It is safe to use in a
 * runtime-neutral library. Structural validation happens immediately; runtime
 * contract compatibility is enforced when a consumer composes its catalog.
 */
export function defineOperationCatalog<
	const Operations extends readonly OperationCatalogItem[],
>(catalog: OperationCatalog<Operations>): OperationCatalog<Operations> {
	validateOperationCatalogStructure(catalog);
	return catalog;
}

/**
 * Combine family descriptors for a consumer surface. Duplicate operation and
 * MCP names are rejected here, where cross-package collisions are observable.
 */
export function composeOperationCatalogs(
	catalogs: readonly OperationCatalog[],
): ComposedOperationCatalog {
	const composedCatalog = composeOperationCatalogStructure(catalogs);
	for (const catalog of composedCatalog.catalogs) {
		validateRuntimeContracts(catalog);
	}
	return composedCatalog;
}

export function getOperationCatalogEntryById(
	catalog: ComposedOperationCatalog,
	operationId: string,
): OperationCatalogEntry | undefined {
	return catalog.entriesByOperationId.get(operationId);
}

export function getOperationCatalogEntryByMcpName(
	catalog: ComposedOperationCatalog,
	mcpName: string,
): OperationCatalogEntry | undefined {
	return catalog.entriesByMcpName.get(mcpName);
}

function toTransportSchema(schema: ObjectJsonSchema): ObjectJsonSchema {
	const serialized = JSON.stringify(schema);
	if (serialized === undefined) {
		throw new Error("Operation catalog schema must be JSON-serializable");
	}
	return JSON.parse(serialized) as ObjectJsonSchema;
}

function toSummary(entry: OperationCatalogEntry): OperationCatalogSummary {
	const { family, familyTitle, operation } = entry;
	const summary: OperationCatalogSummary = {
		family,
		familyTitle,
		id: operation.id,
		mcpName: operation.mcp.name,
		title: operation.title,
		description: operation.description,
		inputSchema: toTransportSchema(operation.inputJsonSchema),
		outputSchema: toTransportSchema(operation.outputJsonSchema),
		safety: { ...operation.safety },
		execution: getOperationExecutionPolicy(operation),
	};
	if (operation.spec !== undefined) {
		return {
			...summary,
			spec: projectOperationSpec(operation.spec),
		};
	}
	return {
		...summary,
		specMigration: operation.specMigration,
	};
}

/**
 * Return transport-safe discovery data. An omitted family returns the stable
 * catalog order; an unknown family intentionally returns an empty list.
 */
export function listOperationCatalogSummaries(
	catalog: ComposedOperationCatalog,
	family?: string,
): readonly OperationCatalogSummary[] {
	const normalizedFamily = family?.trim();
	const summaries: OperationCatalogSummary[] = [];
	for (const entry of catalog.entries) {
		if (normalizedFamily === undefined || entry.family === normalizedFamily) {
			summaries.push(toSummary(entry));
		}
	}
	return summaries;
}
