import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import packageJson from "../../package.json" with { type: "json" };
import {
	connectMCPTransport,
	type MCPToolProvider,
} from "../../src/protocol.js";
import type { ListToolsRequest } from "../../src/types/mcp.js";
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
			expect(result.tools).toHaveLength(67);
			expect(result.tools.map((tool) => tool.name)).toContain(
				"listmonk_ops_preflight",
			);
			const catalogResult = await client.callTool({
				name: "listmonk_list_operations",
				arguments: { family: "campaigns" },
			});
			expect(catalogResult.structuredContent?.operations).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
					mcpName: "listmonk_get_campaigns",
				}),
			]),
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

	test("preserves pagination parameters for the tool provider", async () => {
		let receivedRequest: ListToolsRequest | undefined;
		const provider: MCPToolProvider = {
			async listTools(request) {
				receivedRequest = request;
				return { tools: [] };
			},
			async callTool() {
				return { content: [] };
			},
		};
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		const protocolServer = await connectMCPTransport(
			provider,
			serverTransport,
		);
		const client = new Client({ name: "listmonk-ops-test", version: "1.0.0" });

		try {
			await client.connect(clientTransport);
			await client.listTools({ cursor: "next-page" });
			expect(receivedRequest).toEqual({
				method: "tools/list",
				params: { cursor: "next-page" },
			});
		} finally {
			await client.close();
			await protocolServer.close();
		}
	});
});
