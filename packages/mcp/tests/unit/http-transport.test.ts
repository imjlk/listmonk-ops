import { describe, expect, test } from "bun:test";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { createListmonkMCPServer } from "../../src/server.js";

type ServerConfig = Parameters<typeof createListmonkMCPServer>[0];

function createServer(overrides: Partial<ServerConfig> = {}) {
	return createListmonkMCPServer({
		baseUrl: "http://127.0.0.1:9000/api",
		username: "api-admin",
		apiToken: "listmonk-test-token",
		...overrides,
	});
}

function listToolsRequest(
	server: ReturnType<typeof createServer>,
	headers: HeadersInit = {},
) {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Content-Type", "application/json");
	return server.getApp().request("http://localhost/tools/list", {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify({ method: "tools/list" }),
	});
}

describe("MCP HTTP transport boundary", () => {
	test("rejects untrusted hosts and origins while reflecting loopback CORS", async () => {
		const server = createServer();
		const untrustedHost = await server
			.getApp()
			.request("http://mcp.attacker.example/tools/list", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ method: "tools/list" }),
			});
		expect(untrustedHost.status).toBe(403);
		expect(await untrustedHost.json()).toEqual({ error: "Forbidden host" });

		const untrustedOrigin = await listToolsRequest(server, {
			Origin: "https://attacker.example",
		});
		expect(untrustedOrigin.status).toBe(403);
		expect(await untrustedOrigin.json()).toEqual({
			error: "Forbidden origin",
		});

		const loopbackOrigin = "http://127.0.0.1:5173";
		const allowed = await listToolsRequest(server, { Origin: loopbackOrigin });
		expect(allowed.status).toBe(200);
			expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
			loopbackOrigin,
		);

		const remoteServer = createServer({
			httpAuthToken: "http-test-secret",
			allowedHttpHosts: ["mcp.example.com"],
			allowedHttpOrigins: ["https://app.example.com"],
		});
		const remoteAllowed = await remoteServer
			.getApp()
			.request("http://mcp.example.com/tools/list", {
				method: "POST",
				headers: {
					Authorization: "Bearer http-test-secret",
					"Content-Type": "application/json",
					Origin: "https://app.example.com",
				},
				body: JSON.stringify({ method: "tools/list" }),
			});
		expect(remoteAllowed.status).toBe(200);
	});

	test("protects tool endpoints with an optional bearer token", async () => {
		const server = createServer({ httpAuthToken: "http-test-secret" });
		const health = await server.getApp().request("http://localhost/health");
		expect(health.status).toBe(200);

		const missing = await listToolsRequest(server);
		expect(missing.status).toBe(401);
		expect(missing.headers.get("WWW-Authenticate")).toBe(
			'Bearer realm="listmonk-ops-mcp"',
		);

		const invalid = await listToolsRequest(server, {
			Authorization: "Bearer wrong-secret",
		});
		expect(invalid.status).toBe(401);

		const authorized = await listToolsRequest(server, {
			Authorization: "Bearer http-test-secret",
		});
		expect(authorized.status).toBe(200);
		expect((await authorized.json()).tools).toHaveLength(64);
	});

	test("serves a stateless MCP initialize request and closes the request server", async () => {
		const server = createServer();
		const getResponse = await server.getApp().request("http://localhost/mcp");
		expect(getResponse.status).toBe(405);
		expect(getResponse.headers.get("Allow")).toBe("POST");

		const initializeResponse = await server
			.getApp()
			.request("http://localhost/mcp", {
				method: "POST",
				headers: {
					Accept: "application/json, text/event-stream",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: LATEST_PROTOCOL_VERSION,
						capabilities: {},
						clientInfo: { name: "http-contract-test", version: "1.0.0" },
					},
				}),
			});

		expect(initializeResponse.status).toBe(200);
		expect(await initializeResponse.json()).toMatchObject({
			jsonrpc: "2.0",
			id: 1,
			result: {
				protocolVersion: LATEST_PROTOCOL_VERSION,
				serverInfo: { name: "listmonk-ops" },
			},
		});
	});

	test("starts and stops on loopback and rejects unsafe remote binding", async () => {
		const server = createServer();
		const listener = await server.listen(0, "127.0.0.1");
		try {
			const response = await fetch(
				`http://127.0.0.1:${listener.port}/health`,
			);
			expect(response.status).toBe(200);
		} finally {
			listener.stop(true);
		}

		await expect(server.listen(0, "0.0.0.0")).rejects.toThrow(
			"MCP_HTTP_AUTH_TOKEN",
		);
		await expect(
			createServer({ httpAuthToken: "http-test-secret" }).listen(
				0,
				"0.0.0.0",
			),
		).rejects.toThrow(
			"MCP_HTTP_ALLOWED_HOSTS and MCP_HTTP_ALLOWED_ORIGINS",
		);

		const remoteServer = createServer({
			httpAuthToken: "http-test-secret",
			allowedHttpHosts: ["mcp.example.com"],
			allowedHttpOrigins: ["https://app.example.com"],
		});
		const remoteListener = await remoteServer.listen(0, "0.0.0.0");
		remoteListener.stop(true);
	});
});
