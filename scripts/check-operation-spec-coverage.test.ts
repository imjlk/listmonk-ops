import { describe, expect, test } from "bun:test";
import {
	assertOperationSpecCoverage,
	campaignGetOperationSpec,
	type OperationSpecMigrationExemption,
} from "../packages/operations/src/specs";
import {
	checkOperationSpecCoverage,
	sharedOperationCatalog,
} from "./check-operation-spec-coverage";

const futureExemption = {
	operationId: "campaigns.list",
	owner: "operations",
	reason: "Fixture migration is intentionally pending.",
	targetPhase: "fixture",
	expiresOn: "2099-12-31",
} satisfies OperationSpecMigrationExemption;

describe("operation spec migration coverage", () => {
	test("covers every shared operation with a descriptor or live exemption", () => {
		const report = checkOperationSpecCoverage(
			new Date("2026-07-28T00:00:00Z"),
		);
		expect(report).toEqual({
			total: 123,
			covered: 123,
			exempted: 0,
			coverageRatio: 1,
		});
		expect(sharedOperationCatalog.entries).toHaveLength(123);
	});

	test("compares runtime exemptions by fields rather than property order", () => {
		const reorderedExemption = {
			expiresOn: futureExemption.expiresOn,
			targetPhase: futureExemption.targetPhase,
			reason: futureExemption.reason,
			owner: futureExemption.owner,
			operationId: futureExemption.operationId,
		} satisfies OperationSpecMigrationExemption;
		expect(() =>
			assertOperationSpecCoverage({
				operations: [
					{
						id: futureExemption.operationId,
						specMigration: reorderedExemption,
					},
				],
				declaredSpecs: [],
				exemptions: [futureExemption],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).not.toThrow();
	});

	test("rejects missing, dangling, overlapping, and expired exemptions", () => {
		expect(() =>
			assertOperationSpecCoverage({
				operations: [{ id: "campaigns.list" }],
				declaredSpecs: [],
				exemptions: [],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).toThrow("neither an OperationSpec descriptor nor a migration exemption");

		expect(() =>
			assertOperationSpecCoverage({
				operations: [],
				declaredSpecs: [],
				exemptions: [futureExemption],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).toThrow("migration exemption has no shared runtime operation");

		expect(() =>
			assertOperationSpecCoverage({
				operations: [
					{
						id: campaignGetOperationSpec.id,
						spec: campaignGetOperationSpec,
					},
				],
				declaredSpecs: [campaignGetOperationSpec],
				exemptions: [
					{
						...futureExemption,
						operationId: campaignGetOperationSpec.id,
					},
				],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).toThrow("both a descriptor and a migration exemption");

		expect(() =>
			assertOperationSpecCoverage({
				operations: [
					{
						id: futureExemption.operationId,
						specMigration: {
							...futureExemption,
							expiresOn: "2026-07-27",
						},
					},
				],
				declaredSpecs: [],
				exemptions: [
					{
						...futureExemption,
						expiresOn: "2026-07-27",
					},
				],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).toThrow("migration exemption expired on 2026-07-27");

		expect(() =>
			assertOperationSpecCoverage({
				operations: [
					{
						id: futureExemption.operationId,
						specMigration: {
							...futureExemption,
							expiresOn: "2099-02-30",
						},
					},
				],
				declaredSpecs: [],
				exemptions: [
					{
						...futureExemption,
						expiresOn: "2099-02-30",
					},
				],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).toThrow("invalid expiresOn date 2099-02-30");
	});

	test("rejects declared descriptors that are absent or unbound at runtime", () => {
		expect(() =>
			assertOperationSpecCoverage({
				operations: [],
				declaredSpecs: [campaignGetOperationSpec],
				exemptions: [],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).toThrow("descriptor has no shared runtime operation");

		expect(() =>
			assertOperationSpecCoverage({
				operations: [{ id: campaignGetOperationSpec.id }],
				declaredSpecs: [campaignGetOperationSpec],
				exemptions: [],
				now: new Date("2026-07-28T00:00:00Z"),
			}),
		).toThrow("descriptor is declared but not bound");
	});
});
