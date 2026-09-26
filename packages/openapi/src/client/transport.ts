export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRIES = 3;
/** Largest delay `setTimeout` honors; larger values fire immediately. */
export const MAX_TIMEOUT_MS = 2_147_483_647;
export const MAX_RETRIES = 10;

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Statuses whose responses cannot carry a body, so they are never wrapped.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

export type FetchFn = (
	input: URL | RequestInfo,
	init?: RequestInit,
) => Promise<Response>;

/** Raised instead of following a redirect for a non-idempotent request. */
export class ListmonkRedirectError extends Error {
	readonly status: number;

	constructor(method: string, status: number) {
		super(
			`Listmonk answered ${method} with a ${status} redirect; redirects are not followed for non-idempotent requests. Point the base URL at the final Listmonk API origin.`,
		);
		this.name = "ListmonkRedirectError";
		this.status = status;
	}
}

export function assertTransportTimeout(timeoutMs: number): number {
	if (
		typeof timeoutMs !== "number" ||
		!Number.isFinite(timeoutMs) ||
		timeoutMs < 1 ||
		timeoutMs > MAX_TIMEOUT_MS
	) {
		throw new RangeError(
			`Listmonk request timeout must be a number of milliseconds between 1 and ${MAX_TIMEOUT_MS}`,
		);
	}
	return Math.ceil(timeoutMs);
}

export function assertTransportRetries(retries: number): number {
	if (
		typeof retries !== "number" ||
		!Number.isInteger(retries) ||
		retries < 0 ||
		retries > MAX_RETRIES
	) {
		throw new RangeError(
			`Listmonk request retries must be an integer between 0 and ${MAX_RETRIES}`,
		);
	}
	return retries;
}

function createTimeoutError(timeoutMs: number): DOMException {
	return new DOMException(
		`Listmonk request timed out after ${timeoutMs} ms`,
		"TimeoutError",
	);
}

/** Keep a pending timer from holding a CLI process open after its work ends. */
function unrefTimer(handle: ReturnType<typeof setTimeout>): void {
	if (typeof handle === "object" && handle !== null && "unref" in handle) {
		(handle as { unref?: () => void }).unref?.();
	}
}

async function discardBody(response: Response): Promise<void> {
	try {
		await response.body?.cancel();
	} catch {
		// The connection is being abandoned; a failed cancel changes nothing.
	}
}

/**
 * Keep the attempt's deadline armed until the body is fully read, cancelled,
 * or fails. `fetch()` resolves once headers arrive, so clearing the timer at
 * that point would let a stalled body hang the caller forever.
 */
function releaseWhenBodySettles(
	response: Response,
	release: () => void,
): Response {
	const source = response.body;
	if (
		source === null ||
		NULL_BODY_STATUSES.has(response.status) ||
		response.status < 200 ||
		response.status > 599 ||
		response.headers.get("Content-Length") === "0"
	) {
		release();
		return response;
	}

	const reader = source.getReader();
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const chunk = await reader.read();
				if (chunk.done) {
					release();
					controller.close();
					return;
				}
				controller.enqueue(chunk.value);
			} catch (error) {
				release();
				controller.error(error);
			}
		},
		async cancel(reason) {
			release();
			await reader.cancel(reason);
		},
	});
	const wrapped = new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
	Object.defineProperties(wrapped, {
		url: { value: response.url },
		redirected: { value: response.redirected },
	});
	return wrapped;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function waitForRetry(ms: number, signal?: AbortSignal | null): Promise<void> {
	if (!signal) {
		await new Promise((resolve) => setTimeout(resolve, ms));
		return;
	}
	if (signal.aborted) {
		throw abortReason(signal);
	}

	await new Promise<void>((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timeoutHandle);
			signal.removeEventListener("abort", onAbort);
			reject(abortReason(signal));
		};
		const timeoutHandle = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

function retryDelayMs(attempt: number): number {
	const cappedDelay = Math.min(1000, 100 * 2 ** attempt);
	return Math.round(cappedDelay / 2 + Math.random() * (cappedDelay / 2));
}

function getRequestMethod(input: URL | RequestInfo, init: RequestInit): string {
	if (init.method) {
		return init.method.toUpperCase();
	}

	if (typeof Request !== "undefined" && input instanceof Request) {
		return input.method.toUpperCase();
	}

	return "GET";
}

function getRequestSignal(
	input: URL | RequestInfo,
	init: RequestInit,
): AbortSignal | null | undefined {
	if (init.signal) {
		return init.signal;
	}
	if (typeof Request !== "undefined" && input instanceof Request) {
		return input.signal;
	}
	return undefined;
}

function isAbortError(error: unknown): boolean {
	if (error instanceof DOMException) {
		return error.name === "AbortError";
	}

	return (
		typeof error === "object" &&
		error !== null &&
		"name" in error &&
		(error as { name?: string }).name === "AbortError"
	);
}

interface MergedAbortSignals {
	signal: AbortSignal | undefined;
	cleanup: () => void;
}

function mergeAbortSignals(
	primary?: AbortSignal | null,
	secondary?: AbortSignal,
): MergedAbortSignals {
	if (!primary) {
		return { signal: secondary, cleanup: () => {} };
	}
	if (!secondary) {
		return { signal: primary, cleanup: () => {} };
	}

	if (
		typeof AbortSignal !== "undefined" &&
		typeof AbortSignal.any === "function"
	) {
		return {
			signal: AbortSignal.any([primary, secondary]),
			cleanup: () => {},
		};
	}

	const controller = new AbortController();
	const onPrimaryAbort = () => controller.abort(abortReason(primary));
	const onSecondaryAbort = () => controller.abort(abortReason(secondary));

	if (primary.aborted) {
		onPrimaryAbort();
	} else if (secondary.aborted) {
		onSecondaryAbort();
	} else {
		primary.addEventListener("abort", onPrimaryAbort, { once: true });
		secondary.addEventListener("abort", onSecondaryAbort, { once: true });
	}

	return {
		signal: controller.signal,
		cleanup: () => {
			primary.removeEventListener("abort", onPrimaryAbort);
			secondary.removeEventListener("abort", onSecondaryAbort);
		},
	};
}

/**
 * Wrap `fetch` with a per-attempt deadline that also covers the response
 * body, bounded retries for idempotent methods, and no redirect following for
 * requests that could replay or silently convert a mutation.
 */
export function createResilientFetch(options: {
	timeoutMs: number;
	retries: number;
	baseFetch: FetchFn;
}): FetchFn {
	const timeoutMs = assertTransportTimeout(options.timeoutMs);
	const retries = assertTransportRetries(options.retries);
	const maxAttempts = retries + 1;

	return async (input, init = {}) => {
		const requestInit = init as RequestInit;
		const method = getRequestMethod(input, requestInit);
		const requestSignal = getRequestSignal(input, requestInit);
		const isRetryableMethod = RETRYABLE_METHODS.has(method);
		let lastError: unknown;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const timeoutController = new AbortController();
			const mergedSignals = mergeAbortSignals(
				requestSignal,
				timeoutController.signal,
			);
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				mergedSignals.cleanup();
				clearTimeout(timeoutHandle);
			};
			const timeoutHandle = setTimeout(() => {
				timeoutController.abort(createTimeoutError(timeoutMs));
				// Past the deadline even a body that is never read must not keep
				// fallback abort listeners attached to the caller's signal.
				release();
			}, timeoutMs);
			unrefTimer(timeoutHandle);
			let handedOff = false;

			try {
				const response = await options.baseFetch(input, {
					...requestInit,
					signal: mergedSignals.signal,
					// A followed 301/302 turns a POST into a GET that reports
					// success, and a 307/308 replays the body to another origin.
					...(isRetryableMethod ? {} : { redirect: "manual" as const }),
				});

				if (
					!isRetryableMethod &&
					(response.type === "opaqueredirect" ||
						(response.status >= 300 && response.status < 400))
				) {
					await discardBody(response);
					throw new ListmonkRedirectError(method, response.status);
				}

				if (
					response.status >= 500 &&
					isRetryableMethod &&
					attempt < maxAttempts - 1
				) {
					await discardBody(response);
					await waitForRetry(retryDelayMs(attempt), requestSignal);
					continue;
				}

				handedOff = true;
				try {
					return releaseWhenBodySettles(response, release);
				} catch (error) {
					// A body that cannot be wrapped must still free the attempt
					// and its connection.
					release();
					await discardBody(response);
					throw error;
				}
			} catch (error) {
				if (error instanceof ListmonkRedirectError) {
					throw error;
				}
				lastError = error;

				const userAborted = requestSignal?.aborted === true;
				const abortError = isAbortError(error);

				if (
					userAborted ||
					!isRetryableMethod ||
					attempt >= maxAttempts - 1 ||
					(abortError && !timeoutController.signal.aborted)
				) {
					throw error;
				}

				await waitForRetry(retryDelayMs(attempt), requestSignal);
			} finally {
				if (!handedOff) {
					release();
				}
			}
		}

		// Kept as a defensive return guard for TypeScript control-flow analysis.
		throw (
			lastError ||
			new Error("Request failed without an explicit transport error")
		);
	};
}

export function createHealthCheckUrl(baseUrl: string): string {
	const url = new URL(baseUrl);
	const basePath = url.pathname.replace(/\/+$/, "");
	const appPath = basePath.endsWith("/api")
		? basePath.slice(0, -"/api".length)
		: basePath;

	url.pathname = `${appPath}/health`;
	url.search = "";
	url.hash = "";
	return url.toString();
}
