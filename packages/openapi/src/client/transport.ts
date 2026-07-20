export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_RETRIES = 3;

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type FetchFn = (
	input: URL | RequestInfo,
	init?: RequestInit,
) => Promise<Response>;

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

export function createResilientFetch(options: {
	timeoutMs: number;
	retries: number;
	baseFetch: FetchFn;
}): FetchFn {
	const timeoutMs = Math.max(1, options.timeoutMs);
	const retries = Math.max(0, options.retries);
	const maxAttempts = retries + 1;

	return async (input, init = {}) => {
		const requestInit = init as RequestInit;
		const method = getRequestMethod(input, requestInit);
		const requestSignal = getRequestSignal(input, requestInit);
		const isRetryableMethod = RETRYABLE_METHODS.has(method);
		let lastError: unknown;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const timeoutController = new AbortController();
			const timeoutHandle = setTimeout(
				() => timeoutController.abort(),
				timeoutMs,
			);

			const mergedSignals = mergeAbortSignals(
				requestSignal,
				timeoutController.signal,
			);

			try {
				const response = await options.baseFetch(input, {
					...requestInit,
					signal: mergedSignals.signal,
				});

				if (
					response.status >= 500 &&
					isRetryableMethod &&
					attempt < maxAttempts - 1
				) {
					await waitForRetry(retryDelayMs(attempt), requestSignal);
					continue;
				}

				return response;
			} catch (error) {
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
				mergedSignals.cleanup();
				clearTimeout(timeoutHandle);
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
