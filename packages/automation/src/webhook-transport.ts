import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
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

type ValidatedAddressAttempt<T> = (
	address: ResolvedWebhookAddress,
	signal: AbortSignal,
) => Promise<T>;

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
 * Use an explicit agent with an empty proxy environment. Bun's Node HTTP
 * compatibility layer can otherwise route requests through process proxy
 * variables even though the request has a pinned DNS lookup.
 */
function createDirectRequestAgent(secure: boolean): HttpAgent | HttpsAgent {
	const options = { keepAlive: false, proxyEnv: {} };
	return secure ? new HttpsAgent(options) : new HttpAgent(options);
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
				agent: createDirectRequestAgent(secure),
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
	attempt: ValidatedAddressAttempt<T>,
	totalTimeoutMs?: number,
): Promise<T> {
	if (addresses.length === 0) {
		throw new Error("No validated addresses to attempt");
	}
	if (
		totalTimeoutMs !== undefined &&
		(!Number.isFinite(totalTimeoutMs) || totalTimeoutMs <= 0)
	) {
		throw new RangeError("Address attempt timeout must be a positive number");
	}
	const deadline =
		totalTimeoutMs === undefined ? undefined : Date.now() + totalTimeoutMs;
	const failures: unknown[] = [];
	for (let index = 0; index < addresses.length; index += 1) {
		const address = addresses[index]!;
		if (signal.aborted) {
			throw signal.reason ?? new Error("Request aborted");
		}
		const remainingMs =
			deadline === undefined ? undefined : deadline - Date.now();
		if (remainingMs !== undefined && remainingMs <= 0) {
			failures.push(
				new Error("No time remains for a validated address attempt"),
			);
			break;
		}
		const remainingAddresses = addresses.length - index;
		const attemptTimeoutMs =
			remainingMs === undefined
				? undefined
				: Math.max(1, Math.ceil(remainingMs / remainingAddresses));
		const controller = new AbortController();
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let removeAbortListener = () => {};
		const aborted = new Promise<never>((_, reject) => {
			const abort = () => {
				const reason = signal.reason ?? new Error("Request aborted");
				controller.abort(reason);
				reject(reason);
			};
			if (signal.aborted) {
				abort();
				return;
			}
			signal.addEventListener("abort", abort, { once: true });
			removeAbortListener = () => signal.removeEventListener("abort", abort);
		});
		const attemptPromise = Promise.resolve().then(() =>
			attempt(address, controller.signal),
		);
		const attempts: Promise<T>[] = [attemptPromise, aborted];
		if (attemptTimeoutMs !== undefined) {
			attempts.push(
				new Promise<never>((_, reject) => {
					timeout = setTimeout(() => {
						const error = new Error(
							`Validated address attempt timed out after ${attemptTimeoutMs}ms`,
						);
						controller.abort(error);
						reject(error);
					}, attemptTimeoutMs);
				}),
			);
		}
		try {
			return await Promise.race(attempts);
		} catch (error) {
			failures.push(error);
			if (signal.aborted) {
				throw error;
			}
		} finally {
			if (timeout !== undefined) {
				clearTimeout(timeout);
			}
			removeAbortListener();
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
export async function sendPinnedHttpRequestWithFallback(
	input: Omit<PinnedHttpRequest, "address"> &
		Readonly<{
			addresses: readonly ResolvedWebhookAddress[];
			totalTimeoutMs?: number;
		}>,
	send: PinnedHttpSender = sendPinnedHttpRequest,
): Promise<PinnedHttpResponse> {
	const { addresses, totalTimeoutMs, ...request } = input;
	if (request.method === "POST" && totalTimeoutMs !== undefined) {
		throw new RangeError(
			"Per-address timeout budgets are limited to retry-safe link checks",
		);
	}
	return tryValidatedAddresses(
		input.url,
		addresses,
		input.signal,
		(address, signal) => send({ ...request, address, signal }),
		totalTimeoutMs,
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
		(address, signal) =>
			send({
				url: input.url,
				address,
				headers: input.headers,
				body: input.body,
				signal,
			}),
	);
}
