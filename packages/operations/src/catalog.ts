import type {
	ObjectJsonSchema,
	OperationMcpMetadata,
	OperationSafety,
} from "./operation";
import type { z } from "zod";
import {
	getOperationExecutionPolicy,
	type OperationExecutionPolicy,
} from "./execution-policy";

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
}>;

export type OperationCatalog<
	Operations extends readonly OperationCatalogItem[] = readonly OperationCatalogItem[],
> = Readonly<{
	id: string;
	title: string;
	operations: Operations;
}>;

export type OperationCatalogEntry = Readonly<{
	family: string;
	familyTitle: string;
	operation: OperationCatalogItem;
}>;

export type ComposedOperationCatalog = Readonly<{
	catalogs: readonly OperationCatalog[];
	entries: readonly OperationCatalogEntry[];
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
}>;

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

function validateCatalog(catalog: OperationCatalog): void {
	assertNonBlank(catalog.id, "family id");
	assertNonBlank(catalog.title, "family title");
	if (catalog.operations.length === 0) {
		throw new Error(`Operation catalog ${catalog.id} must contain operations`);
	}

	for (const operation of catalog.operations) {
		assertNonBlank(operation.id, "operation id");
		assertNonBlank(operation.mcp.name, "MCP tool name");
	}
	assertDistinct(
		catalog.operations.map((operation) => operation.id),
		"operation id",
	);
	assertDistinct(
		catalog.operations.map((operation) => operation.mcp.name),
		"MCP tool name",
	);
}

/**
 * Declare one independently owned operation family. It is safe to use in a
 * runtime-neutral library: validation happens when the descriptor is loaded,
 * before either transport assembles its own catalog.
 */
export function defineOperationCatalog<
	const Operations extends readonly OperationCatalogItem[],
>(catalog: OperationCatalog<Operations>): OperationCatalog<Operations> {
	validateCatalog(catalog);
	return catalog;
}

/**
 * Combine family descriptors for a consumer surface. Duplicate operation and
 * MCP names are rejected here, where cross-package collisions are observable.
 */
export function composeOperationCatalogs(
	catalogs: readonly OperationCatalog[],
): ComposedOperationCatalog {
	assertDistinct(
		catalogs.map((catalog) => catalog.id),
		"family id",
	);

	for (const catalog of catalogs) {
		validateCatalog(catalog);
	}

	const entries = catalogs.flatMap((catalog) =>
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
		entriesByMcpName: new Map(
			entries.map((entry) => [entry.operation.mcp.name, entry] as const),
		),
	};
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
	return {
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
