import { listOperationAuditEntries } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	assertMcpOperationDryRun,
	getMcpOperationExecution,
	McpOperationDryRunUnsupportedError,
} from "../../src/operation-execution.js";
import { createListmonkMCPServer } from "../../src/server.js";
import type { CallToolRequest } from "../../src/types/mcp.js";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

function request(
	name: string,
	arguments_: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

async function createAuditedServer() {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-mcp-audit-"));
	tempDirectories.push(directory);
	const auditStorePath = join(directory, "operation-audit.json");
	return {
		auditStorePath,
		server: createListmonkMCPServer({
			baseUrl: "http://127.0.0.1:9000/api",
			username: "api-admin",
			apiToken: "dummy-token",
			auditStorePath,
		}),
	};
}

function replaceServerClient(
	server: ReturnType<typeof createListmonkMCPServer>,
	client: ListmonkClient,
): void {
	(server as unknown as { client: ListmonkClient }).client = client;
}

describe("MCP operation execution safety", () => {
	test("resolves registry policy, strips transport confirmation, and rejects fake dry runs", () => {
		const destructive = getMcpOperationExecution(
			request("listmonk_delete_list", { id: "8", confirm: true }),
		);
		expect(destructive).toMatchObject({
			operation: { id: "lists.delete" },
			policy: {
				confirmationRequired: true,
				auditRequired: true,
				dryRunSupported: false,
			},
			confirmed: true,
			dryRunRequested: false,
			dryRun: false,
			request: { params: { arguments: { id: "8" } } },
		});

		const unsupportedDryRun = getMcpOperationExecution(
			request("listmonk_delete_list", {
				id: "8",
				confirm: true,
				dry_run: true,
			}),
		);
		expect(unsupportedDryRun).toBeDefined();
		if (!unsupportedDryRun) {
			throw new Error("Expected shared delete operation metadata");
		}
		expect(() => assertMcpOperationDryRun(unsupportedDryRun)).toThrow(
			McpOperationDryRunUnsupportedError,
		);

		const actualDryRun = getMcpOperationExecution(
			request("listmonk_ops_subscriber_hygiene", {
				confirm: true,
				dry_run: true,
			}),
		);
		expect(actualDryRun).toMatchObject({
			operation: { id: "ops.subscribers.hygiene" },
			policy: { dryRunSupported: true },
			dryRunRequested: true,
			dryRun: true,
			request: { params: { arguments: { dry_run: true } } },
		});
	});

	test("blocks an unconfirmed destructive operation before it reaches Listmonk", async () => {
		const { auditStorePath, server } = await createAuditedServer();
		let deleteCalled = false;
		replaceServerClient(
			server,
			{
				list: {
					delete: async () => {
						deleteCalled = true;
						return { data: true };
					},
				},
			} as unknown as ListmonkClient,
		);

		const result = await server.callTool(
			request("listmonk_delete_list", { id: "8" }),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"Operation lists.delete requires explicit confirmation",
		);
		expect(deleteCalled).toBe(false);

		const entries = await listOperationAuditEntries({ path: auditStorePath });
		expect(entries).toHaveLength(2);
		expect(entries).toEqual([
			expect.objectContaining({
				surface: "mcp",
				operationId: "lists.delete",
				event: "started",
				confirmationRequired: true,
				confirmed: false,
				dryRun: false,
			}),
			expect.objectContaining({
				surface: "mcp",
				operationId: "lists.delete",
				event: "blocked",
				confirmationRequired: true,
				confirmed: false,
				dryRun: false,
			}),
		]);
		expect(entries[0]?.executionId).toBe(entries[1]?.executionId);
	});

	test("blocks an unsupported dry run before it reaches Listmonk", async () => {
		const { auditStorePath, server } = await createAuditedServer();
		let deleteCalled = false;
		replaceServerClient(
			server,
			{
				list: {
					delete: async () => {
						deleteCalled = true;
						return { data: true };
					},
				},
			} as unknown as ListmonkClient,
		);

		const result = await server.callTool(
			request("listmonk_delete_list", {
				id: "8",
				confirm: true,
				dry_run: true,
			}),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"Operation lists.delete does not support dry_run",
		);
		expect(deleteCalled).toBe(false);
		const entries = await listOperationAuditEntries({ path: auditStorePath });
		expect(entries.map((entry) => entry.event)).toEqual(["started", "blocked"]);
		expect(entries.every((entry) => entry.dryRun === false)).toBe(true);
	});

	test("does not invoke a mutation when the started audit event cannot be persisted", async () => {
		const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-mcp-audit-"));
		tempDirectories.push(directory);
		let deleteCalled = false;
		const server = createListmonkMCPServer({
			baseUrl: "http://127.0.0.1:9000/api",
			username: "api-admin",
			apiToken: "dummy-token",
			auditStorePath: directory,
		});
		replaceServerClient(
			server,
			{
				list: {
					delete: async () => {
						deleteCalled = true;
						return { data: true };
					},
				},
			} as unknown as ListmonkClient,
		);

		const result = await server.callTool(
			request("listmonk_delete_list", { id: "8", confirm: true }),
		);

		expect(result.isError).toBe(true);
		expect(result.content[0]?.text).toContain(
			"Unable to start audit for operation lists.delete",
		);
		expect(deleteCalled).toBe(false);
	});

	test("records successful destructive execution and omits confirm from domain input", async () => {
		const { auditStorePath, server } = await createAuditedServer();
		let deleteInput: unknown;
		replaceServerClient(
			server,
			{
				list: {
					delete: async (input: unknown) => {
						deleteInput = input;
						return { data: true };
					},
				},
			} as unknown as ListmonkClient,
		);

		const result = await server.callTool(
			request("listmonk_delete_list", { id: "8", confirm: true }),
		);

		expect(result.isError).not.toBe(true);
		expect(result.content[0]?.text).toBe("List deleted successfully");
		expect(deleteInput).toEqual({ path: { list_id: 8 } });

		const entries = await listOperationAuditEntries({ path: auditStorePath });
		expect(entries.map((entry) => entry.event)).toEqual([
			"started",
			"succeeded",
		]);
		expect(entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					confirmationRequired: true,
					confirmed: true,
					dryRun: false,
				}),
			]),
		);
	});

	test("records failed shared mutations without exposing remote failure data in the audit store", async () => {
		const { auditStorePath, server } = await createAuditedServer();
		replaceServerClient(
			server,
			{
				list: {
					delete: async () => ({ error: { error: "remote failure" } }),
				},
			} as unknown as ListmonkClient,
		);

		const result = await server.callTool(
			request("listmonk_delete_list", { id: "8", confirm: true }),
		);

		expect(result.isError).toBe(true);
		const entries = await listOperationAuditEntries({ path: auditStorePath });
		expect(entries.map((entry) => entry.event)).toEqual(["started", "failed"]);
		expect(JSON.stringify(entries)).not.toContain("remote failure");
	});
});
