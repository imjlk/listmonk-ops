export type NormalizedJsonSchema = Readonly<Record<string, unknown>>;

export type NormalizedContractSchema = Readonly<{
	dialect: "openapi-3.1";
	stage: "normalized";
	/**
	 * `typescript` contracts are authored as product-domain TypeScript types
	 * and projected with Typia. `runtime-operation` contracts are a committed
	 * bridge snapshot of the shared operation boundary while that contract is
	 * being promoted to a standalone product-domain type.
	 */
	source: "typescript" | "runtime-operation";
	schema: NormalizedJsonSchema;
	components: NormalizedJsonSchema;
}>;

export function cloneSpecValue<T>(value: T): T {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new TypeError("Operations spec values must be JSON-serializable");
	}
	return JSON.parse(serialized) as T;
}
