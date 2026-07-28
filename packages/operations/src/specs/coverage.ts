import type { AnyOperationSpec } from "./operation";
import {
	inspectOperationSpecMigrationExpiry,
	type OperationSpecMigrationExemption,
} from "./migration";

export interface OperationSpecCoverageSubject {
	id: string;
	spec?: AnyOperationSpec | undefined;
	specMigration?: OperationSpecMigrationExemption | undefined;
}

export interface OperationSpecCoverageReport {
	total: number;
	covered: number;
	exempted: number;
	coverageRatio: number;
}

export interface OperationSpecCoverageOptions {
	operations: readonly OperationSpecCoverageSubject[];
	declaredSpecs: readonly AnyOperationSpec[];
	exemptions: readonly OperationSpecMigrationExemption[];
	now?: Date | undefined;
}

function exemptionsMatch(
	left: OperationSpecMigrationExemption,
	right: OperationSpecMigrationExemption,
): boolean {
	return (
		left.operationId === right.operationId &&
		left.owner === right.owner &&
		left.reason === right.reason &&
		left.targetPhase === right.targetPhase &&
		left.expiresOn === right.expiresOn
	);
}

export function assertOperationSpecCoverage({
	operations,
	declaredSpecs,
	exemptions,
	now = new Date(),
}: OperationSpecCoverageOptions): OperationSpecCoverageReport {
	const failures: string[] = [];
	const operationIds = new Set<string>();
	const operationsById = new Map<string, OperationSpecCoverageSubject>();
	const declaredSpecsById = new Map<string, AnyOperationSpec>();
	const exemptionsById = new Map<
		string,
		OperationSpecMigrationExemption
	>();
	for (const spec of declaredSpecs) {
		if (declaredSpecsById.has(spec.id)) {
			failures.push(`duplicate declared operation spec ${spec.id}`);
		}
		declaredSpecsById.set(spec.id, spec);
	}
	for (const exemption of exemptions) {
		if (exemptionsById.has(exemption.operationId)) {
			failures.push(
				`duplicate operation spec migration exemption ${exemption.operationId}`,
			);
		}
		exemptionsById.set(exemption.operationId, exemption);
	}

	for (const operation of operations) {
		if (operationIds.has(operation.id)) {
			failures.push(`duplicate shared operation ${operation.id}`);
		}
		operationIds.add(operation.id);
		operationsById.set(operation.id, operation);
		const exemption = exemptionsById.get(operation.id);
		if (operation.spec !== undefined) {
			if (operation.spec.id !== operation.id) {
				failures.push(
					`${operation.id} binds mismatched descriptor ${operation.spec.id}`,
				);
			}
			if (!declaredSpecsById.has(operation.id)) {
				failures.push(
					`${operation.id} binds a descriptor that is absent from the aggregate operations spec`,
				);
			}
			if (exemption !== undefined) {
				failures.push(
					`${operation.id} has both a descriptor and a migration exemption`,
				);
			}
			continue;
		}
		if (exemption === undefined) {
			failures.push(
				`${operation.id} has neither an OperationSpec descriptor nor a migration exemption`,
			);
			continue;
		}
		if (operation.specMigration === undefined) {
			failures.push(
				`${operation.id} has an exemption manifest entry but does not bind it at runtime`,
			);
		} else if (!exemptionsMatch(operation.specMigration, exemption)) {
			failures.push(
				`${operation.id} runtime migration exemption drifted from the manifest`,
			);
		}
		const expiry = inspectOperationSpecMigrationExpiry(
			exemption.expiresOn,
			now,
		);
		if (expiry.kind === "invalid") {
			failures.push(
				`${operation.id} migration exemption has invalid expiresOn date ${exemption.expiresOn}`,
			);
		} else if (expiry.kind === "expired") {
			failures.push(
				`${operation.id} migration exemption expired on ${exemption.expiresOn}`,
			);
		}
	}

	for (const spec of declaredSpecs) {
		const operation = operationsById.get(spec.id);
		if (operation === undefined) {
			failures.push(`${spec.id} descriptor has no shared runtime operation`);
		} else if (operation.spec === undefined) {
			failures.push(
				`${spec.id} descriptor is declared but not bound to its shared runtime operation`,
			);
		}
	}
	for (const exemption of exemptions) {
		if (!operationIds.has(exemption.operationId)) {
			failures.push(
				`${exemption.operationId} migration exemption has no shared runtime operation`,
			);
		}
	}

	if (failures.length > 0) {
		throw new Error(
			`Operation spec migration coverage failed:\n${failures
				.map((failure) => `- ${failure}`)
				.join("\n")}`,
		);
	}

	const covered = operations.filter(
		(operation) => operation.spec !== undefined,
	).length;
	const exempted = operations.length - covered;
	return {
		total: operations.length,
		covered,
		exempted,
		coverageRatio: operations.length === 0 ? 1 : covered / operations.length,
	};
}
