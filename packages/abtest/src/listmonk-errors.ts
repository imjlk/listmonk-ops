/**
 * Operator-facing rendering of Listmonk client failures.
 *
 * The generated client returns non-2xx responses as `{ error, response }`
 * envelopes whose `error` is the parsed body — for Listmonk usually
 * `{ message: "..." }` — so interpolating it printed "[object Object]".
 * These helpers read only the body and the HTTP status: never the request
 * (whose headers carry the API credentials) or the raw response, and they
 * truncate oversized bodies such as a proxy's HTML error page.
 *
 * This mirrors `toResourceErrorMessage` in `@listmonk-ops/operations`,
 * which that package does not export.
 */

const MAX_ERROR_DETAIL_LENGTH = 500;

function describeErrorValue(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	if (typeof error === "string") {
		return error;
	}
	if (error !== null && typeof error === "object") {
		const body = error as { message?: unknown; error?: unknown };
		if (typeof body.message === "string") {
			return body.message;
		}
		if (typeof body.error === "string") {
			return body.error;
		}
		try {
			const serialized = JSON.stringify(error);
			if (serialized !== undefined) {
				return serialized;
			}
		} catch {
			// Fall through to String conversion for non-serializable values.
		}
	}
	return String(error);
}

/** Render a Listmonk error body or a thrown value as readable text. */
export function formatListmonkError(error: unknown): string {
	const text = describeErrorValue(error);
	return text.length > MAX_ERROR_DETAIL_LENGTH
		? `${text.slice(0, MAX_ERROR_DETAIL_LENGTH)}... (truncated)`
		: text;
}

/** HTTP status carried by a client error envelope, when present. */
export function listmonkResponseStatus(response: unknown): number | undefined {
	if (response === null || typeof response !== "object") {
		return undefined;
	}
	const httpResponse = (response as { response?: unknown }).response;
	if (httpResponse === null || typeof httpResponse !== "object") {
		return undefined;
	}
	const status = (httpResponse as { status?: unknown }).status;
	return typeof status === "number" ? status : undefined;
}

/**
 * Render a client error envelope as `HTTP <status>: <message>`, or only the
 * message when the envelope carries no HTTP response.
 */
export function formatListmonkErrorResponse(response: unknown): string {
	const error =
		response !== null && typeof response === "object"
			? (response as { error?: unknown }).error
			: undefined;
	const message = formatListmonkError(error);
	const status = listmonkResponseStatus(response);
	if (status === undefined) {
		return message;
	}
	return message.length > 0 ? `HTTP ${status}: ${message}` : `HTTP ${status}`;
}
