import { describe, expect, spyOn, test } from "bun:test";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { connect } from "node:net";
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

function postJson(
	server: ReturnType<typeof createServer>,
	path: string,
	body: unknown,
	headers: HeadersInit = {},
) {
	const requestHeaders = new Headers(headers);
	requestHeaders.set("Accept", "application/json, text/event-stream");
	requestHeaders.set("Content-Type", "application/json");
	return server.getApp().request(`http://localhost${path}`, {
		method: "POST",
		headers: requestHeaders,
		body: JSON.stringify(body),
	});
}

function sendRawHttpRequest(
	port: number | undefined,
	request: string,
): Promise<string> {
	if (port === undefined) {
		return Promise.reject(new Error("Listener has no TCP port"));
	}
	return new Promise((resolve, reject) => {
		const socket = connect(port, "127.0.0.1");
		let response = "";
		socket.setEncoding("utf8");
		socket.on("data", (chunk) => {
			response += chunk;
		});
		socket.on("end", () => resolve(response));
		socket.on("error", reject);
		socket.write(request);
	});
}

const catalogToolCall = {
	jsonrpc: "2.0",
	id: 1,
	method: "tools/call",
	params: { name: "listmonk_list_operations", arguments: {} },
};
const legacyCatalogToolCall = {
	method: "tools/call",
	params: { name: "listmonk_list_operations", arguments: {} },
};

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

		const userinfoHost = await server
			.getApp()
			.request("http://127.0.0.1/health", {
				headers: { Host: "attacker.example@127.0.0.1" },
			});
		expect(userinfoHost.status).toBe(403);
		expect(await userinfoHost.json()).toEqual({ error: "Forbidden host" });

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
		const futureToolRoute = await server
			.getApp()
			.request("http://localhost/tools/future");
		expect(futureToolRoute.status).toBe(401);

		const authorized = await listToolsRequest(server, {
			Authorization: "Bearer http-test-secret",
		});
		expect(authorized.status).toBe(200);
		expect((await authorized.json()).tools).toHaveLength(143);
	});

	test("keeps only health, root, and CORS preflights public when a token is set", async () => {
		const server = createServer({ httpAuthToken: "http-test-secret" });
		const app = server.getApp();
		for (const [method, path] of [
			["GET", "/health"],
			["HEAD", "/health"],
			["GET", "/"],
		] as const) {
			const response = await app.request(`http://localhost${path}`, {
				method,
			});
			expect({ method, path, status: response.status }).toEqual({
				method,
				path,
				status: 200,
			});
		}

		const preflight = await app.request("http://localhost/mcp", {
			method: "OPTIONS",
			headers: {
				"Access-Control-Request-Headers": "authorization,content-type",
				"Access-Control-Request-Method": "POST",
				Origin: "http://127.0.0.1:5173",
			},
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe(
			"http://127.0.0.1:5173",
		);

		for (const path of ["/health", "/", "/health/", "/unknown"]) {
			const response = await postJson(server, path, {});
			expect({ path, status: response.status }).toEqual({
				path,
				status: 401,
			});
		}
	});

	test("authorizes the decoded path the router matches", async () => {
		const server = createServer({ httpAuthToken: "http-test-secret" });
		const callTool = spyOn(server, "callTool");
		const attempts = [
			["/%6Dcp", catalogToolCall],
			["/m%63p", catalogToolCall],
			["/%6dcp", catalogToolCall],
			["/%256Dcp", catalogToolCall],
			["/MCP", catalogToolCall],
			["/mcp/", catalogToolCall],
			["/%74ools/call", legacyCatalogToolCall],
			["/tools/%63all", legacyCatalogToolCall],
			["/%2574ools/call", legacyCatalogToolCall],
			["/Tools/call", legacyCatalogToolCall],
			["/tools/call/", legacyCatalogToolCall],
			["/%74ools/list", { method: "tools/list" }],
		] as const;
		for (const [path, body] of attempts) {
			const response = await postJson(server, path, body);
			expect({ path, status: response.status }).toEqual({
				path,
				status: 401,
			});
			expect(response.headers.get("WWW-Authenticate")).toBe(
				'Bearer realm="listmonk-ops-mcp"',
			);
		}
		expect(callTool).not.toHaveBeenCalled();

		// Authorized, the same encoded paths reach the tool handlers, so the
		// rejections above come from authentication rather than routing.
		const authorization = { Authorization: "Bearer http-test-secret" };
		const encodedMcp = await postJson(
			server,
			"/%6Dcp",
			catalogToolCall,
			authorization,
		);
		expect(encodedMcp.status).toBe(200);
		const encodedLegacy = await postJson(
			server,
			"/%74ools/call",
			legacyCatalogToolCall,
			authorization,
		);
		expect(encodedLegacy.status).toBe(200);
		expect(callTool).toHaveBeenCalledTimes(2);
	});

	test("authorizes decoded paths over a loopback socket", async () => {
		const server = createServer({ httpAuthToken: "http-test-secret" });
		const listener = await server.listen(0, "127.0.0.1");
		try {
			for (const [path, body] of [
				["/%6Dcp", catalogToolCall],
				["/m%63p", catalogToolCall],
				["/%74ools/call", legacyCatalogToolCall],
				["/%74ools/list", { method: "tools/list" }],
			] as const) {
				const response = await fetch(
					`http://127.0.0.1:${listener.port}${path}`,
					{
						method: "POST",
						headers: {
							Accept: "application/json, text/event-stream",
							"Content-Type": "application/json",
						},
						body: JSON.stringify(body),
					},
				);
				expect({ path, status: response.status }).toEqual({
					path,
					status: 401,
				});
			}
		} finally {
			listener.stop(true);
		}
	});

	test("rejects a Host-less HTTP/1.0 request without throwing", async () => {
		const server = createServer();
		const listener = await server.listen(0, "127.0.0.1");
		// Without Host, Bun exposes a relative request URL.
		const consoleError = spyOn(console, "error").mockImplementation(() => {});
		try {
			const response = await sendRawHttpRequest(
				listener.port,
				"GET /health HTTP/1.0\r\n\r\n",
			);
			expect(response).toStartWith("HTTP/1.1 403");
			expect(response).toContain('{"error":"Forbidden host"}');
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
			listener.stop(true);
		}
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
