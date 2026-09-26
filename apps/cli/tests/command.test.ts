import {
	createOutboundWebhookEndpoint,
	listOutboundWebhookDeliveries,
} from "@listmonk-ops/automation";
import { listOperationAuditEntries } from "@listmonk-ops/common";
import { afterEach, describe, expect, test } from "bun:test";
import { cli } from "gunshi";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
	defineCommand,
	isNegatableBooleanOption,
	option,
	prepareCliArgv,
} from "../src/lib/command";

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

	test("treats options that already spell a negation as plain flags", async () => {
		const calls: Record<string, unknown>[] = [];
		const command = defineCommand({
			name: "probe",
			options: {
				"no-body": option(z.boolean().optional()),
				"dry-run": option(z.boolean().default(true)),
			},
			handler: ({ flags }) => {
				calls.push(flags);
			},
		});
		const run = async (argv: string[]) => {
			calls.length = 0;
			await cli(prepareCliArgv(argv), command, {
				name: "probe",
				usageSilent: true,
				strict: true,
			});
			expect(calls).toHaveLength(1);
			return calls[0];
		};

		expect(isNegatableBooleanOption("no-body")).toBe(false);
		expect(isNegatableBooleanOption("dry-run")).toBe(true);
		expect(command.args?.["no-body"]).toMatchObject({
			type: "boolean",
			negatable: false,
		});
		expect(command.args?.["dry-run"]).toMatchObject({
			type: "boolean",
			negatable: true,
		});
		const cases: Array<[string[], boolean | undefined]> = [
			[["--no-body"], true],
			[["--no-body=true"], true],
			[["--no-body", "true"], true],
			[["--no-body=false"], undefined],
			[["--no-body", "false"], undefined],
			[[], undefined],
		];
		for (const [argv, expected] of cases) {
			const flags = await run(argv);
			expect(flags?.["no-body"]).toBe(expected);
			expect(flags?.["dry-run"]).toBe(true);
		}

		const combined = await run(["--no-dry-run", "--no-body"]);
		expect(combined?.["dry-run"]).toBe(false);
		expect(combined?.["no-body"]).toBe(true);
		await expect(run(["--no-no-body"])).rejects.toThrow("--no-no-body");
	});

	test("rejects a plain no-* flag set to false on a command without it", async () => {
		defineCommand({
			name: "with-flag",
			options: { "no-body": option(z.boolean().optional()) },
			handler: () => undefined,
		});
		let calls = 0;
		const command = defineCommand({
			name: "probe",
			handler: () => {
				calls += 1;
			},
		});

		for (const argv of [["--no-body=false"], ["--no-body"]]) {
			await expect(
				cli(prepareCliArgv(argv), command, {
					name: "probe",
					usageSilent: true,
					strict: true,
				}),
			).rejects.toThrow("Unknown option: --no-body");
		}
		expect(calls).toBe(0);
	});

	test("rejects a plain no-* flag that would default to on", () => {
		expect(() =>
			defineCommand({
				name: "probe",
				options: { "no-body": option(z.boolean().default(true)) },
				handler: () => undefined,
			}),
		).toThrow("cannot be negated");
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

	test("preserves a command handler result for domain event projection", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "listmonk-ops-cli-command-result-"),
		);
		tempDirectories.push(directory);
		const auditStorePath = join(directory, "operation-audit.json");
		const webhookStorePath = join(directory, "outbound-webhooks.json");
		await createOutboundWebhookEndpoint(
			{
				name: "campaigns",
				url: "https://8.8.8.8/hooks",
				secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_CAMPAIGNS",
				eventFilters: ["campaign.*"],
			},
			{ path: webhookStorePath },
		);
		const previousAuditStorePath = process.env.LISTMONK_OPS_AUDIT_STORE;
		const previousWebhookStorePath = process.env.LISTMONK_OPS_WEBHOOK_STORE;
		const command = defineCommand({
			name: "start",
			operationId: "campaigns.start",
			handler: async () => ({ id: 42, status: "running" }),
		});

		process.env.LISTMONK_OPS_AUDIT_STORE = auditStorePath;
		process.env.LISTMONK_OPS_WEBHOOK_STORE = webhookStorePath;
		try {
			await cli(prepareCliArgv(["--confirm"]), command, {
				name: "start",
				usageSilent: true,
			});

			expect(
				await listOutboundWebhookDeliveries({ path: webhookStorePath }),
			).toMatchObject([
				{
					event: {
						type: "campaign.started",
						subject: { kind: "campaign", key: "42" },
						data: { status: "running" },
					},
				},
			]);
		} finally {
			if (previousAuditStorePath === undefined) {
				delete process.env.LISTMONK_OPS_AUDIT_STORE;
			} else {
				process.env.LISTMONK_OPS_AUDIT_STORE = previousAuditStorePath;
			}
			if (previousWebhookStorePath === undefined) {
				delete process.env.LISTMONK_OPS_WEBHOOK_STORE;
			} else {
				process.env.LISTMONK_OPS_WEBHOOK_STORE = previousWebhookStorePath;
			}
		}
	});
});
