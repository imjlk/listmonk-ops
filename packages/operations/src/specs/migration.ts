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

function assertNonBlank(value: string, label: string): void {
	if (value.trim().length === 0) {
		throw new TypeError(`${label} must not be blank`);
	}
}

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
		assertNonBlank(
			exemption.reason,
			`Operation spec migration exemption ${exemption.operationId} reason`,
		);
		assertNonBlank(
			exemption.targetPhase,
			`Operation spec migration exemption ${exemption.operationId} target phase`,
		);
		if (parseOperationSpecMigrationExpiry(exemption.expiresOn) === undefined) {
			throw new TypeError(
				`Operation spec migration exemption ${exemption.operationId} has invalid expiresOn date ${exemption.expiresOn}`,
			);
		}
	}
	return exemptions;
}

function familyExemptions(options: {
	operationIds: readonly OperationId[];
	owner: OperationSpecMigrationOwner;
	reason: string;
	targetPhase: string;
	expiresOn: `${number}-${number}-${number}`;
}): readonly OperationSpecMigrationExemption[] {
	return options.operationIds.map((operationId) => ({
		operationId,
		owner: options.owner,
		reason: options.reason,
		targetPhase: options.targetPhase,
		expiresOn: options.expiresOn,
	}));
}

/**
 * Temporary, explicit allowlist for shared operations that have not yet
 * migrated to an OperationSpec descriptor. The coverage gate rejects missing,
 * dangling, duplicate, spec-covered, and expired exemptions.
 */
export const operationSpecMigrationExemptions =
	defineOperationSpecMigrationExemptions([
		...familyExemptions({
			operationIds: [
				"lists.list",
				"lists.get",
				"lists.create",
				"lists.update",
				"lists.delete",
			],
			owner: "operations",
			reason:
				"Subscriber-list CRUD is lower risk than delivery and suppression; migrate it as one coherent resource contract.",
			targetPhase: "resource-crud",
			expiresOn: "2027-03-31",
		}),
		...familyExemptions({
			operationIds: [
				"subscribers.list",
				"subscribers.get",
				"subscribers.create",
				"subscribers.update",
				"subscribers.delete",
				"subscribers.add-to-lists",
				"subscribers.remove-from-lists",
				"subscribers.unblocklist",
			],
			owner: "operations",
			reason:
				"Subscriber CRUD and list-membership operations will migrate together around the existing typed blocklist contract.",
			targetPhase: "subscriber-lifecycle",
			expiresOn: "2027-03-31",
		}),
		...familyExemptions({
			operationIds: [
				"campaigns.list",
				"campaigns.create",
				"campaigns.update",
				"campaigns.delete",
				"campaigns.pause",
				"campaigns.clone",
				"campaigns.stats",
			],
			owner: "operations",
			reason:
				"Remaining campaign CRUD and observability operations will migrate after the high-risk lifecycle contracts stabilize.",
			targetPhase: "campaign-resource-and-observability",
			expiresOn: "2027-03-31",
		}),
		...familyExemptions({
			operationIds: [
				"templates.list",
				"templates.get",
				"templates.create",
				"templates.update",
				"templates.delete",
				"templates.set-default",
			],
			owner: "operations",
			reason:
				"Template operations need a shared content/version resource model before descriptor migration.",
			targetPhase: "templates-and-media",
			expiresOn: "2027-03-31",
		}),
		...familyExemptions({
			operationIds: [
				"media.list",
				"media.get",
				"media.delete",
				"media.upload",
			],
			owner: "operations",
			reason:
				"Media operations will migrate with template content references and upload side-effect policy.",
			targetPhase: "templates-and-media",
			expiresOn: "2027-03-31",
		}),
		...familyExemptions({
			operationIds: [
				"ops.campaign.deliverability-guard",
				"ops.subscribers.hygiene",
				"ops.segments.drift",
				"ops.templates.registry-sync",
				"ops.templates.registry-history",
				"ops.templates.registry-promote",
				"ops.templates.registry-rollback",
				"ops.digest.daily",
			],
			owner: "automation",
			reason:
				"Automation workflows require multi-effect and local-persistence descriptors beyond the single-operation pilot.",
			targetPhase: "automation-workflows",
			expiresOn: "2027-06-30",
		}),
		...familyExemptions({
			operationIds: [
				"abtest.list",
				"abtest.get",
				"abtest.create",
				"abtest.analyze",
				"abtest.launch",
				"abtest.stop",
				"abtest.delete",
				"abtest.recommend-sample-size",
				"abtest.deploy-winner",
				"abtest.run",
				"abtest.tick",
				"abtest.reconcile",
				"abtest.export-assignment",
			],
			owner: "abtest",
			reason:
				"A/B test operations will migrate as one experiment state machine so lifecycle and statistical invariants remain coherent.",
			targetPhase: "experiment-state-machine",
			expiresOn: "2027-09-30",
		}),
	]);

function migrationExemptionsForPrefix(
	prefix: string,
): readonly OperationSpecMigrationExemption[] {
	return operationSpecMigrationExemptions.filter(({ operationId }) =>
		operationId.startsWith(prefix),
	);
}

export const operationSpecMigrationExemptionsByFamily = {
	lists: migrationExemptionsForPrefix("lists."),
	subscribers: migrationExemptionsForPrefix("subscribers."),
	campaigns: migrationExemptionsForPrefix("campaigns."),
	templates: migrationExemptionsForPrefix("templates."),
	media: migrationExemptionsForPrefix("media."),
	transactional: migrationExemptionsForPrefix("transactional."),
	ops: migrationExemptionsForPrefix("ops."),
	abtest: migrationExemptionsForPrefix("abtest."),
} as const;

export function bindOperationSpecMigrationExemption(
	operationId: OperationSpecMigrationExemption["operationId"],
): OperationSpecMigrationExemption {
	const exemption = operationSpecMigrationExemptions.find(
		(candidate) => candidate.operationId === operationId,
	);
	if (exemption === undefined) {
		throw new TypeError(
			`Missing operation spec migration exemption for ${operationId}`,
		);
	}
	return exemption;
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
