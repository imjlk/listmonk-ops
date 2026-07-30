import { resolve } from "node:path";
import { runtimeOperationContractIds } from "../packages/operations/src/specs/runtime-contract-ids";
import { stableValue } from "../packages/operations/src/specs/stable-json.js";
import { sharedOperationCatalogs } from "./shared-operation-catalogs";

const outputPath = resolve(
	import.meta.dir,
	"../packages/operations/src/specs/generated/runtime-operation-contracts.json",
);
const checkOnly = Bun.argv.includes("--check");

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
	sharedOperationCatalogs
		.flatMap((catalog) => catalog.operations)
		.filter((operation) =>
			runtimeOperationContractIds.includes(
				operation.id as (typeof runtimeOperationContractIds)[number],
			),
		)
		.sort((left, right) => left.id.localeCompare(right.id))
		.map((operation) => [
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
		const expectedLines = expected.split("\n");
		const currentLines = (current ?? "").split("\n");
		const firstDifferentLine = expectedLines.findIndex(
			(line, index) => line !== currentLines[index],
		);
		const lineNumber =
			firstDifferentLine === -1
				? Math.min(expectedLines.length, currentLines.length) + 1
				: firstDifferentLine + 1;
		throw new Error(
			`Generated runtime operation contracts are stale at line ${lineNumber}. Expected ${JSON.stringify(expectedLines[lineNumber - 1] ?? "<end of file>")}, received ${JSON.stringify(currentLines[lineNumber - 1] ?? "<end of file>")}. Run \`bun run operations:specs:runtime-contracts:generate && bun run operations:specs:generate\`.`,
		);
	}
} else {
	await Bun.write(outputPath, expected);
}
