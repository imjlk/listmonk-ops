import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListmonkMCPServer } from "../../src/server";

const databaseUrl =
	process.env.LISTMONK_OPS_TEST_WEBHOOK_DATABASE_URL?.trim();
const postgresTest = databaseUrl ? test : test.skip;
const directory = await mkdtemp(
	join(tmpdir(), "listmonk-ops-webhook-runtime-e2e-"),
);
const projectRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
const cliEntry = resolve(projectRoot, "apps/cli/src/index.ts");

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("Postgres webhook runtime CLI and MCP parity", () => {
	postgresTest(
		"shares endpoint, normalized inbound event, and runtime health state",
		async () => {
			if (!databaseUrl) {
				throw new Error("Postgres webhook runtime database is unavailable");
			}
			const name = `e2e-provider-${randomUUID()}`;
			const cli = Bun.spawnSync(
				[
					"bun",
					cliEntry,
					"webhooks",
					"create",
					"--name",
					name,
					"--url",
					"https://8.8.8.8/hooks",
					"--secret-ref",
					"LISTMONK_OPS_WEBHOOK_SECRET_E2E",
					"--event-filters",
					"delivery.*",
					"--format=json",
				],
				{
					cwd: projectRoot,
					env: {
						...process.env,
						BUN_FORCE_COLOR: "0",
						LISTMONK_OPS_WEBHOOK_STORE: "",
						LISTMONK_OPS_WEBHOOK_DATABASE_URL: databaseUrl,
						LISTMONK_OPS_AUDIT_STORE: join(directory, "audit.json"),
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			expect(cli.exitCode).toBe(0);
			const stdout = cli.stdout.toString();
			const jsonStart = stdout.indexOf("{");
			expect(jsonStart).toBeGreaterThanOrEqual(0);
			const created = JSON.parse(stdout.slice(jsonStart)) as {
				endpoint: { id: string };
			};

			const server = createListmonkMCPServer({
				baseUrl: "http://127.0.0.1:9000/api",
				apiToken: "test-token",
				webhookDatabaseUrl: databaseUrl,
				auditStorePath: join(directory, "mcp-audit.json"),
			});
			const request = (tool: string, args: Record<string, unknown> = {}) =>
				server.callTool({
					method: "tools/call",
					params: { name: tool, arguments: args },
				});
			try {
				const listed = await request("listmonk_webhooks_list");
				expect(listed.structuredContent?.endpoints).toEqual(
					expect.arrayContaining([
						expect.objectContaining({ id: created.endpoint.id, name }),
					]),
				);
				const ingested = await request("listmonk_webhooks_inbound_ingest", {
					provider: "ses",
					provider_event_id: randomUUID(),
					kind: "delivered",
					message_id: randomUUID(),
				});
				expect(ingested.structuredContent?.event_type).toBe(
					"delivery.delivered",
				);
				expect(
					ingested.structuredContent?.queued_deliveries as number,
				).toBeGreaterThanOrEqual(1);
				const health = await request("listmonk_webhooks_runtime_status");
				expect(health.structuredContent).toMatchObject({
					store: "postgres",
					schema_version: 2,
					deliveries: { pending: expect.any(Number) },
				});
			} finally {
				await request("listmonk_webhooks_delete", {
					id: created.endpoint.id,
					confirm: true,
				});
			}
		},
	);
});
