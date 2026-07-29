import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListmonkMCPServer } from "../../src/server";
import type { CallToolResult } from "../../src/types/mcp";
import { findMailpitMessages } from "./mailpit";
import {
	buildTestEmail,
	buildTestName,
	MCP_TEST_TRANSACTIONAL_STORE_PATH,
	TEST_CONFIG,
} from "../setup";

const directory = await mkdtemp(
	join(tmpdir(), "listmonk-ops-sequence-parity-"),
);
const sequenceStorePath = join(directory, "sequences.json");
const auditStorePath = join(directory, "audit.json");
const projectRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
const cliEntry = resolve(projectRoot, "apps/cli/src/index.ts");

type CliResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

function credential(): string {
	return TEST_CONFIG.apiToken || TEST_CONFIG.password;
}

function runSequenceCli(args: readonly string[]): CliResult {
	const result = Bun.spawnSync(
		["bun", cliEntry, "--format", "json", ...args],
		{
			cwd: projectRoot,
			env: {
				...process.env,
				BUN_FORCE_COLOR: "0",
				LISTMONK_API_URL: TEST_CONFIG.baseUrl,
				LISTMONK_USERNAME: TEST_CONFIG.username,
				LISTMONK_API_TOKEN: credential(),
				LISTMONK_OPS_SEQUENCE_STORE: sequenceStorePath,
				LISTMONK_OPS_TRANSACTIONAL_STORE:
					MCP_TEST_TRANSACTIONAL_STORE_PATH,
				LISTMONK_OPS_AUDIT_STORE: auditStorePath,
			},
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString().trim(),
		stderr: result.stderr.toString().trim(),
	};
}

function parseCliResult<T>(result: CliResult): T {
	const diagnostic = [result.stdout, result.stderr].filter(Boolean).join("\n");
	if (result.exitCode !== 0) {
		throw new Error(
			`Sequence CLI failed with exit ${result.exitCode}: ${diagnostic}`,
		);
	}
	const start = result.stdout.indexOf("{");
	if (start < 0) {
		throw new Error(`Sequence CLI returned no JSON object: ${diagnostic}`);
	}
	return JSON.parse(result.stdout.slice(start)) as T;
}

function parseMcpResult<T>(result: CallToolResult): T {
	if (result.isError) {
		throw new Error(
			result.content?.[0]?.text ?? "MCP sequence operation failed",
		);
	}
	if (result.structuredContent) {
		return result.structuredContent as T;
	}
	const text = result.content?.[0]?.text;
	if (!text) {
		throw new Error("MCP sequence operation returned no structured content");
	}
	return JSON.parse(text) as T;
}

async function waitFor(
	condition: () => Promise<boolean>,
	timeoutMs = 20_000,
): Promise<void> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (await condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	throw new Error(`Condition not met within ${timeoutMs}ms`);
}

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("Sequence CLI and MCP parity", () => {
	test("shares durable state and delivers one message through Mailpit", async () => {
		const recipient = buildTestEmail("sequence");
		const subject = buildTestName("sequence-subject");
		const sequenceName = buildTestName("sequence");
		const server = createListmonkMCPServer({
			baseUrl: TEST_CONFIG.baseUrl,
			username: TEST_CONFIG.username,
			password: TEST_CONFIG.password,
			apiToken: TEST_CONFIG.apiToken,
			sequenceStorePath,
			auditStorePath: join(directory, "mcp-audit.json"),
		});
		const request = (
			name: string,
			args: Record<string, unknown> = {},
		): Promise<CallToolResult> =>
			server.callTool({
				method: "tools/call",
				params: { name, arguments: args },
			});

		const subscriber = parseMcpResult<{ id: number }>(
			await request("listmonk_create_subscriber", {
				email: recipient,
				name: buildTestName("sequence-subscriber"),
				status: "enabled",
			}),
		);
		const template = parseMcpResult<{ id: number }>(
			await request("listmonk_create_template", {
				name: buildTestName("sequence-template"),
				type: "tx",
				subject,
				body: "<p>Sequence parity delivery.</p>",
			}),
		);

		const created = parseCliResult<{
			sequence: { id: string; current_revision: number };
		}>(
			runSequenceCli([
				"sequences",
				"create",
				"--name",
				sequenceName,
				"--steps",
				JSON.stringify([
					{
						id: "welcome",
						type: "send",
						template_id: template.id,
						from_email: "listmonk-ops@example.com",
					},
				]),
			]),
		);

		const fetched = await request("listmonk_sequences_get", {
			id: created.sequence.id,
		});
		expect(fetched.isError).toBeFalsy();
		expect(fetched.structuredContent).toMatchObject({
			sequence: {
				id: created.sequence.id,
				name: sequenceName,
				current_revision: 1,
			},
		});

		const enrolled = await request("listmonk_sequences_enroll", {
			id: created.sequence.id,
			subscriber_id: subscriber.id,
		});
		expect(enrolled.isError).toBeFalsy();
		const enrollmentId = (
			enrolled.structuredContent?.enrollment as { id: string }
		).id;
		const listed = parseCliResult<{
			enrollments: Array<{ id: string; sequence_id: string }>;
		}>(
			runSequenceCli([
				"sequences",
				"enrollments",
				"list",
				"--sequence-id",
				created.sequence.id,
			]),
		);
		expect(listed.enrollments).toContainEqual(
			expect.objectContaining({
				id: enrollmentId,
				sequence_id: created.sequence.id,
			}),
		);
		const enrollment = await request(
			"listmonk_sequences_enrollments_get",
			{ id: enrollmentId },
		);
		expect(enrollment.structuredContent).toMatchObject({
			enrollment: { id: enrollmentId, status: "pending" },
		});

		const tick = parseCliResult<{
			claimed: number;
			completed: number;
			ambiguous: number;
		}>(
			runSequenceCli([
				"--confirm",
				"sequences",
				"tick",
				"--limit",
				"1",
			]),
		);
		expect(tick).toMatchObject({
			claimed: 1,
			completed: 1,
			ambiguous: 0,
		});

		await waitFor(async () => {
			try {
				return (await findMailpitMessages(recipient, subject)).length === 1;
			} catch {
				return false;
			}
		});
		expect(await findMailpitMessages(recipient, subject)).toHaveLength(1);

		const status = await request("listmonk_sequences_status");
		expect(status.isError).toBeFalsy();
		expect(status.structuredContent).toMatchObject({
			enrollments: { completed: 1, ambiguous: 0 },
		});

		const deleted = await request("listmonk_sequences_delete", {
			id: created.sequence.id,
			confirm: true,
		});
		expect(deleted.isError).toBeFalsy();
	});
});
