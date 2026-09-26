import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export type ResolvedWebhookAddress = Readonly<{
	address: string;
	family: 4 | 6;
}>;

/**
 * One HTTP(S) request whose connection is pinned to an address that already
 * passed the public-address policy.
 */
export type PinnedHttpRequest = Readonly<{
	url: string;
	address: ResolvedWebhookAddress;
	method: "GET" | "HEAD" | "POST";
	headers: Readonly<Record<string, string>>;
	body?: string;
	signal: AbortSignal;
}>;

export type PinnedHttpResponse = Readonly<{
	status: number;
	/** Raw Location header so callers can revalidate every redirect hop. */
	location?: string;
}>;

export type PinnedHttpSender = (
	input: PinnedHttpRequest,
) => Promise<PinnedHttpResponse>;

type PinnedWebhookRequest = Readonly<{
	url: string;
	address: ResolvedWebhookAddress;
	headers: Readonly<Record<string, string>>;
	body: string;
	signal: AbortSignal;
}>;

type PinnedWebhookResponse = Readonly<{
	ok: boolean;
	status: number;
}>;

/**
 * A lookup that ignores the hostname and answers with the validated address,
 * so the connection cannot re-resolve DNS between validation and connect.
 * It supports both the single-address and the `all: true` callback forms.
 */
export function createPinnedLookup(
	address: ResolvedWebhookAddress,
): LookupFunction {
	return (_hostname, options, callback) => {
		if (options.all === true) {
			callback(null, [{ address: address.address, family: address.family }]);
			return;
		}
		callback(null, address.address, address.family);
	};
}

/**
 * Send one HTTP(S) request pinned to a validated address. The URL hostname
 * still drives the Host header, TLS SNI, and certificate verification; only
 * the connection target is fixed. A fresh agent prevents reusing a socket
 * opened for another validation, and the response body is never read. Every
 * failure, including an unparseable URL, is reported as a rejection.
 */
export async function sendPinnedHttpRequest(
	input: PinnedHttpRequest,
): Promise<PinnedHttpResponse> {
	const parsed = new URL(input.url);
	const secure = parsed.protocol === "https:";
	if (!secure && parsed.protocol !== "http:") {
		throw new TypeError(`Protocol ${parsed.protocol} is not supported`);
	}
	const hostname = parsed.hostname.replace(/^\[|\]$/gu, "");
	const send = secure ? httpsRequest : httpRequest;
	return new Promise((resolve, reject) => {
		const request = send(
			parsed,
			{
				method: input.method,
				headers: input.headers,
				agent: false,
				lookup: createPinnedLookup(input.address),
				family: input.address.family,
				servername: secure && isIP(hostname) === 0 ? hostname : undefined,
				signal: input.signal,
			},
			(response) => {
				const status = response.statusCode ?? 0;
				const location = response.headers.location;
				response.destroy();
				resolve(location === undefined ? { status } : { status, location });
			},
		);
		request.once("error", reject);
		if (input.body === undefined) {
			request.end();
		} else {
			request.end(input.body);
		}
	});
}

async function tryValidatedAddresses<T>(
	url: string,
	addresses: readonly ResolvedWebhookAddress[],
	signal: AbortSignal,
	attempt: (address: ResolvedWebhookAddress) => Promise<T>,
): Promise<T> {
	const failures: unknown[] = [];
	for (const address of addresses) {
		try {
			return await attempt(address);
		} catch (error) {
			failures.push(error);
			if (signal.aborted) {
				throw error;
			}
		}
	}
	let host = "the requested URL";
	try {
		host = new URL(url).hostname;
	} catch {
		// Keep the collected failures even when the URL itself is invalid.
	}
	throw new AggregateError(
		failures,
		`Unable to connect to any validated address for ${host}`,
	);
}

/** Try each validated address in order until one of them answers. */
export function sendPinnedHttpRequestWithFallback(
	input: Omit<PinnedHttpRequest, "address"> &
		Readonly<{ addresses: readonly ResolvedWebhookAddress[] }>,
	send: PinnedHttpSender = sendPinnedHttpRequest,
): Promise<PinnedHttpResponse> {
	const { addresses, ...request } = input;
	return tryValidatedAddresses(input.url, addresses, input.signal, (address) =>
		send({ ...request, address }),
	);
}

async function postPinnedHttpsWebhook(
	input: PinnedWebhookRequest,
): Promise<PinnedWebhookResponse> {
	if (new URL(input.url).protocol !== "https:") {
		throw new TypeError("Outbound webhook delivery requires HTTPS");
	}
	const { status } = await sendPinnedHttpRequest({ ...input, method: "POST" });
	return { ok: status >= 200 && status < 300, status };
}

export function postPinnedHttpsWebhookWithFallback(
	input: Readonly<{
		url: string;
		addresses: readonly ResolvedWebhookAddress[];
		headers: Readonly<Record<string, string>>;
		body: string;
		signal: AbortSignal;
	}>,
	send: (input: PinnedWebhookRequest) => Promise<PinnedWebhookResponse> =
		postPinnedHttpsWebhook,
): Promise<PinnedWebhookResponse> {
	return tryValidatedAddresses(
		input.url,
		input.addresses,
		input.signal,
		(address) =>
			send({
				url: input.url,
				address,
				headers: input.headers,
				body: input.body,
				signal: input.signal,
			}),
	);
}
