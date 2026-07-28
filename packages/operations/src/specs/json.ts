export type NormalizedJsonSchema = Readonly<Record<string, unknown>>;

export type NormalizedContractSchema = Readonly<{
	dialect: "openapi-3.1";
	stage: "normalized";
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
