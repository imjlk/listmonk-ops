import type { NormalizedContractSchema } from "./json";

type JsonSchemaObject = Readonly<Record<string, unknown>>;

interface ObjectSurface {
	properties: ReadonlyMap<string, readonly JsonSchemaObject[]>;
	required: ReadonlySet<string>;
	additionalProperties: boolean;
}

function isSchemaObject(value: unknown): value is JsonSchemaObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function referencedSchema(
	reference: string,
	contract: NormalizedContractSchema,
): JsonSchemaObject | undefined {
	const prefix = "#/components/schemas/";
	if (!reference.startsWith(prefix)) return undefined;
	const schemas = contract.components["schemas"];
	if (!isSchemaObject(schemas)) return undefined;
	const schema = schemas[reference.slice(prefix.length)];
	return isSchemaObject(schema) ? schema : undefined;
}

function resolveSchema(
	schema: JsonSchemaObject,
	contract: NormalizedContractSchema,
	seen: ReadonlySet<string> = new Set(),
): JsonSchemaObject {
	const reference = schema["$ref"];
	if (typeof reference !== "string" || seen.has(reference)) return schema;
	const resolved = referencedSchema(reference, contract);
	if (resolved === undefined) return schema;
	return resolveSchema(resolved, contract, new Set([...seen, reference]));
}

function directObjectSurface(schema: JsonSchemaObject): ObjectSurface {
	const properties = new Map<string, readonly JsonSchemaObject[]>();
	const rawProperties = schema["properties"];
	if (isSchemaObject(rawProperties)) {
		for (const [name, property] of Object.entries(rawProperties)) {
			if (isSchemaObject(property)) properties.set(name, [property]);
		}
	}
	const required = new Set<string>();
	const rawRequired = schema["required"];
	if (Array.isArray(rawRequired)) {
		for (const name of rawRequired) {
			if (typeof name === "string") required.add(name);
		}
	}
	return {
		properties,
		required,
		additionalProperties: schema["additionalProperties"] !== false,
	};
}

function mergePropertySurfaces(
	surfaces: readonly ObjectSurface[],
	requiredMode: "union" | "intersection",
	additionalPropertiesMode: "all" | "any",
): ObjectSurface {
	const properties = new Map<string, JsonSchemaObject[]>();
	for (const surface of surfaces) {
		for (const [name, schemas] of surface.properties) {
			properties.set(name, [...(properties.get(name) ?? []), ...schemas]);
		}
	}
	const required =
		requiredMode === "union"
			? new Set(surfaces.flatMap((surface) => [...surface.required]))
			: new Set(
					[...(surfaces[0]?.required ?? [])].filter((name) =>
						surfaces.every((surface) => surface.required.has(name)),
					),
				);
	return {
		properties,
		required,
		additionalProperties:
			additionalPropertiesMode === "all"
				? surfaces.every((surface) => surface.additionalProperties)
				: surfaces.some((surface) => surface.additionalProperties),
	};
}

function schemaBranches(
	schema: JsonSchemaObject,
	keyword: "allOf" | "anyOf" | "oneOf",
): readonly JsonSchemaObject[] {
	const value = schema[keyword];
	if (!Array.isArray(value)) return [];
	return value.filter(isSchemaObject);
}

function objectSurface(
	schema: JsonSchemaObject,
	contract: NormalizedContractSchema,
): ObjectSurface {
	const resolved = resolveSchema(schema, contract);
	const direct = directObjectSurface(resolved);
	const allOf = schemaBranches(resolved, "allOf");
	const alternatives = [
		...schemaBranches(resolved, "anyOf"),
		...schemaBranches(resolved, "oneOf"),
	];
	const composed: ObjectSurface[] = [direct];
	if (allOf.length > 0) {
		composed.push(
			mergePropertySurfaces(
				allOf.map((branch) => objectSurface(branch, contract)),
				"union",
				"all",
			),
		);
	}
	if (alternatives.length > 0) {
		composed.push(
			mergePropertySurfaces(
				alternatives.map((branch) => objectSurface(branch, contract)),
				"intersection",
				"any",
			),
		);
	}
	return mergePropertySurfaces(composed, "union", "all");
}

type SchemaPrimitive =
	| "array"
	| "boolean"
	| "integer"
	| "null"
	| "number"
	| "object"
	| "string";

function primitiveOf(value: unknown): SchemaPrimitive | undefined {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	switch (typeof value) {
		case "boolean":
			return "boolean";
		case "number":
			return "number";
		case "string":
			return "string";
		case "object":
			return "object";
		default:
			return undefined;
	}
}

function schemaTypes(
	schema: JsonSchemaObject,
	contract: NormalizedContractSchema,
): ReadonlySet<SchemaPrimitive> {
	const resolved = resolveSchema(schema, contract);
	const types = new Set<SchemaPrimitive>();
	const type = resolved["type"];
	if (typeof type === "string") {
		types.add(type as SchemaPrimitive);
	} else if (Array.isArray(type)) {
		for (const item of type) {
			if (typeof item === "string") types.add(item as SchemaPrimitive);
		}
	}
	if ("const" in resolved) {
		const primitive = primitiveOf(resolved["const"]);
		if (primitive !== undefined) types.add(primitive);
	}
	const enumValues = resolved["enum"];
	if (Array.isArray(enumValues)) {
		for (const item of enumValues) {
			const primitive = primitiveOf(item);
			if (primitive !== undefined) types.add(primitive);
		}
	}
	for (const keyword of ["anyOf", "oneOf"] as const) {
		for (const branch of schemaBranches(resolved, keyword)) {
			for (const branchType of schemaTypes(branch, contract)) {
				types.add(branchType);
			}
		}
	}
	const allOfTypes = schemaBranches(resolved, "allOf")
		.map((branch) => schemaTypes(branch, contract))
		.filter((branchTypes) => branchTypes.size > 0);
	if (allOfTypes.length > 0) {
		for (const candidate of allOfTypes[0] ?? []) {
			if (allOfTypes.every((branchTypes) => branchTypes.has(candidate))) {
				types.add(candidate);
			}
		}
	}
	return types;
}

function schemaLiterals(
	schema: JsonSchemaObject,
	contract: NormalizedContractSchema,
): ReadonlySet<string> | undefined {
	const resolved = resolveSchema(schema, contract);
	if ("const" in resolved) {
		return new Set([JSON.stringify(resolved["const"])]);
	}
	if (Array.isArray(resolved["enum"])) {
		return new Set(resolved["enum"].map((value) => JSON.stringify(value)));
	}
	const alternatives = [
		...schemaBranches(resolved, "anyOf"),
		...schemaBranches(resolved, "oneOf"),
	];
	if (alternatives.length === 0) return undefined;
	const branchLiterals = alternatives.map((branch) =>
		schemaLiterals(branch, contract),
	);
	if (branchLiterals.some((literals) => literals === undefined)) {
		return undefined;
	}
	return new Set(branchLiterals.flatMap((literals) => [...(literals ?? [])]));
}

function typeIsAccepted(
	actual: SchemaPrimitive,
	expected: ReadonlySet<SchemaPrimitive>,
): boolean {
	return (
		expected.has(actual) ||
		(actual === "integer" && expected.has("number"))
	);
}

function assertSubset(
	operationId: string,
	direction: "input" | "output",
	property: string,
	label: string,
	subset: ReadonlySet<string>,
	superset: ReadonlySet<string>,
): void {
	const missing = [...subset].filter((value) => !superset.has(value));
	if (missing.length > 0) {
		throw new TypeError(
			`Runtime operation ${operationId} ${direction} ${property} ${label} drifted: ${missing.join(", ")}`,
		);
	}
}

function schemaItems(
	schemas: readonly JsonSchemaObject[],
	contract: NormalizedContractSchema,
): readonly JsonSchemaObject[] {
	return schemas.flatMap((schema) => {
		const resolved = resolveSchema(schema, contract);
		const directItems = resolved["items"];
		const alternatives = [
			...schemaBranches(resolved, "anyOf"),
			...schemaBranches(resolved, "oneOf"),
		];
		return [
			...(isSchemaObject(directItems) ? [directItems] : []),
			...schemaItems(alternatives, contract),
		];
	});
}

function scalarConstraint(
	schema: JsonSchemaObject,
	key: "format",
): string | undefined {
	const value = schema[key];
	return typeof value === "string" ? value : undefined;
}

interface NumericBound {
	value: number;
	inclusive: boolean;
}

function lowerBound(schema: JsonSchemaObject): NumericBound | undefined {
	const minimum = schema["minimum"];
	if (typeof minimum === "number") {
		return { value: minimum, inclusive: true };
	}
	const exclusiveMinimum = schema["exclusiveMinimum"];
	return typeof exclusiveMinimum === "number"
		? { value: exclusiveMinimum, inclusive: false }
		: undefined;
}

function upperBound(schema: JsonSchemaObject): NumericBound | undefined {
	const maximum = schema["maximum"];
	if (typeof maximum === "number") {
		return { value: maximum, inclusive: true };
	}
	const exclusiveMaximum = schema["exclusiveMaximum"];
	return typeof exclusiveMaximum === "number"
		? { value: exclusiveMaximum, inclusive: false }
		: undefined;
}

function normalizeIntegerLower(
	bound: NumericBound | undefined,
): NumericBound | undefined {
	if (bound === undefined) return undefined;
	return {
		value: bound.inclusive
			? Math.ceil(bound.value)
			: Math.floor(bound.value) + 1,
		inclusive: true,
	};
}

function normalizeIntegerUpper(
	bound: NumericBound | undefined,
): NumericBound | undefined {
	if (bound === undefined) return undefined;
	return {
		value: bound.inclusive
			? Math.floor(bound.value)
			: Math.ceil(bound.value) - 1,
		inclusive: true,
	};
}

function lowerBoundContains(
	actual: NumericBound | undefined,
	accepted: NumericBound,
): boolean {
	if (actual === undefined || actual.value < accepted.value) return false;
	if (actual.value > accepted.value) return true;
	return accepted.inclusive || !actual.inclusive;
}

function upperBoundContains(
	actual: NumericBound | undefined,
	accepted: NumericBound,
): boolean {
	if (actual === undefined || actual.value > accepted.value) return false;
	if (actual.value < accepted.value) return true;
	return accepted.inclusive || !actual.inclusive;
}

function assertScalarCompatibility(
	operationId: string,
	direction: "input" | "output",
	path: string,
	productSchemas: readonly JsonSchemaObject[],
	productContract: NormalizedContractSchema,
	runtimeSchemas: readonly JsonSchemaObject[],
	runtimeContract: NormalizedContractSchema,
): void {
	if (productSchemas.length !== 1 || runtimeSchemas.length !== 1) return;
	const product = resolveSchema(productSchemas[0]!, productContract);
	const runtime = resolveSchema(runtimeSchemas[0]!, runtimeContract);
	const actual = direction === "input" ? product : runtime;
	const accepted = direction === "input" ? runtime : product;
	const actualIsInteger = schemaTypes(
		actual,
		direction === "input" ? productContract : runtimeContract,
	).has("integer");
	const acceptedIsInteger = schemaTypes(
		accepted,
		direction === "input" ? runtimeContract : productContract,
	).has("integer");

	const acceptedFormat = scalarConstraint(accepted, "format");
	if (
		direction === "output" &&
		acceptedFormat !== undefined &&
		scalarConstraint(actual, "format") !== acceptedFormat
	) {
		throw new TypeError(
			`Runtime operation ${operationId} ${direction} ${path} format drifted`,
		);
	}
	const actualLower = actualIsInteger
		? normalizeIntegerLower(lowerBound(actual))
		: lowerBound(actual);
	const acceptedLower = acceptedIsInteger
		? normalizeIntegerLower(lowerBound(accepted))
		: lowerBound(accepted);
	if (
		acceptedLower !== undefined &&
		!lowerBoundContains(actualLower, acceptedLower)
	) {
		throw new TypeError(
			`Runtime operation ${operationId} ${direction} ${path} minimum drifted`,
		);
	}
	const actualUpper = actualIsInteger
		? normalizeIntegerUpper(upperBound(actual))
		: upperBound(actual);
	const acceptedUpper = acceptedIsInteger
		? normalizeIntegerUpper(upperBound(accepted))
		: upperBound(accepted);
	if (
		acceptedUpper !== undefined &&
		!upperBoundContains(actualUpper, acceptedUpper)
	) {
		throw new TypeError(
			`Runtime operation ${operationId} ${direction} ${path} maximum drifted`,
		);
	}
}

function assertObjectCompatibility(
	operationId: string,
	direction: "input" | "output",
	path: string,
	product: ObjectSurface,
	productContract: NormalizedContractSchema,
	runtime: ObjectSurface,
	runtimeContract: NormalizedContractSchema,
	depth: number,
): void {
	if (direction === "input") {
		if (product.additionalProperties && !runtime.additionalProperties) {
			throw new TypeError(
				`Runtime operation ${operationId} ${direction} ${path} rejects additional properties allowed by the TypeScript contract`,
			);
		}
		const unsupported = [...product.properties.keys()].filter(
			(property) =>
				!runtime.properties.has(property) && !runtime.additionalProperties,
		);
		if (unsupported.length > 0) {
			throw new TypeError(
				`Runtime operation ${operationId} ${direction} ${path} properties missing from runtime: ${unsupported.join(", ")}`,
			);
		}
		assertSubset(
			operationId,
			direction,
			path,
			"required fields not required by the TypeScript contract",
			runtime.required,
			product.required,
		);
	} else {
		if (runtime.additionalProperties && !product.additionalProperties) {
			throw new TypeError(
				`Runtime operation ${operationId} ${direction} ${path} permits additional properties rejected by the TypeScript contract`,
			);
		}
		const unsupported = [...runtime.properties.keys()].filter(
			(property) =>
				!product.properties.has(property) && !product.additionalProperties,
		);
		if (unsupported.length > 0) {
			throw new TypeError(
				`Runtime operation ${operationId} ${direction} ${path} properties missing from TypeScript contract: ${unsupported.join(", ")}`,
			);
		}
		assertSubset(
			operationId,
			direction,
			path,
			"required fields not guaranteed by runtime",
			product.required,
			runtime.required,
		);
	}

	for (const [property, productSchemas] of product.properties) {
		const runtimeSchemas = runtime.properties.get(property);
		if (runtimeSchemas === undefined) continue;
		assertSchemaCompatibility(
			operationId,
			direction,
			path === "<root>" ? property : `${path}.${property}`,
			productSchemas,
			productContract,
			runtimeSchemas,
			runtimeContract,
			depth + 1,
		);
	}
}

function assertSchemaCompatibility(
	operationId: string,
	direction: "input" | "output",
	path: string,
	productSchemas: readonly JsonSchemaObject[],
	productContract: NormalizedContractSchema,
	runtimeSchemas: readonly JsonSchemaObject[],
	runtimeContract: NormalizedContractSchema,
	depth: number,
): void {
	if (depth > 32) {
		throw new TypeError(
			`Runtime operation ${operationId} ${direction} ${path} contract nesting exceeds 32 levels`,
		);
	}
	const productTypes = new Set(
		productSchemas.flatMap((schema) => [
			...schemaTypes(schema, productContract),
		]),
	);
	const runtimeTypes = new Set(
		runtimeSchemas.flatMap((schema) => [
			...schemaTypes(schema, runtimeContract),
		]),
	);
	const actualTypes = direction === "input" ? productTypes : runtimeTypes;
	const acceptedTypes = direction === "input" ? runtimeTypes : productTypes;
	if (actualTypes.size > 0 && acceptedTypes.size > 0) {
		const invalid = [...actualTypes].filter(
			(actual) => !typeIsAccepted(actual, acceptedTypes),
		);
		if (invalid.length > 0) {
			throw new TypeError(
				`Runtime operation ${operationId} ${direction} ${path} primitive types drifted: ${invalid.join(", ")}`,
			);
		}
	}

	const productLiterals = new Set(
		productSchemas.flatMap((schema) => [
			...(schemaLiterals(schema, productContract) ?? []),
		]),
	);
	const runtimeLiterals = new Set(
		runtimeSchemas.flatMap((schema) => [
			...(schemaLiterals(schema, runtimeContract) ?? []),
		]),
	);
	if (productLiterals.size > 0 && runtimeLiterals.size > 0) {
		assertSubset(
			operationId,
			direction,
			path,
			"literal values drifted",
			direction === "input" ? productLiterals : runtimeLiterals,
			direction === "input" ? runtimeLiterals : productLiterals,
		);
	}

	assertScalarCompatibility(
		operationId,
		direction,
		path,
		productSchemas,
		productContract,
		runtimeSchemas,
		runtimeContract,
	);

	if (productTypes.has("object") && runtimeTypes.has("object")) {
		assertObjectCompatibility(
			operationId,
			direction,
			path,
			mergePropertySurfaces(
				productSchemas.map((schema) => objectSurface(schema, productContract)),
				"union",
				"any",
			),
			productContract,
			mergePropertySurfaces(
				runtimeSchemas.map((schema) => objectSurface(schema, runtimeContract)),
				"union",
				"any",
			),
			runtimeContract,
			depth,
		);
	}

	if (productTypes.has("array") && runtimeTypes.has("array")) {
		const productItems = schemaItems(productSchemas, productContract);
		const runtimeItems = schemaItems(runtimeSchemas, runtimeContract);
		if (productItems.length > 0 && runtimeItems.length > 0) {
			assertSchemaCompatibility(
				operationId,
				direction,
				`${path}[]`,
				productItems,
				productContract,
				runtimeItems,
				runtimeContract,
				depth + 1,
			);
		}
	}
}

/**
 * Assert that a TypeScript-authored product contract remains compatible with
 * the normalized Zod boundary exposed by CLI and MCP.
 *
 * Input contracts may intentionally be narrower than the coercing runtime
 * schema, while runtime outputs may be narrower than the product contract.
 * References and object unions are flattened before recursively comparing
 * closed/open object surfaces, required fields, primitive and literal sets,
 * numeric bounds, array items, and output formats.
 */
export function assertTypeScriptContractCompatibility(
	operationId: string,
	direction: "input" | "output",
	contract: NormalizedContractSchema,
	runtimeSchema: JsonSchemaObject,
): void {
	const product = objectSurface(contract.schema, contract);
	const runtimeContract: NormalizedContractSchema = {
		dialect: "openapi-3.1",
		stage: "normalized",
		source: "runtime-operation",
		schema: runtimeSchema,
		components: {},
	};
	const runtime = objectSurface(runtimeSchema, runtimeContract);

	assertObjectCompatibility(
		operationId,
		direction,
		"<root>",
		product,
		contract,
		runtime,
		runtimeContract,
		0,
	);
}
