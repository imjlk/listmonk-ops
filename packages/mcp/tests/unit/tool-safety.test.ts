import { listOperationAuditEntries } from "@listmonk-ops/common";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allTools } from "../../src/handlers/index.js";
import {
	getMcpOperationExecution,
	MCP_OPERATION_CONFIRMATION_ARGUMENT,
} from "../../src/operation-execution.js";
import { createListmonkMCPServer } from "../../src/server.js";
import type { CallToolRequest, MCPTool } from "../../src/types/mcp.js";

/**
 * Registered tools that are not shared operations and therefore bypass the
 * confirmation and audit policy gate in `ListmonkMCPServer.callTool`. Each
 * one must stay read-only, and the justification records why skipping the
 * gate is safe.
 */
const UNGATED_READ_ONLY_TOOLS: ReadonlyMap<string, string> = new Map([
	[
		"listmonk_list_operations",
		"Lists the local shared-operation catalog without calling Listmonk",
	],
	["listmonk_health_check", "Reads the Listmonk health endpoint"],
	["listmonk_get_server_config", "Reads GET /api/config"],
	[
		"listmonk_get_campaign_running_stats",
		"Reads GET /api/campaigns/running/stats",
	],
]);

/**
 * Mutating tools allowed to bypass the policy gate. Keep this empty: migrate
 * a mutating tool into the shared operation registry instead. Any entry must
 * justify why confirmation and audit cannot apply to it.
 */
const UNGATED_MUTATING_TOOLS: ReadonlyMap<string, string> = new Map();

/** Legacy tools removed because they mutated Listmonk without the gate. */
const REMOVED_UNGATED_TOOLS = [
	"listmonk_delete_subscribers_by_query",
	"listmonk_blocklist_subscribers_by_query",
	"listmonk_update_settings",
	"listmonk_send_subscriber_optin",
] as const;

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

function hasCompleteAnnotations(tool: MCPTool): boolean {
	const annotations = tool.annotations;
	return (
		annotations !== undefined &&
		typeof annotations.title === "string" &&
		annotations.title.trim().length > 0 &&
		typeof annotations.readOnlyHint === "boolean" &&
		typeof annotations.destructiveHint === "boolean" &&
		typeof annotations.idempotentHint === "boolean" &&
		typeof annotations.openWorldHint === "boolean"
	);
}

function sortedNames(tools: readonly MCPTool[]): string[] {
	return tools.map((tool) => tool.name).sort();
}

async function createAuditedServer() {
	const directory = await mkdtemp(join(tmpdir(), "listmonk-ops-mcp-safety-"));
	tempDirectories.push(directory);
	const auditStorePath = join(directory, "operation-audit.json");
	return {
		auditStorePath,
		server: createListmonkMCPServer({
			baseUrl: "http://127.0.0.1:9000/api",
			username: "api-admin",
			apiToken: "dummy-token",
			auditStorePath,
			webhookStorePath: join(directory, "outbound-webhooks.json"),
		}),
	};
}

function replaceServerClient(
	server: ReturnType<typeof createListmonkMCPServer>,
	client: ListmonkClient,
): void {
	(server as unknown as { client: ListmonkClient }).client = client;
}

describe("MCP tool safety metadata", () => {
	test("every registered tool declares complete safety annotations", () => {
		expect(
			allTools
				.filter((tool) => !hasCompleteAnnotations(tool))
				.map((tool) => tool.name),
		).toEqual([]);
		expect(
			allTools
				.filter(
					(tool) =>
						tool.annotations?.readOnlyHint === true &&
						tool.annotations.destructiveHint !== false,
				)
				.map((tool) => tool.name),
		).toEqual([]);
	});

	test("every mutating tool passes the shared policy gate unless allowlisted", () => {
		const ungated = allTools.filter(
			(tool) => getMcpOperationExecution(request(tool.name)) === undefined,
		);

		expect(
			sortedNames(
				ungated.filter((tool) => tool.annotations?.readOnlyHint !== true),
			),
		).toEqual([...UNGATED_MUTATING_TOOLS.keys()].sort());
		expect(
			sortedNames(
				ungated.filter((tool) => tool.annotations?.readOnlyHint === true),
			),
		).toEqual([...UNGATED_READ_ONLY_TOOLS.keys()].sort());
		for (const justification of [
			...UNGATED_READ_ONLY_TOOLS.values(),
			...UNGATED_MUTATING_TOOLS.values(),
		]) {
			expect(justification.trim()).not.toBe("");
		}
	});

	test("gated tools advertise the confirmation and audit policy they enforce", () => {
		const mismatched: string[] = [];
		for (const tool of allTools) {
			const execution = getMcpOperationExecution(request(tool.name));
			if (!execution) {
				continue;
			}
			const { auditRequired, confirmationRequired } = execution.policy;
			if (
				auditRequired !== (tool.annotations?.readOnlyHint !== true) ||
				confirmationRequired !== (tool.annotations?.destructiveHint === true) ||
				(confirmationRequired &&
					!tool.inputSchema.required?.includes(
						MCP_OPERATION_CONFIRMATION_ARGUMENT,
					))
			) {
				mismatched.push(tool.name);
			}
		}
		expect(mismatched).toEqual([]);
	});

	test("removed ungated legacy tools are rejected before reaching Listmonk", async () => {
		const registeredNames = new Set(allTools.map((tool) => tool.name));
		const { auditStorePath, server } = await createAuditedServer();
		let clientReached = false;
		replaceServerClient(
			server,
			new Proxy(
				{},
				{
					get() {
						clientReached = true;
						throw new Error("Removed tools must not reach Listmonk");
					},
				},
			) as ListmonkClient,
		);

		for (const name of REMOVED_UNGATED_TOOLS) {
			expect(registeredNames.has(name)).toBe(false);
			const result = await server.callTool(
				request(name, { id: "7", query: "1=1", settings: {}, confirm: true }),
			);
			expect(result.isError).toBe(true);
			expect(
				result.content.find((content) => content.type === "text")?.text,
			).toBe(`Error: Unknown tool: ${name}`);
		}
		expect(clientReached).toBe(false);
		expect(await listOperationAuditEntries({ path: auditStorePath })).toEqual(
			[],
		);
	});

	test("the canonical opt-in resend is audited through the policy gate", async () => {
		const { auditStorePath, server } = await createAuditedServer();
		const sendOptin = mock(async () => ({ data: true }));
		replaceServerClient(server, {
			subscriber: { sendOptin },
		} as unknown as ListmonkClient);

		const result = await server.callTool(
			request("listmonk_send_optin", { id: "7" }),
		);

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual({ id: 7, sent: true });
		expect(sendOptin).toHaveBeenCalledWith({ path: { id: 7 } });
		const entries = await listOperationAuditEntries({ path: auditStorePath });
		expect(entries.map((entry) => entry.event)).toEqual([
			"started",
			"succeeded",
		]);
		expect(
			entries.every((entry) => entry.operationId === "subscribers.send-optin"),
		).toBe(true);
	});
});
