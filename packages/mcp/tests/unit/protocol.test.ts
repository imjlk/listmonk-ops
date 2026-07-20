import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import packageJson from "../../package.json" with { type: "json" };
import { connectMCPTransport } from "../../src/protocol.js";
import { createListmonkMCPServer } from "../../src/server.js";

describe("standard MCP protocol adapter", () => {
	test("initializes and exposes the existing tool registry", async () => {
		const provider = createListmonkMCPServer({
			baseUrl: "http://127.0.0.1:9000/api",
			username: "api-admin",
			apiToken: "dummy-token",
		});
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const protocolServer = await connectMCPTransport(
			provider,
			serverTransport,
		);
		const client = new Client({ name: "listmonk-ops-test", version: "1.0.0" });

		try {
			await client.connect(clientTransport);

			expect(client.getServerVersion()).toMatchObject({
				name: "listmonk-ops",
				version: packageJson.version,
			});
			const result = await client.listTools();
			expect(result.tools).toHaveLength(62);
			expect(result.tools.map((tool) => tool.name)).toContain(
				"listmonk_ops_preflight",
			);

			const missingTool = await client.callTool({
				name: "listmonk_missing_tool",
				arguments: {},
			});
			expect(missingTool.isError).toBe(true);
		} finally {
			await client.close();
			await protocolServer.close();
		}
	});
});
