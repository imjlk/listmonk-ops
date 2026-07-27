/**
 * Canonicalize a Listmonk API base URL: trim, drop a trailing slash, and
 * ensure the path ends with /api. Two URLs that spell the same instance
 * differently (e.g. http://h:9000/api vs http://h:9000/api/) must produce
 * the same value, or idempotency target hashing would compute different
 * namespaces for the same Listmonk instance and conflict instead of
 * replaying.
 *
 * Throws on an empty/invalid URL so callers surface bad config at the
 * boundary rather than silently sending malformed requests.
 *
 * Shared by the CLI and MCP adapters so the two surfaces cannot drift.
 */
export function normalizeListmonkApiUrl(url: string): string {
	const trimmed = url.trim();
	if (!trimmed) {
		throw new Error("Listmonk API URL is required");
	}

	const base = trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
	const withApiSuffix = base.endsWith("/api") ? base : `${base}/api`;

	// Validate the result is a real URL. A reverse-proxy path like
	// /custom/api is fine; a malformed string is rejected up front.
	try {
		new URL(withApiSuffix);
	} catch {
		throw new Error(`Invalid Listmonk API URL: ${withApiSuffix}`);
	}

	return withApiSuffix;
}
