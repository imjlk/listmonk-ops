export type ProductJsonSchema = Readonly<Record<string, unknown>>;

export type ProductContractSchema = Readonly<{
	dialect: "openapi-3.1";
	stage: "normalized";
	schema: ProductJsonSchema;
	components: ProductJsonSchema;
}>;

export function cloneProductValue<T>(value: T): T {
	const serialized = JSON.stringify(value);
	if (serialized === undefined) {
		throw new TypeError("Product schema values must be JSON-serializable");
	}
	return JSON.parse(serialized) as T;
}
