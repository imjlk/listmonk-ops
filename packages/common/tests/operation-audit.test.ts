import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listOperationAuditEntries, recordOperationAudit } from "../src";

const temporaryDirectories: string[] = [];

async function createAuditPath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-audit-"));
	temporaryDirectories.push(directory);
	return join(directory, "operation-audit.json");
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("operation audit store", () => {
	test("records a bounded lifecycle without operational payloads", async () => {
		const path = await createAuditPath();
		const started = await recordOperationAudit(
			{
				executionId: "execution-1",
				at: "2026-07-22T00:00:00.000Z",
				surface: "mcp",
				operationId: "lists.delete",
				event: "started",
				confirmationRequired: true,
				confirmed: true,
				dryRun: false,
			},
			{ path },
		);
		const succeeded = await recordOperationAudit(
			{
				executionId: started.executionId,
				at: "2026-07-22T00:00:01.000Z",
				surface: "mcp",
				operationId: "lists.delete",
				event: "succeeded",
				confirmationRequired: true,
				confirmed: true,
				dryRun: false,
			},
			{ path },
		);

		expect(succeeded.executionId).toBe(started.executionId);
		await expect(listOperationAuditEntries({ path })).resolves.toEqual([
			started,
			succeeded,
		]);
	});

	test("retains only the newest configured audit entries", async () => {
		const path = await createAuditPath();
		for (const event of ["started", "blocked", "failed"] as const) {
			await recordOperationAudit(
				{
					executionId: "execution-2",
					at: `2026-07-22T00:00:0${event === "started" ? 0 : event === "blocked" ? 1 : 2}.000Z`,
					surface: "cli",
					operationId: "campaigns.delete",
					event,
					confirmationRequired: true,
					confirmed: event !== "blocked",
					dryRun: false,
				},
				{ path, limit: 2 },
			);
		}

		await expect(listOperationAuditEntries({ path })).resolves.toMatchObject([
			{ event: "blocked" },
			{ event: "failed" },
		]);
	});

	test("rejects unsupported persisted audit data", async () => {
		const path = await createAuditPath();
		await writeFile(path, '{"version":1,"entries":[{"event":"unknown"}]}\n');

		await expect(listOperationAuditEntries({ path })).rejects.toThrow(
			"Invalid operation audit entry executionId",
		);
	});
});
