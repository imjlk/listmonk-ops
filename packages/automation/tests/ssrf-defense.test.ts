import { describe, expect, it } from "bun:test";
import type { ListmonkClient } from "@listmonk-ops/openapi";
import {
	checkLink,
	type HostAddressLookup,
	isPrivateHost,
	isSafeFetchUrl,
	isSafeFetchUrlAsync,
	resolvePublicHostAddresses,
	runCampaignPreflight,
} from "../src/campaign";
import type {
	PinnedHttpRequest,
	PinnedHttpResponse,
	PinnedHttpSender,
} from "../src/webhook-transport";

type Answer = Readonly<{ address: string; family: number }>;
type ScriptedAnswer = readonly Answer[] | Error | "never";

const PUBLIC: readonly Answer[] = [{ address: "93.184.216.34", family: 4 }];
const LOOPBACK: readonly Answer[] = [{ address: "127.0.0.1", family: 4 }];
const METADATA: readonly Answer[] = [{ address: "169.254.169.254", family: 4 }];

function dnsError(code: string): Error {
	return Object.assign(new Error(`getaddrinfo ${code}`), { code });
}

/**
 * Scripted resolver: each hostname answers its scripted results in order and
 * then keeps repeating the last one. No real DNS query is ever made.
 */
function scriptedResolver(script: Readonly<Record<string, ScriptedAnswer[]>>) {
	const calls: string[] = [];
	const lookupHost: HostAddressLookup = async (hostname) => {
		const answers = script[hostname];
		if (!answers || answers.length === 0) {
			throw new Error(`unexpected lookup: ${hostname}`);
		}
		const count = calls.filter((call) => call === hostname).length;
		calls.push(hostname);
		const answer = answers[Math.min(count, answers.length - 1)]!;
		if (answer === "never") {
			return new Promise<never>(() => {});
		}
		if (answer instanceof Error) {
			throw answer;
		}
		return answer;
	};
	return { calls, lookupHost };
}

function recordingSender(
	respond: (
		input: PinnedHttpRequest,
		index: number,
	) => PinnedHttpResponse | Promise<PinnedHttpResponse>,
) {
	const requests: PinnedHttpRequest[] = [];
	const send: PinnedHttpSender = async (input) => {
		requests.push(input);
		return respond(input, requests.length - 1);
	};
	return { requests, send };
}

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

	it("blocks special-purpose IPv4 ranges", () => {
		expect(isPrivateHost("192.0.2.1")).toBe(true);
		expect(isPrivateHost("198.18.0.1")).toBe(true);
		expect(isPrivateHost("198.51.100.1")).toBe(true);
		expect(isPrivateHost("203.0.113.1")).toBe(true);
		expect(isPrivateHost("224.0.0.1")).toBe(true);
		expect(isPrivateHost("240.0.0.1")).toBe(true);
	});

	it("blocks non-global IPv6 ranges", () => {
		expect(isPrivateHost("fec0::1")).toBe(true);
		expect(isPrivateHost("ff02::1")).toBe(true);
		expect(isPrivateHost("2001:db8::1")).toBe(true);
		expect(isPrivateHost("3fff::1")).toBe(true);
	});

	it("allows public addresses", () => {
		expect(isPrivateHost("8.8.8.8")).toBe(false);
		expect(isPrivateHost("example.com")).toBe(false);
		expect(isPrivateHost("1.1.1.1")).toBe(false);
		expect(isPrivateHost("2001:4860:4860::8888")).toBe(false);
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

describe("SSRF defense — resolvePublicHostAddresses", () => {
	it("returns validated addresses IPv4-first with families derived from the address", async () => {
		const { lookupHost } = scriptedResolver({
			"dual.example": [
				[
					{ address: "2001:4860:4860::8888", family: 6 },
					{ address: "8.8.8.8", family: 6 },
				],
			],
		});
		expect(
			await resolvePublicHostAddresses("https://dual.example/", lookupHost),
		).toEqual({
			safe: true,
			addresses: [
				{ address: "8.8.8.8", family: 4 },
				{ address: "2001:4860:4860::8888", family: 6 },
			],
		});
	});

	it("resolves literal addresses without a DNS lookup", async () => {
		const { calls, lookupHost } = scriptedResolver({});
		expect(
			await resolvePublicHostAddresses(
				"https://[2001:4860:4860::8888]/hook",
				lookupHost,
			),
		).toEqual({
			safe: true,
			addresses: [{ address: "2001:4860:4860::8888", family: 6 }],
		});
		expect(calls).toEqual([]);
	});

	it("blocks a host when any resolved address is private", async () => {
		const { lookupHost } = scriptedResolver({
			"mixed.example": [[...PUBLIC, ...LOOPBACK]],
		});
		expect(
			await resolvePublicHostAddresses("https://mixed.example/", lookupHost),
		).toEqual({
			safe: false,
			reason:
				"Host mixed.example resolves to private/internal address 127.0.0.1",
		});
	});

	it("fails closed when DNS fails, returns nothing, or returns a non-IP", async () => {
		const { lookupHost } = scriptedResolver({
			"missing.example": [dnsError("ENOTFOUND")],
			"empty.example": [[]],
			"garbage.example": [[{ address: "not-an-ip", family: 4 }]],
		});
		await expect(
			resolvePublicHostAddresses("https://missing.example/", lookupHost),
		).rejects.toThrow("ENOTFOUND");
		await expect(
			resolvePublicHostAddresses("https://empty.example/", lookupHost),
		).rejects.toThrow("no DNS addresses");
		await expect(
			resolvePublicHostAddresses("https://garbage.example/", lookupHost),
		).rejects.toThrow("non-IP");
	});

	it("keeps the async URL check fail-closed for literal hosts", async () => {
		expect(await isSafeFetchUrlAsync("https://8.8.8.8/hook")).toEqual({
			safe: true,
		});
		expect(await isSafeFetchUrlAsync("https://127.0.0.1/hook")).toMatchObject({
			safe: false,
		});
	});
});

describe("SSRF defense — pinned link checks and DNS rebinding", () => {
	it("pins the request to the address that passed validation", async () => {
		const { calls, lookupHost } = scriptedResolver({
			"rebind.example": [PUBLIC, LOOPBACK],
		});
		const { requests, send } = recordingSender(() => ({ status: 200 }));

		expect(
			await checkLink("https://rebind.example/offer", 5_000, {
				lookupHost,
				send,
			}),
		).toEqual({ url: "https://rebind.example/offer", ok: true, status: 200 });
		expect(calls).toEqual(["rebind.example"]);
		expect(requests).toHaveLength(1);
		expect(requests[0]).toMatchObject({
			url: "https://rebind.example/offer",
			method: "HEAD",
			address: { address: "93.184.216.34", family: 4 },
		});
	});

	it("revalidates the GET fallback and refuses a host that rebinds to loopback", async () => {
		const { calls, lookupHost } = scriptedResolver({
			"rebind.example": [PUBLIC, LOOPBACK],
		});
		const { requests, send } = recordingSender(() => ({ status: 405 }));

		const result = await checkLink("https://rebind.example/offer", 5_000, {
			lookupHost,
			send,
		});
		expect(result).toEqual({
			url: "https://rebind.example/offer",
			ok: false,
			error:
				"Blocked: Host rebind.example resolves to private/internal address 127.0.0.1",
		});
		expect(calls).toEqual(["rebind.example", "rebind.example"]);
		expect(requests.map((request) => request.address.address)).toEqual([
			"93.184.216.34",
		]);
	});

	it("blocks a same-host redirect after DNS rebinds to the metadata address", async () => {
		const { lookupHost } = scriptedResolver({
			"rebind.example": [PUBLIC, METADATA],
		});
		const { requests, send } = recordingSender(() => ({
			status: 302,
			location: "/latest/meta-data/",
		}));

		const result = await checkLink("https://rebind.example/offer", 5_000, {
			lookupHost,
			send,
		});
		expect(result).toEqual({
			url: "https://rebind.example/offer",
			ok: false,
			error:
				"Redirect blocked: Host rebind.example resolves to private/internal address 169.254.169.254",
		});
		expect(requests.map((request) => request.address.address)).toEqual([
			"93.184.216.34",
		]);
	});

	it("reports DNS failures as unverifiable and never fetches them", async () => {
		const { lookupHost } = scriptedResolver({
			"missing.example": [dnsError("ENOTFOUND")],
			"empty.example": [[]],
		});
		const { requests, send } = recordingSender(() => ({ status: 200 }));

		expect(
			await checkLink("https://missing.example/page", 5_000, {
				lookupHost,
				send,
			}),
		).toEqual({
			url: "https://missing.example/page",
			ok: false,
			error: "Unverifiable: DNS resolution failed for missing.example (ENOTFOUND)",
		});
		expect(
			await checkLink("https://empty.example/page", 5_000, {
				lookupHost,
				send,
			}),
		).toEqual({
			url: "https://empty.example/page",
			ok: false,
			error: "Unverifiable: DNS resolution failed for empty.example",
		});
		expect(requests).toHaveLength(0);
	});

	it("reports an unresolvable redirect hop as unverifiable", async () => {
		const { lookupHost } = scriptedResolver({
			"start.example": [PUBLIC],
			"elsewhere.example": [dnsError("EAI_AGAIN")],
		});
		const { requests, send } = recordingSender(() => ({
			status: 301,
			location: "https://elsewhere.example/next",
		}));

		expect(
			await checkLink("https://start.example/", 5_000, { lookupHost, send }),
		).toEqual({
			url: "https://start.example/",
			ok: false,
			error:
				"Redirect unverifiable: DNS resolution failed for elsewhere.example (EAI_AGAIN)",
		});
		expect(requests).toHaveLength(1);
	});

	it("times out a DNS lookup that never settles without fetching", async () => {
		const { lookupHost } = scriptedResolver({ "slow.example": ["never"] });
		const { requests, send } = recordingSender(() => ({ status: 200 }));

		expect(
			await checkLink("https://slow.example/", 20, { lookupHost, send }),
		).toEqual({
			url: "https://slow.example/",
			ok: false,
			error: "Timed out after 20ms",
		});
		expect(requests).toHaveLength(0);
	});

	it("reports local error codes without echoing remote error text", async () => {
		const { lookupHost } = scriptedResolver({ "tls.example": [PUBLIC] });
		const { send } = recordingSender(() => {
			throw Object.assign(
				new Error(
					"Hostname/IP does not match certificate's altnames: DNS:metadata.internal",
				),
				{ code: "ERR_TLS_CERT_ALTNAME_INVALID" },
			);
		});
		const result = await checkLink("https://tls.example/", 5_000, {
			lookupHost,
			send,
		});
		expect(result).toEqual({
			url: "https://tls.example/",
			ok: false,
			error: "Request failed (ERR_TLS_CERT_ALTNAME_INVALID)",
		});
		expect(JSON.stringify(result)).not.toContain("metadata.internal");

		const { send: sendWithoutCode } = recordingSender(() => {
			throw new Error("upstream said: internal-admin.corp refused");
		});
		expect(
			await checkLink("https://tls.example/", 5_000, {
				lookupHost,
				send: sendWithoutCode,
			}),
		).toEqual({
			url: "https://tls.example/",
			ok: false,
			error: "Request failed",
		});
	});

	it("falls back to the next validated address after a connection failure", async () => {
		const { lookupHost } = scriptedResolver({
			"multi.example": [
				[
					{ address: "93.184.216.34", family: 4 },
					{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
				],
			],
		});
		const { requests, send } = recordingSender((input) => {
			if (input.address.family === 4) {
				throw Object.assign(new Error("connect refused"), {
					code: "ECONNREFUSED",
				});
			}
			return { status: 204 };
		});

		expect(
			await checkLink("https://multi.example/", 5_000, { lookupHost, send }),
		).toEqual({ url: "https://multi.example/", ok: true, status: 204 });
		expect(requests.map((request) => request.address.family)).toEqual([4, 6]);
	});
});

describe("SSRF defense — redirect chain with injected transport", () => {
	it("blocks a redirect chain that ends at a private IP", async () => {
		const { lookupHost } = scriptedResolver({
			"public.example.com": [PUBLIC],
		});
		const { requests, send } = recordingSender((_input, index) =>
			index === 0
				? { status: 302, location: "https://public.example.com/redirected" }
				: { status: 302, location: "http://10.0.0.1/secret" },
		);

		const result = await checkLink("https://public.example.com/start", 5_000, {
			lookupHost,
			send,
		});
		expect(result).toEqual({
			url: "https://public.example.com/start",
			ok: false,
			error: "Redirect blocked: Host 10.0.0.1 is private/internal",
		});
		expect(requests).toHaveLength(2);
	});

	it("fails when redirect budget is exhausted", async () => {
		const { lookupHost } = scriptedResolver({ "example.com": [PUBLIC] });
		const { requests, send } = recordingSender((_input, index) => ({
			status: 302,
			location: `https://example.com/hop${index + 1}`,
		}));

		const result = await checkLink("https://example.com/start", 5_000, {
			lookupHost,
			send,
		});
		expect(result.ok).toBe(false);
		expect(result.error).toBe("Exceeded max redirects (5)");
		expect(requests).toHaveLength(6);
	});

	it("blocks GET-fallback redirect to private IP after HEAD exhausts budget", async () => {
		const { lookupHost } = scriptedResolver({ "example.com": [PUBLIC] });
		const { requests, send } = recordingSender((input, index) => {
			if (input.method === "HEAD" && index < 5) {
				return { status: 302, location: `https://example.com/hop${index + 1}` };
			}
			if (input.method === "HEAD") {
				return { status: 405 };
			}
			return { status: 302, location: "http://10.0.0.1/secret" };
		});

		const result = await checkLink("https://example.com/start", 5_000, {
			lookupHost,
			send,
		});
		expect(result.ok).toBe(false);
		expect(requests.map((request) => request.method)).toEqual([
			"HEAD",
			"HEAD",
			"HEAD",
			"HEAD",
			"HEAD",
			"HEAD",
			"GET",
		]);
		expect(
			requests.every((request) => request.address.address === "93.184.216.34"),
		).toBe(true);
	});

	it("blocks redirect targets that carry URL credentials", async () => {
		const { lookupHost } = scriptedResolver({ "example.com": [PUBLIC] });
		const { requests, send } = recordingSender(() => ({
			status: 302,
			location: "https://user:pass@example.com/private",
		}));

		expect(
			await checkLink("https://example.com/start", 5_000, { lookupHost, send }),
		).toEqual({
			url: "https://example.com/start",
			ok: false,
			error: "Redirect blocked: URL credentials are not allowed",
		});
		expect(requests).toHaveLength(1);
	});

	it("rejects an unparseable Location header without echoing it", async () => {
		const { lookupHost } = scriptedResolver({ "example.com": [PUBLIC] });
		const { send } = recordingSender(() => ({
			status: 302,
			location: "http://[internal-admin",
		}));

		const result = await checkLink("https://example.com/start", 5_000, {
			lookupHost,
			send,
		});
		expect(result).toEqual({
			url: "https://example.com/start",
			ok: false,
			status: 302,
			error: "Redirect blocked: invalid Location header",
		});
	});
});

describe("SSRF defense — campaign preflight link health", () => {
	const unsubscribe =
		"https://newsletter.test/subscription/00000000-0000-0000-0000-000000000000/00000000-0000-0000-0000-000000000000";

	function preflightClient(rendered: string): ListmonkClient {
		return {
			campaign: {
				getById: async () => ({
					data: {
						id: 1,
						name: "Preview",
						subject: "Hello",
						body: "<p>Hello</p>",
						content_type: "html",
						status: "draft",
						updated_at: "2026-09-25T00:00:00Z",
						lists: [{ id: 1 }],
						template_id: 1,
					},
				}),
				preview: async () => ({ data: rendered }),
			},
			list: {
				getById: async () => ({ data: { id: 1, subscriber_count: 100 } }),
			},
			template: { getById: async () => ({ data: { id: 1 } }) },
		} as unknown as ListmonkClient;
	}

	it("reports rebinding and unresolvable links without fetching private targets", async () => {
		const { lookupHost } = scriptedResolver({
			"rebind.example": [PUBLIC, LOOPBACK],
			"missing.example": [dnsError("ENOTFOUND")],
			"ok.example": [PUBLIC],
		});
		const { requests, send } = recordingSender((input) =>
			input.url.startsWith("https://rebind.example/")
				? { status: 405 }
				: { status: 200 },
		);
		const rendered = [
			'<a href="https://rebind.example/offer">Offer</a>',
			'<a href="https://missing.example/page">Page</a>',
			'<a href="https://ok.example/">Home</a>',
			`<a href="${unsubscribe}">Unsubscribe</a>`,
		].join("");

		const result = await runCampaignPreflight(preflightClient(rendered), 1, {
			checkLinks: true,
			linkCheck: { lookupHost, send },
		});
		const linkHealth = result.checks.find((check) => check.id === "link_health");
		expect(linkHealth).toMatchObject({
			level: "warn",
			details: {
				checked: 3,
				broken: [
					{
						url: "https://rebind.example/offer",
						ok: false,
						error:
							"Blocked: Host rebind.example resolves to private/internal address 127.0.0.1",
					},
					{
						url: "https://missing.example/page",
						ok: false,
						error:
							"Unverifiable: DNS resolution failed for missing.example (ENOTFOUND)",
					},
				],
			},
		});
		expect(
			requests.every((request) => request.address.address === "93.184.216.34"),
		).toBe(true);
		expect(requests.some((request) => request.url === unsubscribe)).toBe(false);
	});
});
