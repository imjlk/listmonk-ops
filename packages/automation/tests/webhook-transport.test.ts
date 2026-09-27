import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
	createPinnedLookup,
	postPinnedHttpsWebhookWithFallback,
	sendPinnedHttpRequest,
	sendPinnedHttpRequestWithFallback,
} from "../src/webhook-transport";

const PUBLIC_ADDRESS = { address: "93.184.216.34", family: 4 } as const;

describe("pinned HTTP transport", () => {
	test("answers every lookup with the pinned address in both callback forms", () => {
		const lookup = createPinnedLookup(PUBLIC_ADDRESS);
		const single: unknown[] = [];
		lookup("rebind.example", { family: 4 }, (error, address, family) => {
			single.push(error, address, family);
		});
		expect(single).toEqual([null, "93.184.216.34", 4]);

		const all: unknown[] = [];
		lookup("other.example", { all: true }, (error, addresses) => {
			all.push(error, addresses);
		});
		expect(all).toEqual([null, [{ address: "93.184.216.34", family: 4 }]]);
	});

	test("connects to the pinned address instead of resolving the hostname", async () => {
		// Loopback only: the server listens on 127.0.0.1 and the URL names
		// `localhost`, so no lookup or connection can leave this machine.
		const seen: string[] = [];
		const server = createServer((request, response) => {
			seen.push(`${request.method} ${request.headers.host} ${request.url}`);
			response.writeHead(302, { location: "/next" });
			response.end("ignored body");
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		try {
			const { port } = server.address() as AddressInfo;
			const url = `http://localhost:${port}/start`;
			const signal = new AbortController().signal;

			expect(
				await sendPinnedHttpRequest({
					url,
					address: { address: "127.0.0.1", family: 4 },
					method: "HEAD",
					headers: {},
					signal,
				}),
			).toEqual({ status: 302, location: "/next" });
			expect(seen).toEqual([`HEAD localhost:${port} /start`]);

			// Nothing listens on [::1]:port. A transport that re-resolved
			// `localhost` would reach the 127.0.0.1 listener instead.
			await expect(
				sendPinnedHttpRequest({
					url,
					address: { address: "::1", family: 6 },
					method: "HEAD",
					headers: {},
					signal,
				}),
			).rejects.toThrow();
			expect(seen).toHaveLength(1);
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	test("bypasses HTTP and HTTPS proxy environment variables for pinned requests", async () => {
		const targetRequests: string[] = [];
		const proxyRequests: string[] = [];
		const target = createServer((request, response) => {
			targetRequests.push(`${request.headers.host} ${request.url}`);
			response.writeHead(201);
			response.end("origin");
		});
		const proxy = createServer((request, response) => {
			proxyRequests.push(`${request.method} ${request.url}`);
			response.writeHead(200);
			response.end("proxy");
		});
		proxy.on("connect", (request, socket) => {
			proxyRequests.push(`CONNECT ${request.url}`);
			socket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
		});
		await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
		await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
		const targetPort = (target.address() as AddressInfo).port;
		const proxyPort = (proxy.address() as AddressInfo).port;
		const proxyUrl = `http://127.0.0.1:${proxyPort}`;
		const variableNames = [
			"HTTP_PROXY",
			"http_proxy",
			"HTTPS_PROXY",
			"https_proxy",
			"ALL_PROXY",
			"all_proxy",
			"NO_PROXY",
			"no_proxy",
			"NODE_USE_ENV_PROXY",
		] as const;
		const previous = new Map(
			variableNames.map((name) => [name, process.env[name]]),
		);
		for (const name of [
			"HTTP_PROXY",
			"http_proxy",
			"HTTPS_PROXY",
			"https_proxy",
			"ALL_PROXY",
			"all_proxy",
		]) {
			process.env[name] = proxyUrl;
		}
		process.env.NO_PROXY = "";
		process.env.no_proxy = "";
		process.env.NODE_USE_ENV_PROXY = "1";
		try {
			const response = await sendPinnedHttpRequest({
				url: `http://target.example:${targetPort}/pinned`,
				address: { address: "127.0.0.1", family: 4 },
				method: "GET",
				headers: {},
				signal: AbortSignal.timeout(2_000),
			});
			expect(response.status).toBe(201);
			expect(targetRequests).toEqual([`target.example:${targetPort} /pinned`]);

			await expect(
				sendPinnedHttpRequest({
					url: `https://target.example:${targetPort}/pinned`,
					address: { address: "127.0.0.1", family: 4 },
					method: "HEAD",
					headers: {},
					signal: AbortSignal.timeout(2_000),
				}),
			).rejects.toThrow();
			expect(proxyRequests).toEqual([]);
		} finally {
			for (const name of variableNames) {
				const value = previous.get(name);
				if (value === undefined) {
					delete process.env[name];
				} else {
					process.env[name] = value;
				}
			}
			target.closeAllConnections();
			proxy.closeAllConnections();
			await Promise.all([
				new Promise<void>((resolve) => target.close(() => resolve())),
				new Promise<void>((resolve) => proxy.close(() => resolve())),
			]);
		}
	});

	test("rejects protocols other than HTTP and HTTPS before connecting", async () => {
		await expect(
			sendPinnedHttpRequest({
				url: "ftp://example.com/file",
				address: PUBLIC_ADDRESS,
				method: "GET",
				headers: {},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("Protocol ftp: is not supported");
	});

	test("reports an unparseable URL as a rejection", async () => {
		const pending = sendPinnedHttpRequest({
			url: "not a url",
			address: PUBLIC_ADDRESS,
			method: "HEAD",
			headers: {},
			signal: new AbortController().signal,
		});
		await expect(pending).rejects.toThrow();
	});

	test("keeps collected failures when the URL cannot be parsed", async () => {
		const failure = new Error("connect failed");
		let caught: unknown;
		try {
			await sendPinnedHttpRequestWithFallback(
				{
					url: "not a url",
					addresses: [PUBLIC_ADDRESS],
					method: "HEAD",
					headers: {},
					signal: new AbortController().signal,
				},
				async () => {
					throw failure;
				},
			);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AggregateError);
		expect((caught as AggregateError).errors).toEqual([failure]);
		expect((caught as AggregateError).message).toBe(
			"Unable to connect to any validated address for the requested URL",
		);
	});

	test("stops trying further addresses once the request is aborted", async () => {
		const controller = new AbortController();
		const attempted: string[] = [];
		await expect(
			sendPinnedHttpRequestWithFallback(
				{
					url: "https://multi.example/",
					addresses: [
						PUBLIC_ADDRESS,
						{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
					],
					method: "HEAD",
					headers: {},
					signal: controller.signal,
				},
				async (input) => {
					attempted.push(input.address.address);
					controller.abort();
					throw new Error("aborted");
				},
			),
		).rejects.toMatchObject({ name: "AbortError" });
		expect(attempted).toEqual(["93.184.216.34"]);
	});

	test("shares a total timeout across validated addresses", async () => {
		const attempted: string[] = [];
		const attemptSignals: AbortSignal[] = [];
		const response = await sendPinnedHttpRequestWithFallback(
			{
				url: "https://multi.example/",
				addresses: [
					PUBLIC_ADDRESS,
					{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
				],
				method: "HEAD",
				headers: {},
				signal: new AbortController().signal,
				totalTimeoutMs: 200,
			},
			async (input) => {
				attempted.push(input.address.address);
				attemptSignals.push(input.signal);
				if (attempted.length === 1) {
					return new Promise(() => {});
				}
				return { status: 200 };
			},
		);

		expect(response).toEqual({ status: 200 });
		expect(attempted).toEqual([
			"93.184.216.34",
			"2606:2800:220:1:248:1893:25c8:1946",
		]);
		expect(attemptSignals[0]?.aborted).toBe(true);
	});

	test("does not apply per-address timeouts to non-idempotent POST requests", async () => {
		await expect(
			sendPinnedHttpRequestWithFallback({
				url: "https://multi.example/",
				addresses: [PUBLIC_ADDRESS],
				method: "POST",
				headers: {},
				body: "{}",
				signal: new AbortController().signal,
				totalTimeoutMs: 200,
			}),
		).rejects.toThrow(
			"Per-address timeout budgets are limited to retry-safe link checks",
		);
	});

	test("rejects an empty validated-address list clearly", async () => {
		await expect(
			sendPinnedHttpRequestWithFallback({
				url: "https://empty.example/",
				addresses: [],
				method: "HEAD",
				headers: {},
				signal: new AbortController().signal,
			}),
		).rejects.toThrow("No validated addresses to attempt");
	});

	test("keeps webhook delivery HTTPS-only on the shared transport", async () => {
		let failure: unknown;
		try {
			await postPinnedHttpsWebhookWithFallback({
				url: "http://8.8.8.8/hooks",
				addresses: [{ address: "8.8.8.8", family: 4 }],
				headers: {},
				body: "{}",
				signal: new AbortController().signal,
			});
		} catch (error) {
			failure = error;
		}
		expect(failure).toBeInstanceOf(AggregateError);
		expect((failure as AggregateError).errors).toEqual([
			new TypeError("Outbound webhook delivery requires HTTPS"),
		]);
	});
});
