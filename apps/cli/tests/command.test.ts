import { listOperationAuditEntries } from "@listmonk-ops/common";
import { afterEach, describe, expect, test } from "bun:test";
import { cli } from "gunshi";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineCommand, option, prepareCliArgv } from "../src/lib/command";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

async function createAuditStorePath(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-cli-command-"));
	tempDirectories.push(directory);
	return join(directory, "operation-audit.json");
}

describe("CLI command adapter", () => {
	test("recognizes optional boolean schemas as boolean arguments", async () => {
		let capturedFlags: Record<string, unknown> | undefined;
		const command = defineCommand({
			name: "probe",
			options: {
				verbose: option(z.boolean().optional()),
			},
			handler: ({ flags }) => {
				capturedFlags = flags;
			},
		});

		expect(command.args?.verbose).toMatchObject({ type: "boolean" });
		await cli(prepareCliArgv(["--verbose"]), command, {
			name: "probe",
			usageSilent: true,
		});

		expect(capturedFlags?.verbose).toBe(true);
	});

	test("preserves intercepted global flags over command defaults", async () => {
		let capturedFlags: Record<string, unknown> | undefined;
		const command = defineCommand({
			name: "probe",
			options: {
				interactive: option(z.boolean().default(false)),
			},
			handler: ({ flags }) => {
				capturedFlags = flags;
			},
		});

		await cli(prepareCliArgv(["--interactive"]), command, {
			name: "probe",
			usageSilent: true,
		});

		expect(capturedFlags?.interactive).toBe(true);
	});

	test("makes the global confirm flag available to command handlers", async () => {
		let capturedFlags: Record<string, unknown> | undefined;
		const command = defineCommand({
			name: "probe",
			handler: ({ flags }) => {
				capturedFlags = flags;
			},
		});

		await cli(prepareCliArgv(["--confirm"]), command, {
			name: "probe",
			usageSilent: true,
		});

		expect(capturedFlags?.confirm).toBe(true);
	});

	test("enforces shared operation confirmation before invoking a command handler", async () => {
		const auditStorePath = await createAuditStorePath();
		const previousAuditStorePath = process.env.LISTMONK_OPS_AUDIT_STORE;
		let calls = 0;
		const command = defineCommand({
			name: "delete",
			operationId: "lists.delete",
			handler: () => {
				calls += 1;
			},
		});

		process.env.LISTMONK_OPS_AUDIT_STORE = auditStorePath;
		try {
			await expect(
				cli(prepareCliArgv([]), command, {
					name: "delete",
					usageSilent: true,
				}),
			).rejects.toThrow("Operation lists.delete requires explicit confirmation");
			expect(calls).toBe(0);

			await cli(prepareCliArgv(["--confirm"]), command, {
				name: "delete",
				usageSilent: true,
			});
			expect(calls).toBe(1);

			const entries = await listOperationAuditEntries({ path: auditStorePath });
			expect(entries.map((entry) => entry.event)).toEqual([
				"started",
				"blocked",
				"started",
				"succeeded",
			]);
		} finally {
			if (previousAuditStorePath === undefined) {
				delete process.env.LISTMONK_OPS_AUDIT_STORE;
			} else {
				process.env.LISTMONK_OPS_AUDIT_STORE = previousAuditStorePath;
			}
		}
	});
});
