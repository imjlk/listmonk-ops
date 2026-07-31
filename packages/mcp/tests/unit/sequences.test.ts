import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createListmonkMCPServer } from "../../src/server";
import type { CallToolRequest } from "../../src/types/mcp";

const directories: string[] = [];

function request(
	name: string,
	args: Record<string, unknown> = {},
): CallToolRequest {
	return {
		method: "tools/call",
		params: { name, arguments: args },
	};
}

async function createServer() {
	const directory = await mkdtemp(
		join(tmpdir(), "listmonk-ops-mcp-sequences-"),
	);
	directories.push(directory);
	return createListmonkMCPServer({
		baseUrl: "http://localhost:9000/api",
		apiToken: "test-token",
		sequenceStorePath: join(directory, "sequences.json"),
		auditStorePath: join(directory, "audit.json"),
	});
}

afterEach(async () => {
	await Promise.all(
		directories.splice(0).map((directory) =>
			rm(directory, { recursive: true, force: true }),
		),
	);
});

describe("MCP sequence tools", () => {
	test("publishes typed contracts and confirmation for delivery/recovery", async () => {
		const server = await createServer();
		const tools = (await server.listTools({ method: "tools/list" })).tools;
		const create = tools.find(
			(tool) => tool.name === "listmonk_sequences_create",
		);
		const tick = tools.find(
			(tool) => tool.name === "listmonk_sequences_tick",
		);
		const reconcile = tools.find(
			(tool) => tool.name === "listmonk_sequences_reconcile",
		);

		expect(create?.inputSchema.required).toEqual(["name", "steps"]);
		expect(tick?.annotations).toMatchObject({
			destructiveHint: true,
			openWorldHint: true,
			idempotentHint: false,
		});
		expect(tick?.inputSchema.required).toContain("confirm");
		expect(reconcile?.annotations).toMatchObject({
			destructiveHint: true,
			idempotentHint: false,
		});
		expect(reconcile?.inputSchema.required).toContain("confirm");
	});

	test("shares definition, enrollment, and safety behavior", async () => {
		const server = await createServer();
		const created = await server.callTool(
			request("listmonk_sequences_create", {
				name: "mcp-sequence",
				description: "private sequence description",
				steps: [
					{
						id: "branch",
						type: "condition",
						path: "plan",
						operator: "equals",
						value: "private-plan-value",
						on_true: "stop",
						on_false: "stop",
					},
					{ id: "stop", type: "stop" },
				],
			}),
		);
		expect(created.isError).not.toBe(true);
		const sequence = created.structuredContent?.sequence as
			| Record<string, unknown>
			| undefined;
		expect(sequence).toMatchObject({
			name: "mcp-sequence",
			description_present: true,
			current_revision: 1,
			status: "active",
			revisions: [
				{
					revision: 1,
					step_count: 2,
					step_types: ["condition", "stop"],
				},
			],
		});
		const sequenceJson = JSON.stringify(sequence);
		expect(sequenceJson).not.toContain("private sequence description");
		expect(sequenceJson).not.toContain("private-plan-value");
		expect(sequenceJson).not.toContain('"steps"');
		expect(
			(
				sequence?.revisions as Array<{ content_fingerprint: string }>
			)[0]?.content_fingerprint,
		).toMatch(/^sha256:[a-f0-9]{64}$/);
		const id = sequence?.id as string;

		const enrollment = await server.callTool(
			request("listmonk_sequences_enroll", {
				id,
				subscriber_id: 42,
				context: { plan: "pro" },
			}),
		);
		expect(enrollment.isError).not.toBe(true);
		expect(enrollment.structuredContent).toMatchObject({
			enrollment: {
				sequence_id: id,
				revision: 1,
				subscriber_reference_present: true,
				status: "pending",
				last_error_present: false,
			},
		});
		expect(JSON.stringify(enrollment.structuredContent)).not.toContain(
			'"subscriber_id"',
		);
		const enrollmentId = (
			enrollment.structuredContent?.enrollment as { id: string }
		).id;
		const enrollmentList = await server.callTool(
			request("listmonk_sequences_enrollments_list", {
				sequence_id: id,
				status: "pending",
			}),
		);
		expect(enrollmentList.structuredContent).toMatchObject({
			enrollments: [
				{
					id: enrollmentId,
					sequence_id: id,
					subscriber_reference_present: true,
				},
			],
		});
		expect(JSON.stringify(enrollmentList.structuredContent)).not.toContain(
			'"subscriber_id"',
		);
		const enrollmentGet = await server.callTool(
			request("listmonk_sequences_enrollments_get", {
				id: enrollmentId,
			}),
		);
		expect(enrollmentGet.structuredContent).toMatchObject({
			enrollment: { id: enrollmentId, status: "pending" },
		});

		const paused = await server.callTool(
			request("listmonk_sequences_pause", { id }),
		);
		expect(paused.structuredContent).toMatchObject({
			sequence: { id, status: "paused" },
		});
		const resumed = await server.callTool(
			request("listmonk_sequences_resume", { id }),
		);
		expect(resumed.structuredContent).toMatchObject({
			sequence: { id, status: "active" },
		});

		const blockedReconcile = await server.callTool(
			request("listmonk_sequences_reconcile"),
		);
		expect(blockedReconcile.isError).toBe(true);
		expect(blockedReconcile.content[0]?.text).toContain(
			"requires explicit confirmation",
		);
		const preview = await server.callTool(
			request("listmonk_sequences_reconcile", {
				confirm: true,
				dry_run: true,
			}),
		);
		expect(preview.structuredContent).toMatchObject({
			scanned: 0,
			recovered: 0,
			dry_run: true,
		});

		const blockedDelete = await server.callTool(
			request("listmonk_sequences_delete", { id, confirm: true }),
		);
		expect(blockedDelete.isError).toBe(true);
		expect(blockedDelete.content[0]?.text).toContain(
			"non-terminal enrollments",
		);
	});
});
