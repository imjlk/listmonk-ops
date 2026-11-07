import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListmonkMCPServer } from "../../src/server";
const dir = mkdtempSync(join(tmpdir(), "ops-health-mcp-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
test("server health honors programmatic file targets without audit, outbox or remote changes", async () => {
	const sequenceStorePath = join(dir, "sequence.json"), webhookStorePath = join(
		dir,
		"webhook.json",
	);
	const workers = [{ status: "running", heartbeatAt: "2026-11-07T00:00:00Z" }];
	writeFileSync(
		sequenceStorePath,
		JSON.stringify({ version: 1, definitions: [], enrollments: [], workers }),
	);
	writeFileSync(
		webhookStorePath,
		JSON.stringify({
			version: 2,
			endpoints: [],
			deliveries: [],
			endpointRuntime: [],
			workers,
		}),
	);
	const server = new ListmonkMCPServer({
		baseUrl: "http://127.0.0.1:1",
		username: "offline",
		password: "",
		credentialProvider: async () => {
			throw new Error("Health must not resolve credentials");
		},
		sequenceStorePath,
		webhookStorePath,
		auditStorePath: join(dir, "audit.json"),
	});
	const result = await server.callTool({ method: "tools/call", params: { name: "listmonk_ops_health", arguments: { at: "2026-11-07T00:00:00Z" } } });
	expect(result.isError).toBeFalsy();
	expect(result.structuredContent).toMatchObject({
		severity: "healthy",
		check_passed: true,
	});
	expect(readdirSync(dir)).toEqual(["sequence.json", "webhook.json"]);
});
