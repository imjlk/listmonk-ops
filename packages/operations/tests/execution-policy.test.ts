import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
	assertOperationConfirmation,
	defineOperation,
	deleteListOperation,
	getListOperation,
	getOperationEffectiveDryRun,
	getOperationExecutionPolicy,
	OperationConfirmationRequiredError,
} from "../src";

const dryRunOperation = defineOperation({
	id: "test.dry-run",
	title: "Test dry run",
	description: "A test-only operation with an explicit dry-run input",
	inputSchema: z.object({ dry_run: z.boolean().default(true) }),
	outputSchema: z.object({ ok: z.literal(true) }),
	safety: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: true,
		openWorldHint: false,
	},
	mcp: { name: "listmonk_test_dry_run" },
	execute: async () => ({ ok: true }),
});

describe("operation execution policy", () => {
	test("derives read, destructive, and explicit dry-run requirements", () => {
		expect(getOperationExecutionPolicy(getListOperation)).toEqual({
			confirmationRequired: false,
			auditRequired: false,
			dryRunSupported: false,
		});
		expect(getOperationExecutionPolicy(deleteListOperation)).toEqual({
			confirmationRequired: true,
			auditRequired: true,
			dryRunSupported: false,
		});
		expect(getOperationExecutionPolicy(dryRunOperation)).toEqual({
			confirmationRequired: false,
			auditRequired: true,
			dryRunSupported: true,
		});
	});

	test("rejects an unconfirmed destructive operation", () => {
		expect(() =>
			assertOperationConfirmation(deleteListOperation, false),
		).toThrow(OperationConfirmationRequiredError);
		expect(() =>
			assertOperationConfirmation(deleteListOperation, false),
		).toThrow("lists.delete requires explicit confirmation");
		expect(() =>
			assertOperationConfirmation(deleteListOperation, true),
		).not.toThrow();
		expect(() =>
			assertOperationConfirmation(getListOperation, false),
		).not.toThrow();
	});

	test("resolves dry-run values after input defaults", () => {
		expect(getOperationEffectiveDryRun(dryRunOperation, {})).toBe(true);
		expect(
			getOperationEffectiveDryRun(dryRunOperation, { dry_run: false }),
		).toBe(false);
		expect(
			getOperationEffectiveDryRun(dryRunOperation, { dry_run: "invalid" }),
		).toBeUndefined();
	});
});
