import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test";
import {
	isPrivateHost,
	isSafeFetchUrl,
	runCampaignPreflight,
} from "../src/campaign";
import type { ListmonkClient } from "@listmonk-ops/openapi";

describe("SSRF defense — isPrivateHost", () => {
	it("blocks loopback IPv4", () => {
		expect(isPrivateHost("127.0.0.1")).toBe(true);
		expect(isPrivateHost("127.255.255.255")).toBe(true);
	});

	it("blocks localhost hostname", () => {
		expect(isPrivateHost("localhost")).toBe(true);
	});

	it("blocks private 10.x", () => {
		expect(isPrivateHost("10.0.0.1")).toBe(true);
		expect(isPrivateHost("10.255.255.255")).toBe(true);
	});

	it("blocks private 172.16-31.x", () => {
		expect(isPrivateHost("172.16.0.1")).toBe(true);
		expect(isPrivateHost("172.31.255.255")).toBe(true);
	});

	it("allows public 172.x (outside 16-31)", () => {
		expect(isPrivateHost("172.15.0.1")).toBe(false);
		expect(isPrivateHost("172.32.0.1")).toBe(false);
	});

	it("blocks private 192.168.x", () => {
		expect(isPrivateHost("192.168.1.1")).toBe(true);
	});

	it("blocks link-local 169.254.x (includes metadata IP)", () => {
		expect(isPrivateHost("169.254.169.254")).toBe(true);
		expect(isPrivateHost("169.254.0.1")).toBe(true);
	});

	it("blocks 0.0.0.0", () => {
		expect(isPrivateHost("0.0.0.0")).toBe(true);
	});

	it("blocks IPv6 loopback", () => {
		expect(isPrivateHost("::1")).toBe(true);
	});

	it("blocks IPv6 ULA", () => {
		expect(isPrivateHost("fc00::1")).toBe(true);
		expect(isPrivateHost("fd12:3456::1")).toBe(true);
	});

	it("blocks IPv6 link-local", () => {
		expect(isPrivateHost("fe80::1")).toBe(true);
	});

	it("allows public addresses", () => {
		expect(isPrivateHost("8.8.8.8")).toBe(false);
		expect(isPrivateHost("example.com")).toBe(false);
		expect(isPrivateHost("1.1.1.1")).toBe(false);
	});
});

describe("SSRF defense — isSafeFetchUrl", () => {
	it("blocks loopback URLs", () => {
		const result = isSafeFetchUrl("http://127.0.0.1:8080/secret");
		expect(result.safe).toBe(false);
		expect(result.reason).toContain("private");
	});

	it("blocks localhost URLs", () => {
		const result = isSafeFetchUrl("http://localhost:8080/secret");
		expect(result.safe).toBe(false);
		expect(result.reason).toContain("private");
	});

	it("blocks metadata IP", () => {
		const result = isSafeFetchUrl("http://169.254.169.254/latest/meta-data/");
		expect(result.safe).toBe(false);
	});

	it("blocks non-http protocols", () => {
		expect(isSafeFetchUrl("file:///etc/passwd").safe).toBe(false);
		expect(isSafeFetchUrl("ftp://example.com/file").safe).toBe(false);
	});

	it("allows public http(s) URLs", () => {
		expect(isSafeFetchUrl("https://example.com/test").safe).toBe(true);
		expect(isSafeFetchUrl("http://8.8.8.8/dns").safe).toBe(true);
	});

	it("rejects malformed URLs", () => {
		expect(isSafeFetchUrl("not-a-url").safe).toBe(false);
	});

	it("blocks IPv4-mapped IPv6 loopback", () => {
		expect(isPrivateHost("::ffff:127.0.0.1")).toBe(true);
	});

	it("blocks IPv4-mapped IPv6 private", () => {
		expect(isPrivateHost("::ffff:10.0.0.1")).toBe(true);
	});
});

describe("SSRF defense — redirect chain with mocked fetch", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("blocks a redirect chain that ends at a private IP", async () => {
		let callCount = 0;
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			callCount++;
			const url = typeof input === "string" ? input : input.toString();
			// First HEAD: redirect to a public URL
			if (callCount === 1) {
				return Promise.resolve(
					new Response(null, {
						status: 302,
						headers: { location: "https://public.example.com/redirected" },
					}),
				);
			}
			// Second HEAD: redirect to a private IP
			if (callCount === 2) {
				return Promise.resolve(
					new Response(null, {
						status: 302,
						headers: { location: "http://10.0.0.1/secret" },
					}),
				);
			}
			return Promise.resolve(
				new Response(null, { status: 200 }),
			);
		}) as typeof fetch;

		const { checkLink } = await import("../src/campaign");
		const result = await checkLink("https://public.example.com/start", 5000);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("Redirect blocked");
	});

	it("fails when redirect budget is exhausted", async () => {
		let callCount = 0;
		globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
			callCount++;
			// Always redirect to the next hop
			return Promise.resolve(
				new Response(null, {
					status: 302,
					headers: {
						location: `https://example.com/hop${callCount}`,
					},
				}),
			);
		}) as typeof fetch;

		const { checkLink } = await import("../src/campaign");
		const result = await checkLink("https://example.com/start", 5000);
		expect(result.ok).toBe(false);
		expect(result.error).toContain("Exceeded max redirects");
	});
});
