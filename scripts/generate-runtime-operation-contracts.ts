import { resolve } from "node:path";
import { runtimeOperationContractIds } from "../packages/operations/src/specs/runtime-contract-ids";

const runtimeContractCapture = Symbol.for(
	"@listmonk-ops/operations/specs:runtime-contract-capture",
);
Reflect.set(globalThis, runtimeContractCapture, true);
const { sharedOperationCatalog } = await import(
	"./check-operation-spec-coverage"
).finally(() => {
	Reflect.deleteProperty(globalThis, runtimeContractCapture);
});

const outputPath = resolve(
	import.meta.dir,
	"../packages/operations/src/specs/generated/runtime-operation-contracts.json",
);
const checkOnly = Bun.argv.includes("--check");

function stableValue(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stableValue);
	}
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([, nested]) => nested !== undefined)
				.sort(([left], [right]) =>
					left < right ? -1 : left > right ? 1 : 0,
				)
				.map(([key, nested]) => [key, stableValue(nested)]),
		);
	}
	return value;
}

function normalizedContract(schema: Readonly<Record<string, unknown>>) {
	const { $schema: _schemaDialect, ...normalizedSchema } = schema;
	return {
		dialect: "openapi-3.1" as const,
		stage: "normalized" as const,
		source: "runtime-operation" as const,
		schema: stableValue(normalizedSchema),
		components: {},
	};
}

const contracts = Object.fromEntries(
	[...sharedOperationCatalog.entries]
		.filter(({ operation }) =>
			runtimeOperationContractIds.includes(
				operation.id as (typeof runtimeOperationContractIds)[number],
			),
		)
		.sort((left, right) =>
			left.operation.id.localeCompare(right.operation.id),
		)
		.map(({ operation }) => [
			operation.id,
			{
				input: normalizedContract(operation.inputJsonSchema),
				output: normalizedContract(operation.outputJsonSchema),
			},
		]),
);
const generatedIds = Object.keys(contracts);
if (
	generatedIds.length !== runtimeOperationContractIds.length ||
	runtimeOperationContractIds.some((operationId) => !(operationId in contracts))
) {
	throw new Error(
		"Runtime operation contract IDs must resolve to exactly one shared operation each.",
	);
}
const expected = `${JSON.stringify(stableValue(contracts), null, 2)}\n`;
const current = await Bun.file(outputPath).text().catch(() => undefined);

if (checkOnly) {
	if (current !== expected) {
		throw new Error(
			"Generated runtime operation contracts are stale. Run `bun run operations:specs:generate`.",
		);
	}
} else {
	await Bun.write(outputPath, expected);
}
