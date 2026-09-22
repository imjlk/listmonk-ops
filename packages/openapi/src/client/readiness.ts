import { createHealthCheckUrl, type FetchFn } from "./transport";

export type ReadinessResource = "lists" | "subscribers" | "campaigns";
export type ReadinessProbeState = "ok" | "denied" | "unavailable" | "invalid_response" | "not_checked";

export interface ReadinessProbeResult {
	state: ReadinessProbeState;
	http_status?: number;
}

export interface ListmonkReadiness {
	connectivity: "reachable" | "unreachable" | "unknown";
	health: ReadinessProbeResult;
	authentication: ReadinessProbeResult;
	permissions: Array<ReadinessProbeResult & { resource: ReadinessResource }>;
}

const MAX_PROBE_BYTES = 65_536;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readProbeJson(response: Response, controller: AbortController): Promise<unknown> {
	const reader = response.body?.getReader();
	if (!reader) return undefined;
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > MAX_PROBE_BYTES) {
				controller.abort();
				return undefined;
			}
			chunks.push(chunk.value);
		}
		const bytes = new Uint8Array(size);
		let offset = 0;
		for (const chunk of chunks) {
			bytes.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return JSON.parse(new TextDecoder().decode(bytes));
	} finally {
		reader.releaseLock();
	}
}

/** A bounded, non-retrying GET probe that never exposes response bodies or credentials. */
export async function probeListmonkEndpoint(options: {
	url: string;
	headers?: Record<string, string>;
	timeoutMs: number;
	fetch: FetchFn;
	kind: "health" | "authentication" | "permission";
}): Promise<ReadinessProbeResult> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs);
	let status: number | undefined;
	try {
		const response = await options.fetch(options.url, {
			method: "GET",
			headers: options.headers,
			signal: controller.signal,
			redirect: "manual",
		});
		status = response.status;
		if (!response.ok) {
			await response.body?.cancel();
			return {
				state: status === 401 || status === 403 ? "denied" : "unavailable",
				http_status: status,
			};
		}
		const body = await readProbeJson(response, controller);
		const data = isRecord(body) ? body.data : undefined;
		let valid: boolean;
		if (options.kind === "health") {
			valid = data === true;
		} else if (options.kind === "authentication") {
			// Listmonk 6.2 /about is a bare object; tolerate an enveloped response too.
			const about = isRecord(data) ? data : body;
			valid = isRecord(about) && typeof about.version === "string" && about.version.length > 0;
		} else {
			valid = Array.isArray(data) || (isRecord(data) && Array.isArray(data.results));
		}
		return { state: valid ? "ok" : "invalid_response", http_status: status };
	} catch {
		return {
			state: "unavailable",
			...(status === undefined ? {} : { http_status: status }),
		};
	} finally {
		controller.abort();
		clearTimeout(timer);
	}
}

/** Verify authentication separately from public health and scoped collection access. */
export function createReadinessOperation(options: {
	baseUrl: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	fetch: FetchFn;
}): (resources?: readonly ReadinessResource[]) => Promise<ListmonkReadiness> {
	return async (resources = []) => {
		const selectedResources = [...new Set(resources)];
		for (const resource of selectedResources) {
			if (!["lists", "subscribers", "campaigns"].includes(resource)) throw new TypeError("Unsupported readiness resource");
		}
		const base = new URL(options.baseUrl);
		base.search = "";
		base.hash = "";
		base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
		const timeoutMs = Number.isFinite(options.timeoutMs)
			? Math.max(1, Math.min(5_000, options.timeoutMs ?? 5_000))
			: 5_000;
		const probe = (url: string, kind: "health" | "authentication" | "permission") =>
			probeListmonkEndpoint({
				url,
				kind,
				timeoutMs,
				headers: options.headers,
				fetch: options.fetch,
			});
		const authenticated = Boolean(
			new Headers(options.headers).get("Authorization"),
		);
		const [health, authentication] = await Promise.all([
			probe(createHealthCheckUrl(options.baseUrl), "health"),
			authenticated
				? probe(new URL("about", base).href, "authentication")
				: Promise.resolve<ReadinessProbeResult>({ state: "not_checked" }),
		]);
		const permissions = await Promise.all(selectedResources.map(async (resource) => {
			const result = authentication.state === "ok"
				? await probe(new URL(`${resource}?page=1&per_page=1`, base).href, "permission")
				: { state: "not_checked" as const };
			return { resource, ...result };
		}));
		return {
			connectivity: health.http_status !== undefined || authentication.http_status !== undefined
				? "reachable"
				: "unreachable",
			health,
			authentication,
			permissions,
		};
	};
}
