import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createListmonkMCPServer } from "../../src/server";
import type { CallToolResult } from "../../src/types/mcp";
import { TEST_CONFIG } from "../setup";

const directory = await mkdtemp(
	join(tmpdir(), "listmonk-ops-provider-parity-"),
);
const configPath = join(directory, "providers.json");
const projectRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);
const cliEntry = resolve(projectRoot, "apps/cli/src/index.ts");

await writeFile(
	configPath,
	JSON.stringify({
		schema_version: 1,
		profiles: [
			{
				id: "local-mailpit",
				kind: "smtp",
				messenger: "email",
				sending_domain: "example.com",
				from_email: "listmonk@example.com",
				smtp_hosts: ["mailpit"],
				webhook_source: "mailpit",
			},
		],
	}),
	"utf8",
);

function credential(): string {
	return TEST_CONFIG.apiToken || TEST_CONFIG.password;
}

function parseCliResult<T>(result: ReturnType<typeof Bun.spawnSync>): T {
	const stdout = result.stdout.toString().trim();
	const stderr = result.stderr.toString().trim();
	if (result.exitCode !== 0) {
		throw new Error(
			`Provider CLI failed with exit ${result.exitCode}: ${stdout}\n${stderr}`,
		);
	}
	const start = stdout.indexOf("{");
	if (start < 0) {
		throw new Error(
			`Provider CLI returned no JSON object: ${stdout}\n${stderr}`,
		);
	}
	return JSON.parse(stdout.slice(start)) as T;
}

function parseMcpResult<T>(result: CallToolResult): T {
	if (result.isError) {
		throw new Error(result.content[0]?.text ?? "Provider MCP call failed");
	}
	return result.structuredContent as T;
}

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("Provider CLI and MCP parity", () => {
	test("shares configured profiles and local Listmonk SMTP inspection", async () => {
		const previousPath = process.env.LISTMONK_OPS_PROVIDER_CONFIG;
		process.env.LISTMONK_OPS_PROVIDER_CONFIG = configPath;
		try {
			const cliList = parseCliResult<{
				configured: boolean;
				profiles: Array<Record<string, unknown>>;
			}>(
				Bun.spawnSync(
					[
						"bun",
						cliEntry,
						"--format",
						"json",
						"providers",
						"list",
					],
					{
						cwd: projectRoot,
						env: {
							...process.env,
							BUN_FORCE_COLOR: "0",
							LISTMONK_OPS_PROVIDER_CONFIG: configPath,
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				),
			);
			const cliStatus = parseCliResult<{
				provider: Record<string, unknown>;
				listmonk?: Record<string, unknown>;
				checks: Array<{ id: string; status: string }>;
			}>(
				Bun.spawnSync(
					[
						"bun",
						cliEntry,
						"--format",
						"json",
						"providers",
						"status",
						"--provider-id",
						"local-mailpit",
					],
					{
						cwd: projectRoot,
						env: {
							...process.env,
							BUN_FORCE_COLOR: "0",
							LISTMONK_API_URL: TEST_CONFIG.baseUrl,
							LISTMONK_USERNAME: TEST_CONFIG.username,
							LISTMONK_API_TOKEN: credential(),
							LISTMONK_OPS_PROVIDER_CONFIG: configPath,
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				),
			);

			const server = createListmonkMCPServer({
				baseUrl: TEST_CONFIG.baseUrl,
				username: TEST_CONFIG.username,
				password: TEST_CONFIG.password,
				apiToken: TEST_CONFIG.apiToken,
				auditStorePath: join(directory, "audit.json"),
			});
			const mcpList = parseMcpResult<typeof cliList>(
				await server.callTool({
					method: "tools/call",
					params: {
						name: "listmonk_providers_list",
						arguments: {},
					},
				}),
			);
			const mcpStatus = parseMcpResult<typeof cliStatus>(
				await server.callTool({
					method: "tools/call",
					params: {
						name: "listmonk_providers_status",
						arguments: { provider_id: "local-mailpit" },
					},
				}),
			);

			expect(mcpList).toEqual(cliList);
			expect(mcpStatus.provider).toEqual(cliStatus.provider);
			expect(mcpStatus.listmonk).toEqual(cliStatus.listmonk);
			expect(mcpStatus.checks).toEqual(cliStatus.checks);
			expect(mcpStatus.listmonk).toMatchObject({
				smtp_configured: true,
				smtp_enabled: true,
			});
		} finally {
			if (previousPath === undefined) {
				delete process.env.LISTMONK_OPS_PROVIDER_CONFIG;
			} else {
				process.env.LISTMONK_OPS_PROVIDER_CONFIG = previousPath;
			}
		}
	});
});
