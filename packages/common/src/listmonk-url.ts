/**
 * Canonicalize a Listmonk API base URL: parse it, drop a trailing slash
 * from the pathname, and ensure the pathname ends with /api. Two URLs that
 * spell the same instance differently (e.g. http://h:9000/api vs
 * http://h:9000/api/) must produce the same value, or idempotency target
 * hashing would compute different namespaces for the same Listmonk
 * instance and conflict instead of replaying.
 *
 * Query strings and fragments are rejected: naively appending /api to a
 * URL like `https://host/api?tenant=1` would produce
 * `https://host/api?tenant=1/api`, silently mis-targeting requests.
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

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`Invalid Listmonk API URL: ${trimmed}`);
	}

	if (parsed.search || parsed.hash) {
		throw new Error(
			"Listmonk API URL must not include a query string or fragment",
		);
	}

	// Drop trailing slashes from the pathname before appending /api so
	// http://h:9000/ and http://h:9000 both normalize identically. The URL
	// API normalizes an empty pathname back to "/", so build the final
	// pathname explicitly rather than concatenating onto "/" (which would
	// yield "//api").
	const stripped = parsed.pathname.replace(/\/+$/, "");
	parsed.pathname = stripped === ""
		? "/api"
		: stripped.endsWith("/api")
			? stripped
			: `${stripped}/api`;

	return parsed.toString().replace(/\/$/, "");
}
