import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListmonkMCPServer } from "../../src/server";
import type { CallToolRequest } from "../../src/types/mcp";

const directories: string[] = [];
const MCP_PACKAGE_DIRECTORY = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../..",
);
const PROJECT_ROOT = resolve(MCP_PACKAGE_DIRECTORY, "../..");
const CLI_ENTRY = resolve(PROJECT_ROOT, "apps/cli/src/index.ts");

async function createServer() {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-mcp-webhooks-"));
	directories.push(directory);
	return createListmonkMCPServer({
		baseUrl: "http://localhost:9000/api",
		apiToken: "test-token",
		webhookStorePath: join(directory, "webhooks.json"),
		auditStorePath: join(directory, "audit.json"),
	});
}

function request(
	name: string,
	args: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: args },
	};
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("MCP outbound webhook tools", () => {
	test("publishes typed safety annotations and secret-reference inputs", async () => {
		const server = await createServer();
		const tools = (await server.listTools({ method: "tools/list" })).tools;
		const create = tools.find(
			(tool) => tool.name === "listmonk_webhooks_create",
		);
		const dispatch = tools.find(
			(tool) => tool.name === "listmonk_webhooks_dispatch",
		);
		const reconcile = tools.find(
			(tool) => tool.name === "listmonk_webhooks_reconcile",
		);
		const prune = tools.find(
			(tool) => tool.name === "listmonk_webhooks_prune",
		);
		const tick = tools.find(
			(tool) => tool.name === "listmonk_webhooks_tick",
		);
		const status = tools.find(
			(tool) => tool.name === "listmonk_webhooks_runtime_status",
		);
		const replay = tools.find(
			(tool) => tool.name === "listmonk_webhooks_dlq_replay",
		);

		expect(create?.inputSchema.required).toEqual([
			"name",
			"url",
			"secret_ref",
			"event_filters",
		]);
		expect(create?.inputSchema.properties).not.toHaveProperty("secret");
		expect(dispatch?.annotations).toMatchObject({
			destructiveHint: true,
			openWorldHint: true,
			idempotentHint: false,
		});
		expect(dispatch?.inputSchema.required).toContain("confirm");
		expect(reconcile?.annotations).toMatchObject({
			destructiveHint: false,
			idempotentHint: false,
		});
		expect(reconcile?.inputSchema.required ?? []).not.toContain("confirm");
		expect(prune?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: true,
		});
		expect(prune?.inputSchema.required).toContain("confirm");
		expect(tick?.inputSchema.required).toContain("confirm");
		expect(status?.annotations).toMatchObject({
			readOnlyHint: true,
			idempotentHint: true,
		});
		expect(replay?.inputSchema.required).toContain("confirm");
	});

	test("normalizes provider events and reports shared runtime health", async () => {
		const server = await createServer();
		await server.callTool(
			request("listmonk_webhooks_create", {
				name: "provider-events",
				url: "https://8.8.8.8/hooks",
				secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_PROVIDER",
				event_filters: ["delivery.*"],
			}),
		);
		const ingested = await server.callTool(
			request("listmonk_webhooks_inbound_ingest", {
				provider: "ses",
				provider_event_id: "event-1",
				kind: "bounced",
				message_id: "message-1",
			}),
		);
		expect(ingested.isError).not.toBe(true);
		expect(ingested.structuredContent).toMatchObject({
			event_type: "delivery.bounced",
			queued_deliveries: 1,
		});
		const health = await server.callTool(
			request("listmonk_webhooks_runtime_status"),
		);
		expect(health.structuredContent).toMatchObject({
			store: "file",
			schema_version: 2,
			deliveries: { pending: 1 },
		});
	});

	test("shares endpoint CRUD contracts and confirmation with CLI", async () => {
		const server = await createServer();
		const created = await server.callTool(
			request("listmonk_webhooks_create", {
				name: "mcp-endpoint",
				url: "https://8.8.8.8/hooks",
				secret_ref: "LISTMONK_OPS_WEBHOOK_SECRET_MCP",
				event_filters: ["operation.*"],
			}),
		);
		expect(created.isError).not.toBe(true);
		const endpoint = created.structuredContent?.endpoint as
			| Record<string, unknown>
			| undefined;
		expect(endpoint).toMatchObject({
			name: "mcp-endpoint",
			url_origin: "https://8.8.8.8",
			secret_reference_configured: true,
			enabled: true,
		});
		expect(endpoint?.url_fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(endpoint).not.toHaveProperty("url");
		expect(endpoint).not.toHaveProperty("secret_ref");
		expect(endpoint).not.toHaveProperty("secret");
		const id = endpoint?.id as string;

		const listed = await server.callTool(request("listmonk_webhooks_list"));
		expect(listed.structuredContent).toMatchObject({
			endpoints: [{ id }],
		});

		const blocked = await server.callTool(
			request("listmonk_webhooks_delete", { id }),
		);
		expect(blocked.isError).toBe(true);
		expect(blocked.content[0]?.text).toContain("requires explicit confirmation");

		const deleted = await server.callTool(
			request("listmonk_webhooks_delete", { id, confirm: true }),
		);
		expect(deleted.isError).not.toBe(true);
		expect(deleted.structuredContent).toMatchObject({
			deleted: true,
			endpoint: { id },
		});
	});

	test("observes endpoints created by the CLI through the same store contract", async () => {
		const directory = await mkdtemp(
			join(tmpdir(), "listmonk-ops-webhook-parity-"),
		);
		directories.push(directory);
		const webhookStorePath = join(directory, "webhooks.json");
		const result = Bun.spawnSync(
			[
				"bun",
				CLI_ENTRY,
				"webhooks",
				"create",
				"--name",
				"cli-created",
				"--url",
				"https://8.8.8.8/hooks",
				"--secret-ref",
				"LISTMONK_OPS_WEBHOOK_SECRET_PARITY",
				"--event-filters",
				"campaign.*",
				"--format=json",
			],
			{
				cwd: PROJECT_ROOT,
				env: {
					...process.env,
					BUN_FORCE_COLOR: "0",
					LISTMONK_OPS_WEBHOOK_STORE: webhookStorePath,
					LISTMONK_OPS_AUDIT_STORE: join(directory, "audit.json"),
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		expect(result.exitCode).toBe(0);

		const server = createListmonkMCPServer({
			baseUrl: "http://localhost:9000/api",
			apiToken: "test-token",
			webhookStorePath,
			auditStorePath: join(directory, "mcp-audit.json"),
		});
		const listed = await server.callTool(request("listmonk_webhooks_list"));
		expect(listed.structuredContent).toMatchObject({
			endpoints: [
				{
					name: "cli-created",
					url_origin: "https://8.8.8.8",
					secret_reference_configured: true,
					event_filters: ["campaign.*"],
				},
			],
		});
		expect(JSON.stringify(listed.structuredContent)).not.toContain(
			"LISTMONK_OPS_WEBHOOK_SECRET_PARITY",
		);
		expect(JSON.stringify(listed.structuredContent)).not.toContain(
			"https://8.8.8.8/hooks",
		);
	});
});
