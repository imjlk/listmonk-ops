import { abTestOperationCatalog } from "../packages/abtest/src/operations";
import { opsOperationCatalog } from "../packages/automation/src/ops-operations";
import {
	campaignOperationCatalog,
	composeOperationCatalogs,
	listOperationCatalog,
	mediaOperationCatalog,
	subscriberOperationCatalog,
	templateOperationCatalog,
	transactionalOperationCatalog,
} from "../packages/operations/src";
import {
	assertOperationSpecCoverage,
	emailOperationsSpec,
	operationSpecMigrationExemptions,
	type OperationSpecCoverageReport,
} from "../packages/operations/src/specs";

export const sharedOperationCatalog = composeOperationCatalogs([
	listOperationCatalog,
	subscriberOperationCatalog,
	campaignOperationCatalog,
	templateOperationCatalog,
	mediaOperationCatalog,
	transactionalOperationCatalog,
	opsOperationCatalog,
	abTestOperationCatalog,
]);

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
