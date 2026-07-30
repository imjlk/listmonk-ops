import type { OperationId } from "./retry";

export type OperationSpecMigrationOwner =
	| "operations"
	| "automation"
	| "abtest";

export interface OperationSpecMigrationExemption {
	operationId: OperationId;
	owner: OperationSpecMigrationOwner;
	reason: string;
	targetPhase: string;
	expiresOn: `${number}-${number}-${number}`;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseOperationSpecMigrationExpiry(
	expiresOn: string,
): number | undefined {
	if (!ISO_DATE_PATTERN.test(expiresOn)) {
		return undefined;
	}
	const [year, month, day] = expiresOn
		.split("-")
		.map((part) => Number(part));
	const startOfDay = new Date(`${expiresOn}T00:00:00.000Z`);
	if (
		Number.isNaN(startOfDay.getTime()) ||
		startOfDay.getUTCFullYear() !== year ||
		startOfDay.getUTCMonth() + 1 !== month ||
		startOfDay.getUTCDate() !== day
	) {
		return undefined;
	}
	return startOfDay.getTime() + 86_399_999;
}

export type OperationSpecMigrationExpiryStatus =
	| { kind: "active"; expiresAt: number }
	| { kind: "expired"; expiresAt: number }
	| { kind: "invalid" };

export function inspectOperationSpecMigrationExpiry(
	expiresOn: string,
	now = new Date(),
): OperationSpecMigrationExpiryStatus {
	const expiresAt = parseOperationSpecMigrationExpiry(expiresOn);
	if (expiresAt === undefined) {
		return { kind: "invalid" };
	}
	return expiresAt < now.getTime()
		? { kind: "expired", expiresAt }
		: { kind: "active", expiresAt };
}

export function defineOperationSpecMigrationExemptions<
	const Exemptions extends readonly OperationSpecMigrationExemption[],
>(exemptions: Exemptions): Exemptions {
	const operationIds = new Set<string>();
	for (const exemption of exemptions) {
		if (operationIds.has(exemption.operationId)) {
			throw new TypeError(
				`Duplicate operation spec migration exemption: ${exemption.operationId}`,
			);
		}
		operationIds.add(exemption.operationId);
		if (
			exemption.reason.trim().length === 0 ||
			exemption.targetPhase.trim().length === 0
		) {
			throw new TypeError(
				`Operation spec migration exemption ${exemption.operationId} must explain its reason and target phase`,
			);
		}
		if (parseOperationSpecMigrationExpiry(exemption.expiresOn) === undefined) {
			throw new TypeError(
				`Operation spec migration exemption ${exemption.operationId} has invalid expiresOn date ${exemption.expiresOn}`,
			);
		}
	}
	return exemptions;
}

/**
 * Public CLI and MCP operations have complete specs. This empty manifest
 * remains as an explicit extension point for a future internal-only migration,
 * which would still require an owner, reason, target phase, and expiry.
 */
export const operationSpecMigrationExemptions =
	defineOperationSpecMigrationExemptions([]);

export const operationSpecMigrationExemptionsByFamily = {
	lists: [],
	subscribers: [],
	campaigns: [],
	templates: [],
	media: [],
	transactional: [],
	ops: [],
	abtest: [],
} as const;

export function bindOperationSpecMigrationExemption(
	operationId: OperationId,
): OperationSpecMigrationExemption {
	throw new TypeError(
		`No active operation spec migration exemption exists for ${operationId}`,
	);
}

export function assertOperationSpecMigrationExemptionActive(
	exemption: OperationSpecMigrationExemption,
	now = new Date(),
): void {
	const expiry = inspectOperationSpecMigrationExpiry(exemption.expiresOn, now);
	if (expiry.kind === "invalid") {
		throw new TypeError(
			`Operation spec migration exemption ${exemption.operationId} has invalid expiresOn date ${exemption.expiresOn}`,
		);
	}
	if (expiry.kind === "expired") {
		throw new TypeError(
			`Operation spec migration exemption ${exemption.operationId} expired on ${exemption.expiresOn}`,
		);
	}
}
