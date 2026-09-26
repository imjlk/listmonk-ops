import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
	getOperationAuditStorePath,
	listOperationAuditEntries,
	recordOperationAudit,
} from "../src";

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

	test("resolves a relative or ~/ override from the home directory, not the cwd", async () => {
		const previousStore = process.env.LISTMONK_OPS_AUDIT_STORE;
		const previousCwd = process.cwd();
		const first = await mkdtemp(join(tmpdir(), "listmonk-ops-audit-cwd-"));
		const second = await mkdtemp(join(tmpdir(), "listmonk-ops-audit-cwd-"));
		temporaryDirectories.push(first, second);
		try {
			process.env.LISTMONK_OPS_AUDIT_STORE = "audit/operation-audit.json";
			process.chdir(first);
			const fromFirst = getOperationAuditStorePath();
			process.chdir(second);
			expect(getOperationAuditStorePath()).toBe(fromFirst);
			expect(fromFirst).toBe(
				join(homedir(), "audit", "operation-audit.json"),
			);
			process.env.LISTMONK_OPS_AUDIT_STORE = "  ~/operation-audit.json ";
			expect(getOperationAuditStorePath()).toBe(
				join(homedir(), "operation-audit.json"),
			);
		} finally {
			process.chdir(previousCwd);
			if (previousStore === undefined) {
				delete process.env.LISTMONK_OPS_AUDIT_STORE;
			} else {
				process.env.LISTMONK_OPS_AUDIT_STORE = previousStore;
			}
		}
	});

	test("records to the home-anchored override when the process starts in /", async () => {
		// An MCP server launched by a client with cwd `/` must not try to
		// write `/audit/operation-audit.json`.
		const home = await mkdtemp(join(tmpdir(), "listmonk-ops-audit-home-"));
		temporaryDirectories.push(home);
		const moduleUrl = new URL("../src/operation-audit.ts", import.meta.url)
			.href;
		const script = `
			const audit = await import(${JSON.stringify(moduleUrl)});
			await audit.recordOperationAudit({
				surface: "mcp",
				operationId: "lists.delete",
				event: "started",
				confirmationRequired: true,
				confirmed: true,
				dryRun: false,
			});
			console.log(audit.getOperationAuditStorePath());
		`;
		const child = Bun.spawn([process.execPath, "-e", script], {
			cwd: "/",
			env: {
				...process.env,
				HOME: home,
				LISTMONK_OPS_AUDIT_STORE: "audit/operation-audit.json",
			},
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		if (code !== 0) throw new Error(`audit subprocess failed: ${stderr}`);
		const expectedPath = join(home, "audit", "operation-audit.json");
		expect(stdout.trim()).toBe(expectedPath);
		const stored = JSON.parse(await readFile(expectedPath, "utf8"));
		expect(stored.entries).toMatchObject([
			{ surface: "mcp", operationId: "lists.delete", event: "started" },
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
