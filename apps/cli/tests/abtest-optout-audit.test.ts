import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { saveStoredAbTests } from "@listmonk-ops/abtest";
import { listOperationAuditEntries } from "@listmonk-ops/common";
import {
	createOutboundWebhookEndpoint,
	listOutboundWebhookDeliveries,
} from "@listmonk-ops/automation";
import { makeTest } from "../../../packages/abtest/tests/support/listmonk-optout-fake";

const cliDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("failed opt-out sync preserves JSON, fails audit, and never emits operation.succeeded", async () => {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-optout-audit-"));
	const calls: string[] = [];
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			calls.push(request.method);
			return Response.json({ message: "fixture read failure" }, { status: 500 });
		},
	});
	try {
		const store = join(directory, "abtests.json");
		const audit = join(directory, "audit.json");
		const webhooks = join(directory, "webhooks.json");
		await saveStoredAbTests([makeTest({ status: "completed" })], store);
		await createOutboundWebhookEndpoint({ name: "audit-fixture", url: "https://8.8.8.8/hooks", secretRef: "LISTMONK_OPS_WEBHOOK_SECRET_FIXTURE", eventFilters: ["operation.*"] }, { path: webhooks });
		const executable = process.env.CLI_TEST_EXECUTABLE?.trim();
		const args = [
			"abtest",
			"sync-optouts",
			"--test-id",
			"test_optout",
			"--confirm",
			"--format=json",
		];
		const child = Bun.spawn(
			executable
				? [executable, ...args]
				: [process.execPath, "src/index.ts", ...args],
			{
				cwd: cliDirectory,
				env: {
					...process.env,
					BUN_FORCE_COLOR: "0",
					LISTMONK_API_URL: `http://127.0.0.1:${server.port}/api`,
					LISTMONK_USERNAME: "audit-fixture",
					LISTMONK_API_TOKEN: "fixture-token",
					LISTMONK_OPS_ABTEST_STORE: store,
					LISTMONK_OPS_AUDIT_STORE: audit,
					LISTMONK_OPS_WEBHOOK_STORE: webhooks,
					LISTMONK_OPS_SEQUENCE_STORE: join(directory, "sequences.json"),
					LISTMONK_OPS_WEBHOOK_DATABASE_URL: "",
					LISTMONK_OPS_SEQUENCE_DATABASE_URL: "",
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
		expect(code).not.toBe(0);
		expect(JSON.parse(stdout)).toMatchObject({
			checked: 1,
			failed: 1,
			dry_run: false,
		});
		expect(JSON.parse(stderr).error.message).toContain(
			"unresolved opt-out sync failures",
		);
		expect((await listOperationAuditEntries({ path: audit })).map((entry) => entry.event)).toEqual(
			["started", "failed"],
		);
		expect((await listOutboundWebhookDeliveries({ path: webhooks })).map((delivery) => delivery.event.type).sort()).toEqual(
			["operation.failed", "operation.started"],
		);
		expect(calls.length).toBeGreaterThan(0);
		expect(calls.every((method) => method === "GET")).toBe(true);
	} finally {
		await server.stop(true);
		await rm(directory, { recursive: true, force: true });
	}
}, 20_000);
