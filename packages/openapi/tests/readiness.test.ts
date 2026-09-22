import { describe, expect, test } from "bun:test";
import {
	createReadinessOperation,
	probeListmonkEndpoint,
} from "../src/client/readiness";

function reply(data: unknown, status = 200) {
	return Response.json({ data }, { status });
}

describe("bounded Listmonk readiness probes", () => {
	test("public health cannot establish authentication and a rejected token skips permissions", async () => {
		const paths: string[] = [];
		const probe = createReadinessOperation({
			baseUrl: "https://example.test/prefix/api",
			headers: { Authorization: "token test:invalid" },
			fetch: async (input) => {
				const path = new URL(String(input)).pathname;
				paths.push(path);
				return path.endsWith("/health") ? reply(true) : reply("secret diagnostic", 403);
			},
		});
		const result = await probe(["subscribers"]);
		expect(result).toEqual({
			connectivity: "reachable",
			health: { state: "ok", http_status: 200 },
			authentication: { state: "denied", http_status: 403 },
			permissions: [{ resource: "subscribers", state: "not_checked" }],
		});
		expect(paths.sort()).toEqual(["/prefix/api/about", "/prefix/health"]);
		expect(JSON.stringify(result)).not.toContain("secret");
	});

	test("distinguishes scoped collection access from authentication and deduplicates checks", async () => {
		const paths: string[] = [];
		const probe = createReadinessOperation({
			baseUrl: "https://example.test/api",
			headers: { Authorization: "token test:valid" },
			fetch: async (input, init) => {
				expect(init?.redirect).toBe("manual");
				const url = new URL(String(input));
				paths.push(url.pathname);
				if (url.pathname === "/health") return reply(true);
				if (url.pathname === "/api/about") return Response.json({ version: "v6.2.0" });
				expect(url.searchParams.get("per_page")).toBe("1");
				return url.pathname === "/api/subscribers" ? reply("denied", 403) : reply({ results: [] });
			},
		});
		const result = await probe(["lists", "subscribers", "lists"]);
		expect(result.authentication.state).toBe("ok");
		expect(result.permissions).toEqual([
			{ resource: "lists", state: "ok", http_status: 200 },
			{ resource: "subscribers", state: "denied", http_status: 403 },
		]);
		expect(paths.filter((path) => path === "/api/lists")).toHaveLength(1);
	});

	test("missing credentials still allow a public connectivity check", async () => {
		let calls = 0;
		const result = await createReadinessOperation({
			baseUrl: "https://example.test/api",
			fetch: async () => { calls++; return reply(true); },
		})(["campaigns"]);
		expect(calls).toBe(1);
		expect(result.authentication.state).toBe("not_checked");
		expect(result.connectivity).toBe("reachable");
	});

	test("rejects HTML and oversized successful responses", async () => {
		for (const body of ["<html>Login</html>", JSON.stringify({ data: { version: "x".repeat(70_000) } })]) {
			const result = await probeListmonkEndpoint({
				url: "https://example.test/api/about", kind: "authentication", timeoutMs: 100,
				fetch: async () => new Response(body),
			});
			expect(result.state).not.toBe("ok");
			expect(result.http_status).toBe(200);
		}
	});

	test("keeps the deadline active while a response body stalls", async () => {
		const server = Bun.serve({
			hostname: "127.0.0.1", port: 0,
			fetch: () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":')); } })),
		});
		try {
			const started = Date.now();
			const result = await probeListmonkEndpoint({
				url: `http://127.0.0.1:${server.port}/api/about`, kind: "authentication", timeoutMs: 50,
				fetch: globalThis.fetch.bind(globalThis),
			});
			expect(result.state).toBe("unavailable");
			expect(Date.now() - started).toBeLessThan(2_000);
		} finally { server.stop(true); }
	});
});

test("redirects retain connectivity evidence without forwarding credentials", async () => {
	let redirected = 0;
	const destination = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			redirected++;
			return Response.json({ version: "6.2.0" });
		},
	});
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch() {
			return Response.redirect(`http://127.0.0.1:${destination.port}/`);
		},
	});
	try {
		const result = await createReadinessOperation({ baseUrl: `http://127.0.0.1:${server.port}/api`, headers: { Authorization: "token test:secret" }, fetch: globalThis.fetch.bind(globalThis) })();
		expect(result.connectivity).toBe("reachable");
		expect(result.authentication).toEqual({
			state: "unavailable",
			http_status: 302,
		});
		expect(redirected).toBe(0);
	} finally {
		server.stop(true);
		destination.stop(true);
	}
});
