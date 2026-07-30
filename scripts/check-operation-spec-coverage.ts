import { composeOperationCatalogs } from "../packages/operations/src";
import {
	assertOperationSpecCoverage,
	emailOperationsSpec,
	operationSpecMigrationExemptions,
	type OperationSpecCoverageReport,
} from "../packages/operations/src/specs";
import { sharedOperationCatalogs } from "./shared-operation-catalogs";

export const sharedOperationCatalog = composeOperationCatalogs(
	sharedOperationCatalogs,
);

export function checkOperationSpecCoverage(
	now?: Date,
): OperationSpecCoverageReport {
	return assertOperationSpecCoverage({
		operations: sharedOperationCatalog.entries.map(
			({ operation }) => operation,
		),
		declaredSpecs: emailOperationsSpec.operations,
		exemptions: operationSpecMigrationExemptions,
		now,
	});
}

if (import.meta.main) {
	const report = checkOperationSpecCoverage();
	console.log(
		`Operation spec migration coverage: ${report.covered}/${report.total} described, ${report.exempted} explicitly exempted (${(report.coverageRatio * 100).toFixed(1)}%).`,
	);
}
