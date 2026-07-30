import { resolve } from "node:path";
import {
	emailOperationsSpec,
	operationSpecMigrationExemptions,
	runtimeOperationContractIds,
} from "../src/specs";

const bridgedIds = new Set<string>(runtimeOperationContractIds);
const runtimeContractSpecIds = new Set(
	emailOperationsSpec.operations
		.filter(
			(operation) =>
				operation.contract.input.source === "runtime-operation" ||
				operation.contract.output.source === "runtime-operation",
		)
		.map((operation) => operation.id),
);
const failures: string[] = [];

for (const operationId of bridgedIds) {
	if (!runtimeContractSpecIds.has(operationId)) {
		failures.push(
			`${operationId} is declared as a runtime contract bridge but its spec does not use that source`,
		);
	}
}
for (const operation of emailOperationsSpec.operations) {
	if (
		runtimeContractSpecIds.has(operation.id) &&
		!bridgedIds.has(operation.id)
	) {
		failures.push(
			`${operation.id} uses a runtime contract without a governed bridge declaration`,
		);
	}
	if (
		runtimeContractSpecIds.has(operation.id) &&
		operation.stability !== "experimental"
	) {
		failures.push(
			`${operation.id} must remain experimental while it uses a runtime operation contract`,
		);
	}
}
if (operationSpecMigrationExemptions.length !== 0) {
	failures.push(
		"Public shared operations must not rely on migration exemptions",
	);
}

const sourceRoot = resolve(import.meta.dir, "../src/specs");
const sourcePaths = [
	...(await Array.fromAsync(
		new Bun.Glob("**/*.ts").scan({
			cwd: sourceRoot,
			absolute: true,
		}),
	)),
	resolve(import.meta.dir, "spec-contracts.ts"),
];
const forbiddenImport =
	/from\s+["'][^"']*(?:@listmonk-ops\/openapi|openapi\/generated|generated\/sdk)[^"']*["']/;
for (const sourcePath of sourcePaths) {
	const source = await Bun.file(sourcePath).text();
	if (forbiddenImport.test(source)) {
		failures.push(
			`${sourcePath} imports a transport or generated Listmonk API contract`,
		);
	}
}

if (failures.length > 0) {
	throw new Error(
		`Operations spec governance failed:\n${failures
			.map((failure) => `- ${failure}`)
			.join("\n")}`,
	);
}

console.log(
	`Operations spec governance: ${emailOperationsSpec.operations.length} operations, ${runtimeContractSpecIds.size} experimental runtime bridges, ${emailOperationsSpec.operations.filter((operation) => operation.stability === "stable").length} stable TypeScript contracts, 0 public migration exemptions.`,
);
